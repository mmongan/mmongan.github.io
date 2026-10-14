import { Soundfont, getSoundfontNames, type StopFn } from 'smplr';
import { instrumentByPatchID } from '@tonejs/midi/dist/InstrumentMaps';
import type { MidiNote, ScheduledMidiNote } from './midiTimeline';

const SAMPLE_BASE_URL = "https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM/";
const MAX_VOICES = 64;

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
  private instruments = new Map<string, Soundfont>();
  private voices = new Set<StopFn>();
  private disposed = false;
  private nextVoiceId = 0;

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
    try {
      for (const [name, required] of pitches) {
        if (this.disposed) throw new Error("Sample loading was cancelled.");
        this.report(`Loading sampled instrument: ${name.replace(/_/g, ' ')}…`);
        const instrument = Soundfont(this.context, {
          instrumentUrl: `${SAMPLE_BASE_URL}${name}-mp3.js`,
          loadLoopData: false,
          destination: this.destination,
          volume: 100,
          notesToLoad: { notes: [...required], fallback: "none" },
        });
        this.instruments.set(name, instrument);
        await instrument.ready;
        if (this.disposed) {
          instrument.dispose();
          throw new Error("Sample loading was cancelled.");
        }
        if (instrument.loadProgress.total === 0) throw new Error(`No samples loaded for ${name}.`);
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  start({ note, delaySeconds, durationSeconds }: ScheduledMidiNote) {
    const instrument = this.instruments.get(instrumentKey(note));
    if (!instrument || this.disposed) throw new Error("MIDI instrument samples are not ready.");
    if (this.voices.size >= MAX_VOICES) {
      this.report("64-voice limit reached; some MIDI notes were omitted.");
      return;
    }
    const stop = instrument.start({
      note: note.pitch,
      velocity: Math.max(1, Math.round(note.velocity * 127)),
      time: this.context.currentTime + delaySeconds,
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
    this.stop();
    this.instruments.forEach(instrument => instrument.dispose());
    this.instruments.clear();
  }
}
