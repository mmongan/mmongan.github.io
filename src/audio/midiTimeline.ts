// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

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
  startTimeSeconds?: number;
}

const LOOKAHEAD_SECONDS = 0.3;
const SCHEDULING_LEAD_SECONDS = 0.03;
const MAX_CLOCK_DRIFT_SECONDS = 0.1;

// Note times are quarter-note beats, shared with the MIDI-driven playback tempo.
export class MidiTimeline {
  private previous: DrillTransportState | null = null;
  private previousTime = 0;
  private cursor = 0;
  private clockState: DrillTransportState | null = null;
  private clockTime = 0;

  constructor(private readonly notes: readonly MidiNote[]) {}

  reset() {
    this.previous = null;
    this.cursor = 0;
    this.clockState = null;
  }

  synchronize(state: DrillTransportState, audioTime: number) {
    this.clockState = { ...state };
    this.clockTime = audioTime;
    return this.update(state, audioTime);
  }

  tick(audioTime: number) {
    const state = this.clockState;
    if (!state) return { reset: false, scheduled: [] as ScheduledMidiNote[] };
    const elapsed = state.playing ? Math.max(0, audioTime - this.clockTime) : 0;
    return this.update({ ...state, beat: Math.max(0, Math.min(state.lastBeat,
      state.beat + elapsed * state.beatsPerSecond)) }, audioTime);
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
        startTimeSeconds: audioTime + SCHEDULING_LEAD_SECONDS + (start - state.beat) / state.beatsPerSecond,
        durationSeconds: (end - start) / state.beatsPerSecond,
      });
    }
    return { reset, scheduled };
  }
}
