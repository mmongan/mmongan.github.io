import type { DrillTransportState } from '../robot/robot';

export interface MidiNote {
  beat: number;
  duration: number;
  pitch: number;
  velocity: number;
  program: number;
  percussion: boolean;
}

export interface ScheduledMidiNote {
  note: MidiNote;
  delaySeconds: number;
  durationSeconds: number;
}

const LOOKAHEAD_SECONDS = 0.08;
const MAX_CLOCK_DRIFT_SECONDS = 0.1;

// All note times are quarter-note beats; MIDI tempo events never override drill tempo.
export class MidiTimeline {
  private previous: DrillTransportState | null = null;
  private previousTime = 0;
  private cursor = 0;

  constructor(private readonly notes: readonly MidiNote[]) {}

  reset() {
    this.previous = null;
    this.cursor = 0;
  }

  update(state: DrillTransportState, audioTime: number) {
    const audible = state.playing && state.beatsPerSecond > 0 && state.beat < state.lastBeat;
    const previous = this.previous;
    const expectedBeat = previous
      ? previous.beat + (audioTime - this.previousTime) * previous.beatsPerSecond
      : state.beat;
    const reset = !previous || previous.revision !== state.revision ||
      previous.playing !== state.playing || previous.beatsPerSecond !== state.beatsPerSecond ||
      previous.lastBeat !== state.lastBeat ||
      Math.abs(expectedBeat - state.beat) > Math.abs(state.beatsPerSecond) * MAX_CLOCK_DRIFT_SECONDS;
    this.previous = { ...state };
    this.previousTime = audioTime;
    const scheduled: ScheduledMidiNote[] = [];
    if (!audible) return { reset: true, scheduled };
    if (reset) this.cursor = 0;
    const horizon = Math.min(state.lastBeat, state.beat + LOOKAHEAD_SECONDS * state.beatsPerSecond);
    while (this.cursor < this.notes.length && this.notes[this.cursor].beat <= horizon) {
      const note = this.notes[this.cursor++];
      const end = Math.min(state.lastBeat, note.beat + note.duration);
      const start = Math.max(state.beat, note.beat);
      if (end <= start) continue;
      scheduled.push({
        note,
        delaySeconds: (start - state.beat) / state.beatsPerSecond,
        durationSeconds: (end - start) / state.beatsPerSecond,
      });
    }
    return { reset, scheduled };
  }
}
