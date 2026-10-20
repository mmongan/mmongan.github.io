import {
  getMusicTransportState,
  setPlaybackRepeat,
  setPlaybackSongLength,
  setPlaybackTempoMap,
  setPlaybackBeatUnits,
  onDrillTransportChangedObservable,
} from '../robot/robot';
import {
  midiFileInput, midiAudioButton, midiClearButton, midiVolumeInput, midiStatus,
  midiUrlForm, midiUrlInput, midiExampleButton, midiPlaybackHint,
} from '../ui/dom';
import { MidiTimeline, type MidiNote } from './midiTimeline';
import { SampledMidiSynth } from './sampledMidiSynth';
import { initMidiScore, setMidiScoreTracks } from './midiScore';
import { quantizeScoreNote } from './midiNotation';
import exampleMidiUrl from '../assets/liberty-bell-band.mid?url';
import { midiBeatUnits } from './midiBeatPulse';

const EXAMPLE_MIDI_DESCRIPTION = "Sousa — The Liberty Bell (full band, Public Domain)";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_NOTES = 100000;
let context: AudioContext | null = null;
let master: GainNode | null = null;
let synth: SampledMidiSynth | null = null;
let midiNotes: MidiNote[] = [];
let synthRequest = 0;
let timeline: MidiTimeline | null = null;
let audioEnabled = true;
let enablingAudio = false;
let loadRequest = 0;
let loadedDescription = "";
let synthLoading = false;
let midiLoading = false;
let statusIsError = false;

export function isMidiPlaybackReady() {
  return !audioEnabled || (!midiLoading && !timeline) ||
    (context?.state === "running" && synth !== null);
}

function updatePlaybackHint(message = midiStatus?.textContent ?? "") {
  if (midiPlaybackHint) {
    midiPlaybackHint.hidden = !statusIsError;
    midiPlaybackHint.textContent = statusIsError ? message : "";
  }
}

function status(message: string, error = false) {
  statusIsError = error;
  if (midiStatus) midiStatus.textContent = message;
  updatePlaybackHint(message);
}

function stopVoices() {
  synth?.stop();
}

function disposeSynth() {
  synthRequest++;
  synthLoading = false;
  synth?.dispose();
  synth = null;
}

function initializeAudioContext() {
  context ??= new AudioContext();
  if (master) return;
  master = context.createGain();
  master.gain.value = Number(midiVolumeInput?.value ?? 60) / 100;
  const limiter = context.createDynamicsCompressor();
  master.connect(limiter);
  limiter.connect(context.destination);
  context.addEventListener('statechange', () => {
    if (!audioEnabled) return;
    if (context?.state === 'running') {
      status(timeline ? `${loadedDescription}. Following drill playback.` : "Audio enabled. Loading MIDI.");
      updatePlayback();
    } else {
      stopVoices();
      timeline?.reset();
      status("Music is waiting for browser permission. Press Play to start; a click, trigger, or pinch can enable audio permission without starting playback.");
    }
  });
}

export function unlockMidiAudio() {
  if (!audioEnabled || enablingAudio || context?.state === "running") return;
  void enableAudio(true);
}

export function connectMidiXRSession(session: XRSession) {
  const unlock = () => unlockMidiAudio();
  session.addEventListener('selectstart', unlock);
  session.addEventListener('selectend', unlock);
  session.addEventListener('squeezestart', unlock);
  session.addEventListener('end', () => {
    session.removeEventListener('selectstart', unlock);
    session.removeEventListener('selectend', unlock);
    session.removeEventListener('squeezestart', unlock);
  }, { once: true });
  unlockMidiAudio();
}

async function enableAudio(automatic = false) {
  if (enablingAudio) return;
  enablingAudio = true;
  if (midiAudioButton) midiAudioButton.disabled = true;
  try {
    initializeAudioContext();
    const audioContext = context;
    if (!audioContext) throw new Error("Audio context is unavailable.");
    await audioContext.resume();
    if (audioContext.state !== "running") throw new Error("Browser audio is suspended.");
    audioEnabled = true;
    if (midiAudioButton) midiAudioButton.textContent = "Mute MIDI audio";
    status(timeline ? `${loadedDescription}. Following drill playback.` : "Audio enabled. Loading or importing MIDI will play with the drill.");
    timeline?.reset();
    if (!synth && midiNotes.length && !synthLoading) await prepareSynth();
    else updatePlayback();
  } catch (error) {
    if (!automatic) audioEnabled = false;
    if (midiAudioButton) midiAudioButton.textContent = audioEnabled ? "Mute MIDI audio" : "Enable MIDI audio";
    status(`Could not enable audio: ${error instanceof Error ? error.message : String(error)}. ${
      automatic ? "Interact with the field or trigger/pinch in XR to retry." : "Enable MIDI audio to retry."}`, true);
  } finally {
    enablingAudio = false;
    if (midiAudioButton) midiAudioButton.disabled = false;
  }
}

async function prepareSynth() {
  disposeSynth();
  const request = synthRequest;
  if (!context || !master || !midiNotes.length) return;
  synthLoading = true;
  const pending = new SampledMidiSynth(context, master,
    message => { if (request === synthRequest) status(message); });
  try {
    await pending.load(midiNotes);
    if (request !== synthRequest) {
      pending.dispose();
      return;
    }
    synth = pending;
    synthLoading = false;
    timeline?.reset();
    status(`${loadedDescription}. Sampled General MIDI ready.`);
    updatePlayback();
  } catch (error) {
    pending.dispose();
    if (request !== synthRequest) return;
    audioEnabled = false;
    if (midiAudioButton) midiAudioButton.textContent = "Enable MIDI audio";
    status(`Could not load instrument samples: ${error instanceof Error ? error.message : String(error)}. Check your connection and enable audio to retry.`, true);
  } finally {
    if (request === synthRequest) synthLoading = false;
  }
}

function updatePlayback() {
  if (!context || context.state !== "running" || !audioEnabled || !timeline || !synth) {
    stopVoices();
    timeline?.reset();
    return;
  }
  const plan = timeline.update(getMusicTransportState(), context.currentTime);
  if (plan.reset) stopVoices();
  plan.scheduled.forEach(note => synth!.start(note));
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
  midiLoading = true;
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
    const beatUnits = midiBeatUnits(midi.header.timeSignatures, midi.header.ppq);
    if (beatUnits.some(unit => !Number.isFinite(unit.beat) || unit.beat < 0 ||
      !Number.isFinite(unit.quarterNotesPerPulse) || unit.quarterNotesPerPulse <= 0)) {
      throw new Error("The MIDI file contains invalid time signatures.");
    }
    const tempoMap = midi.header.tempos.length
      ? midi.header.tempos.map(tempo => ({ beat: tempo.ticks / midi.header.ppq, bpm: tempo.bpm }))
      : [{ beat: 0, bpm: 120 }];
    if (tempoMap.some(tempo => !Number.isFinite(tempo.beat) || tempo.beat < 0 ||
      !Number.isFinite(tempo.bpm) || tempo.bpm <= 0)) {
      throw new Error("The MIDI file contains invalid tempo events.");
    }
    const musicTracks = midi.tracks.filter(track => track.notes.length);
    const notes: MidiNote[] = musicTracks.flatMap(track => track.notes.map(note => ({
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
    disposeSynth();
    midiNotes = notes;
    timeline = new MidiTimeline(notes);
    const beats = notes.reduce((last, n) => Math.max(last, n.beat + n.duration), 0);
    setPlaybackTempoMap(tempoMap, midi.header.ppq);
    setPlaybackBeatUnits(beatUnits);
    setPlaybackSongLength(beats);
    loadedDescription = `${name}: ${musicTracks.length} parts, ${notes.length} notes, ${Math.ceil(beats)} beats`;
    setMidiScoreTracks(musicTracks.map((track, index) => ({
      name: `${index + 1}. ${track.name || track.instrument.name}`,
      percussion: track.instrument.percussion,
      notes: track.notes.map(note =>
        quantizeScoreNote(note.ticks / midi.header.ppq, note.durationTicks / midi.header.ppq, note.midi)),
    })));
    status(`${loadedDescription}. ${audioEnabled
      ? context?.state === "running" ? "Following drill playback." : "MIDI audio is enabled. Click, tap, or press a key to start sound."
      : "Enable MIDI audio to hear it."}`);
    if (midiClearButton) midiClearButton.disabled = false;
    if (audioEnabled) await prepareSynth();
  } catch (error) {
    if (request !== loadRequest) return;
    status(`Could not load MIDI: ${error instanceof Error ? error.message : String(error)}${timeline ? " Previous MIDI retained." : ""}${failureHint}`, true);
  } finally {
    if (request === loadRequest) {
      midiLoading = false;
      updatePlaybackHint();
    }
  }
}

function loadMidiFromUrl(input: string, name = input) {
  return loadMidi(name, () => readMidiUrl(input), " URL servers must allow cross-origin (CORS) downloads.");
}

export function initMidiPlayback() {
  const repeatDrill = document.getElementById('repeatDrill') as HTMLInputElement | null;
  const repeatSong = document.getElementById('repeatSong') as HTMLInputElement | null;
  const updateRepeat = () => setPlaybackRepeat(!!repeatDrill?.checked, !!repeatSong?.checked);
  repeatDrill?.addEventListener('change', updateRepeat);
  repeatSong?.addEventListener('change', updateRepeat);
  initMidiScore();
  try {
    initializeAudioContext();
  } catch (error) {
    audioEnabled = false;
    status(`Could not initialize music audio: ${error instanceof Error ? error.message : String(error)}. Enable MIDI audio to retry.`, true);
  }
  const fileInput = midiFileInput;
  const clearButton = midiClearButton;
  const audioButton = midiAudioButton;
  if (audioButton) audioButton.textContent = audioEnabled ? "Mute MIDI audio" : "Enable MIDI audio";
  const unlockAudio = (event: Event) => {
    if (!event.isTrusted || !audioEnabled || enablingAudio || context?.state === "running") return;
    if (event.target instanceof Node && audioButton?.contains(event.target)) return;
    unlockMidiAudio();
  };
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('pointerup', unlockAudio, true);
  window.addEventListener('touchend', unlockAudio, true);
  window.addEventListener('click', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);
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
    void loadMidiFromUrl(exampleMidiUrl, EXAMPLE_MIDI_DESCRIPTION);
  });
  clearButton?.addEventListener('click', () => {
    loadRequest++;
    midiLoading = false;
    stopVoices();
    disposeSynth();
    midiNotes = [];
    timeline = null;
    setPlaybackTempoMap(null);
    setPlaybackBeatUnits([]);
    setPlaybackSongLength(0);
    loadedDescription = "";
    setMidiScoreTracks([]);
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
  audioButton?.addEventListener('click', () => {
    if (audioEnabled) {
      audioEnabled = false;
      stopVoices();
      timeline?.reset();
      audioButton.textContent = "Enable MIDI audio";
      status("MIDI audio muted.");
      return;
    }
    void enableAudio();
  });
  onDrillTransportChangedObservable.add(updatePlayback);
  const sharedUrl = new URLSearchParams(window.location.search).get("midi");
  if (midiUrlInput) midiUrlInput.value = sharedUrl || new URL(exampleMidiUrl, window.location.href).href;
  void loadMidiFromUrl(sharedUrl || exampleMidiUrl,
    sharedUrl || EXAMPLE_MIDI_DESCRIPTION);
}
