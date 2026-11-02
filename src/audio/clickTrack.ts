// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Synthesized metronome drum clicks for marching when no MIDI is loaded.
// Reuses the MidiTimeline transport clock so clicks follow play/pause,
// seeks, tempo, and repeats exactly like sampled music would.

import type { DrillTransportState } from '../robot/robot';
import { MidiTimeline, type MidiNote, type ScheduledMidiNote } from './midiTimeline';

const CLICK_SECONDS = 0.05;

// One click per drill count, accented on every fourth count. A note at the
// final transport beat can never sound (ends clamp to lastBeat), so the last
// click falls on the last count strictly before the drill's end.
export function buildClickNotes(lastBeat: number): MidiNote[] {
  const counts = Math.max(1, Math.ceil(lastBeat));
  return Array.from({ length: counts }, (_, beat) => ({
    beat, duration: 0.25, pitch: 37, program: 115, percussion: true,
    velocity: beat % 4 === 0 ? 1 : 0.7,
  }));
}

export class ClickTrack {
  private timeline: MidiTimeline | null = null;
  private countLength = 0;

  constructor(private readonly context: AudioContext, private readonly destination: AudioNode) {}

  synchronize(state: DrillTransportState, audioTime: number) {
    const counts = Math.max(1, Math.ceil(state.lastBeat));
    if (!this.timeline || counts !== this.countLength) {
      this.countLength = counts;
      this.timeline = new MidiTimeline(buildClickNotes(state.lastBeat));
    }
    this.timeline.synchronize(state, audioTime).scheduled.forEach(note => this.click(note, audioTime));
  }

  tick(audioTime: number) {
    this.timeline?.tick(audioTime).scheduled.forEach(note => this.click(note, audioTime));
  }

  reset() {
    this.timeline?.reset();
  }

  private click({ note, delaySeconds, startTimeSeconds }: ScheduledMidiNote, audioTime: number) {
    const time = Math.max(audioTime, startTimeSeconds ?? audioTime + delaySeconds);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const accent = note.velocity >= 1;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(accent ? 2093 : 1568, time);
    gain.gain.setValueAtTime(note.velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + CLICK_SECONDS);
    oscillator.connect(gain);
    gain.connect(this.destination);
    oscillator.start(time);
    oscillator.stop(time + CLICK_SECONDS + 0.01);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
