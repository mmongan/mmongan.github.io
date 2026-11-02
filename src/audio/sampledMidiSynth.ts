// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Sampler, getSoundfontNames, type StopFn } from 'smplr';
import { instrumentByPatchID } from '@tonejs/midi/dist/InstrumentMaps';
import type { MidiNote, ScheduledMidiNote } from './midiTimeline';
import type { SoundfontRequest, SoundfontResponse, SoundfontSample } from './soundfontWorker';

const SAMPLE_BASE_URL = "https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM/";
const MAX_VOICES = 64;
// Matches the extraGain the Soundfont loader applies to MIDI.js samples.
const SOUNDFONT_EXTRA_GAIN = 5;

// Decoded samples are assembled between idle periods so preloading cannot
// starve scene rendering of main-thread time while it runs.
const whenIdle = () => new Promise<void>(resolve => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 500 });
  else setTimeout(resolve, 50);
});

const createSoundfontWorker = () => new Worker(new URL('./soundfontWorker.ts', import.meta.url), { type: 'module' });

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiNoteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

const compactName = (name: string) => name.replace(/[^a-z0-9]/g, "");
const sampleNames = new Map(getSoundfontNames().map(name => [compactName(name), name]));

export function instrumentKey(note: MidiNote): string {
  if (note.percussion) return "percussion";
  const patchName = instrumentByPatchID[note.program];
  const aliases: Record<string, string> = { clavi: "clavinet", synthvoice: "synthchoir" };
  const compact = patchName ? compactName(patchName) : "";
  const name = sampleNames.get(aliases[compact] ?? compact);
  if (!name) throw new Error(`Unsupported General MIDI program ${note.program}.`);
  return name;
}

export class SampledMidiSynth {
  private instruments = new Map<string, Sampler>();
  private voices = new Set<StopFn>();
  private disposed = false;
  private nextVoiceId = 0;
  private boost: GainNode | null = null;
  private cancelLoad: ((error: Error) => void) | null = null;

  constructor(private readonly context: AudioContext, private readonly destination: AudioNode,
    private readonly report: (message: string) => void) {}

  async load(notes: readonly MidiNote[]) {
    const pitches = new Map<string, Set<number>>();
    for (const note of notes) {
      const key = instrumentKey(note);
      if (!key) throw new Error(`Unsupported General MIDI program ${note.program}.`);
      const required = pitches.get(key) ?? new Set<number>();
      required.add(note.pitch);
      pitches.set(key, required);
    }
    // The worker downloads, parses, and base64-decodes soundfonts off the
    // main thread; only the required samples return here as binary audio.
    // Multi-megabyte JSON.parse on the main thread freezes standalone XR
    // browsers, so it must never happen here.
    const worker = createSoundfontWorker();
    const cancellation = new Promise<never>((_, reject) => { this.cancelLoad = reject; });
    cancellation.catch(() => {}); // surfaced through the racing awaits below
    try {
      const pending = new Map<number, { resolve: (samples: SoundfontSample[]) => void; reject: (error: Error) => void }>();
      worker.onmessage = (event: MessageEvent<SoundfontResponse>) => {
        const { id, samples, error } = event.data;
        const request = pending.get(id);
        pending.delete(id);
        if (!request) return;
        if (samples) request.resolve(samples);
        else request.reject(new Error(error ?? "Soundfont loading failed."));
      };
      worker.onerror = (event) => {
        const error = new Error(event.message || "The soundfont worker failed.");
        pending.forEach(request => request.reject(error));
        pending.clear();
      };
      // Request every instrument up front so downloads overlap in the worker.
      const requests = new Map<string, Promise<SoundfontSample[]>>();
      let nextRequestId = 0;
      for (const [name, required] of pitches) {
        const id = ++nextRequestId;
        const request = new Promise<SoundfontSample[]>((resolve, reject) => pending.set(id, { resolve, reject }));
        request.catch(() => {}); // surfaced when awaited below
        requests.set(name, request);
        const message: SoundfontRequest = { id, url: `${SAMPLE_BASE_URL}${name}-mp3.js`, pitches: [...required] };
        worker.postMessage(message);
      }
      for (const name of pitches.keys()) {
        await whenIdle();
        if (this.disposed) throw new Error("Sample loading was cancelled.");
        this.report(`Loading sampled instrument: ${name.replace(/_/g, ' ')}…`);
        const samples = await Promise.race([requests.get(name)!, cancellation]);
        if (this.disposed) throw new Error("Sample loading was cancelled.");
        const buffers: Record<string, AudioBuffer> = {};
        for (const sample of samples) {
          try {
            buffers[midiNoteName(sample.pitch)] = await this.context.decodeAudioData(sample.data);
          } catch (error) {
            console.warn(`Failed to decode ${name} sample ${midiNoteName(sample.pitch)}`, error);
          }
        }
        if (this.disposed) throw new Error("Sample loading was cancelled.");
        if (!Object.keys(buffers).length) throw new Error(`No samples loaded for ${name}.`);
        if (!this.boost) {
          this.boost = this.context.createGain();
          this.boost.gain.value = SOUNDFONT_EXTRA_GAIN;
          this.boost.connect(this.destination);
        }
        const instrument = Sampler(this.context, { buffers, destination: this.boost, volume: 100 });
        this.instruments.set(name, instrument);
        await Promise.race([instrument.ready, cancellation]);
        if (this.disposed) throw new Error("Sample loading was cancelled.");
      }
      this.report('All required MIDI instruments preloaded.');
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      this.cancelLoad = null;
      worker.terminate();
    }
  }

  start({ note, delaySeconds, durationSeconds, startTimeSeconds }: ScheduledMidiNote) {
    const instrument = this.instruments.get(instrumentKey(note));
    if (!instrument || this.disposed) throw new Error("MIDI instrument samples are not ready.");
    if (this.voices.size >= MAX_VOICES) {
      this.report("64-voice limit reached; some MIDI notes were omitted.");
      return;
    }
    const stop = instrument.start({
      note: note.pitch,
      velocity: Math.max(1, Math.round(note.velocity * 127)),
      time: startTimeSeconds ?? this.context.currentTime + delaySeconds,
      duration: durationSeconds,
      ampRelease: 0.015,
      stopId: ++this.nextVoiceId,
      onEnded: () => this.voices.delete(stop),
    });
    this.voices.add(stop);
  }

  stop() {
    this.voices.forEach(stop => stop());
    this.instruments.forEach(instrument => instrument.stop());
    this.voices.clear();
  }

  dispose() {
    this.disposed = true;
    this.cancelLoad?.(new Error("Sample loading was cancelled."));
    this.stop();
    this.instruments.forEach(instrument => instrument.dispose());
    this.instruments.clear();
    this.boost?.disconnect();
    this.boost = null;
  }
}
