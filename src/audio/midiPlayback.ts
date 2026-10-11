import { getDrillTransportState, onDrillTransportChangedObservable } from '../robot/robot';
import {
  midiFileInput, midiAudioButton, midiClearButton, midiVolumeInput, midiStatus,
  midiUrlForm, midiUrlInput, midiExampleButton,
} from '../ui/dom';
import { MidiTimeline, type MidiNote, type ScheduledMidiNote } from './midiTimeline';
import exampleMidiUrl from '../assets/stars-and-stripes.mid?url';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_NOTES = 100000;
const MAX_VOICES = 64;
interface Voice {
  source: AudioScheduledSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let timeline: MidiTimeline | null = null;
let audioEnabled = false;
let loadRequest = 0;
let loadedDescription = "";
const voices = new Set<Voice>();

function status(message: string) {
  if (midiStatus) midiStatus.textContent = message;
}

function stopVoices() {
  for (const voice of voices) {
    voice.source.stop();
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.filter.disconnect();
  }
  voices.clear();
}

function createVoice({ note, delaySeconds, durationSeconds }: ScheduledMidiNote) {
  if (!context || !master || !noise) return;
  if (voices.size >= MAX_VOICES) {
    status(`${loadedDescription} — 64-voice limit reached; some notes were omitted.`);
    return;
  }
  const start = context.currentTime + delaySeconds;
  const end = start + durationSeconds;
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  let source: OscillatorNode | AudioBufferSourceNode;
  if (note.percussion) {
    const drum = context.createBufferSource();
    drum.buffer = noise;
    drum.loop = true;
    source = drum;
    filter.type = note.pitch <= 36 ? "lowpass" : "highpass";
    filter.frequency.value = note.pitch <= 36 ? 180 : note.pitch >= 42 ? 6500 : 1200;
  } else {
    const oscillator = context.createOscillator();
    const family = Math.floor(note.program / 8);
    oscillator.type = family === 7 || family === 5 ? "sawtooth" :
      family === 8 ? "square" : family === 9 || family === 10 ? "sine" : "triangle";
    oscillator.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
    source = oscillator;
    filter.type = "lowpass";
    filter.frequency.value = Math.min(12000, oscillator.frequency.value * 8);
  }
  const peak = note.velocity * (note.percussion ? 0.18 : 0.1);
  const attack = Math.min(0.008, durationSeconds / 3);
  const release = Math.min(0.04, durationSeconds / 3);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  if (note.percussion) gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.03), end - release);
  else gain.gain.setValueAtTime(peak, end - release);
  gain.gain.linearRampToValueAtTime(0, end);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  const voice = { source, gain, filter };
  voices.add(voice);
  source.onended = () => {
    voices.delete(voice);
    source.disconnect();
    gain.disconnect();
    filter.disconnect();
  };
  source.start(start);
  source.stop(end);
}

function updatePlayback() {
  if (!context || context.state !== "running" || !audioEnabled || !timeline) {
    stopVoices();
    timeline?.reset();
    return;
  }
  const plan = timeline.update(getDrillTransportState(), context.currentTime);
  if (plan.reset) stopVoices();
  plan.scheduled.forEach(createVoice);
}

async function readMidiUrl(input: string): Promise<ArrayBuffer> {
  const url = new URL(input, window.location.href);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https MIDI URLs are supported.");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`MIDI download failed (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) throw new Error("MIDI files must be 10 MB or smaller.");
  if (!response.body) throw new Error("The MIDI download has no response body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new Error("MIDI files must be 10 MB or smaller.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function loadMidi(name: string, read: () => Promise<ArrayBuffer>, failureHint = "") {
  const request = ++loadRequest;
  status(`Loading ${name}…`);
  try {
    const bytes = await read();
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("MIDI files must be 10 MB or smaller.");
    const header = new DataView(bytes);
    if (bytes.byteLength < 14 || header.getUint32(0) !== 0x4d546864) throw new Error("That file is not a Standard MIDI File.");
    if (header.getUint16(8) > 1) throw new Error("Only synchronous MIDI formats 0 and 1 are supported.");
    if (header.getUint16(12) & 0x8000) throw new Error("SMPTE-timed MIDI is not supported; use quarter-note timing.");
    const { Midi } = await import('@tonejs/midi');
    const midi = new Midi(bytes);
    if (!Number.isFinite(midi.header.ppq) || midi.header.ppq <= 0) throw new Error("The MIDI file has invalid beat resolution.");
    const notes: MidiNote[] = midi.tracks.flatMap(track => track.notes.map(note => ({
      beat: note.ticks / midi.header.ppq,
      duration: note.durationTicks / midi.header.ppq,
      pitch: note.midi,
      velocity: note.velocity,
      program: track.instrument.number,
      percussion: track.instrument.percussion,
    })));
    if (!notes.length) throw new Error("The MIDI file contains no notes.");
    if (notes.length > MAX_NOTES) throw new Error("MIDI files must contain at most 100,000 notes.");
    if (notes.some(n => !Number.isFinite(n.beat) || n.beat < 0 || !Number.isFinite(n.duration) ||
      n.duration <= 0 || !Number.isInteger(n.pitch) || n.pitch < 0 || n.pitch > 127 ||
      !Number.isFinite(n.velocity) || n.velocity <= 0 || n.velocity > 1)) {
      throw new Error("The MIDI file contains invalid notes.");
    }
    notes.sort((a, b) => a.beat - b.beat);
    if (request !== loadRequest) return;
    stopVoices();
    timeline = new MidiTimeline(notes);
    const beats = notes.reduce((last, n) => Math.max(last, n.beat + n.duration), 0);
    loadedDescription = `${name}: ${midi.tracks.length} tracks, ${notes.length} notes, ${Math.ceil(beats)} beats`;
    status(`${loadedDescription}. ${audioEnabled ? "Following drill playback." : "Enable MIDI audio to hear it."}`);
    if (midiClearButton) midiClearButton.disabled = false;
    updatePlayback();
  } catch (error) {
    if (request !== loadRequest) return;
    status(`Could not load MIDI: ${error instanceof Error ? error.message : String(error)}${timeline ? " Previous MIDI retained." : ""}${failureHint}`);
  }
}

function loadMidiFromUrl(input: string, name = input) {
  return loadMidi(name, () => readMidiUrl(input), " URL servers must allow cross-origin (CORS) downloads.");
}

export function initMidiPlayback() {
  const fileInput = midiFileInput;
  const clearButton = midiClearButton;
  const audioButton = midiAudioButton;
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void loadMidi(file.name, async () => {
      if (file.size > MAX_FILE_BYTES) throw new Error("MIDI files must be 10 MB or smaller.");
      return file.arrayBuffer();
    });
  });
  midiUrlForm?.addEventListener('submit', event => {
    event.preventDefault();
    if (midiUrlInput?.value.trim()) void loadMidiFromUrl(midiUrlInput.value.trim());
  });
  midiExampleButton?.addEventListener('click', () => {
    if (midiUrlInput) midiUrlInput.value = new URL(exampleMidiUrl, window.location.href).href;
    void loadMidiFromUrl(exampleMidiUrl, "Sousa — The Stars and Stripes Forever (Public Domain)");
  });
  clearButton?.addEventListener('click', () => {
    loadRequest++;
    stopVoices();
    timeline = null;
    loadedDescription = "";
    if (midiFileInput) midiFileInput.value = "";
    if (midiUrlInput) midiUrlInput.value = "";
    clearButton.disabled = true;
    status("No MIDI loaded.");
  });
  midiVolumeInput?.addEventListener('input', () => {
    if (master && context && midiVolumeInput) {
      master.gain.setTargetAtTime(Number(midiVolumeInput.value) / 100, context.currentTime, 0.02);
    }
  });
  audioButton?.addEventListener('click', async () => {
    if (audioEnabled) {
      audioEnabled = false;
      stopVoices();
      timeline?.reset();
      audioButton.textContent = "Enable MIDI audio";
      status("MIDI audio muted.");
      return;
    }
    audioButton.disabled = true;
    try {
      context ??= new AudioContext();
      if (!master) {
        master = context.createGain();
        master.gain.value = Number(midiVolumeInput?.value ?? 60) / 100;
        const limiter = context.createDynamicsCompressor();
        master.connect(limiter);
        limiter.connect(context.destination);
        noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        context.addEventListener('statechange', () => {
          if (context?.state !== 'running' && audioEnabled) {
            stopVoices();
            timeline?.reset();
            audioEnabled = false;
            if (midiAudioButton) midiAudioButton.textContent = "Enable MIDI audio";
            status("Audio was suspended. Enable MIDI audio again to resume.");
          }
        });
      }
      await context.resume();
      if (context.state !== "running") throw new Error("Browser audio is suspended.");
      audioEnabled = true;
      audioButton.textContent = "Mute MIDI audio";
      status(timeline ? `${loadedDescription}. Following drill playback.` : "Audio enabled. Import a MIDI file.");
      timeline?.reset();
      updatePlayback();
    } catch (error) {
      status(`Could not enable audio: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      audioButton.disabled = false;
    }
  });
  onDrillTransportChangedObservable.add(updatePlayback);
  const sharedUrl = new URLSearchParams(window.location.search).get("midi");
  if (midiUrlInput) midiUrlInput.value = sharedUrl || new URL(exampleMidiUrl, window.location.href).href;
  void loadMidiFromUrl(sharedUrl || exampleMidiUrl,
    sharedUrl || "Sousa — The Stars and Stripes Forever (Public Domain)");
}
