// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DrillTransportState } from '../robot/robot';

export class FootballMusicTransport {
  private offset = 0;
  private revision: number | null = null;
  private revisionOffset = 0;
  private pause: { state: DrillTransportState; time: number; sourceRevision: number } | null = null;

  start(state: DrillTransportState, time: number) {
    this.pause = { state: this.resolve(state, time), time, sourceRevision: state.revision };
  }

  finish(state: DrillTransportState, time: number) {
    if (!this.pause) return;
    const music = this.resolve(state, time);
    this.offset = music.beat - state.beat;
    this.revisionOffset += state.revision - this.pause.sourceRevision;
    this.revision = state.revision;
    this.pause = null;
  }

  reset() {
    this.offset = 0;
    this.revision = null;
    this.revisionOffset = 0;
    this.pause = null;
  }

  resolve(state: DrillTransportState, time: number): DrillTransportState {
    if (this.pause) {
      const { state: music, time: start } = this.pause;
      return { ...music, beat: Math.min(music.lastBeat,
        music.beat + Math.max(0, time - start) * music.beatsPerSecond) };
    }
    if (this.revision !== null && state.revision !== this.revision) this.reset();
    this.revision = state.revision;
    return { ...state, beat: Math.min(state.lastBeat, state.beat + this.offset),
      revision: state.revision - this.revisionOffset };
  }
}
