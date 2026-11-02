// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Zero-order hold deliberately avoids interpolating independently separated
// capsules through one another. Every displayed frame was solved as a whole team.
export const FOOTBALL_ANIMATION_SAMPLES_PER_COUNT = 32;
export const FOOTBALL_ANIMATION_MAX_BYTES = 512 * 1024 * 1024;
let allocatedFootballBytes = 0;

export class FootballAnimationCache {
  private frames: Float64Array | null = null;
  private times: Float64Array | null = null;
  private completed = 0;
  readonly frameCount: number;
  readonly byteLength: number;
  constructor(readonly lastCount: number, readonly channels: number,
    private readonly sample: (beat: number) => readonly number[], extraBeats: readonly number[] = []) {
    if (!Number.isInteger(lastCount) || lastCount < 0 || !Number.isInteger(channels) || channels < 1) {
      throw new Error('Football preparation requires a finite whole-count route and complete pose channels.');
    }
    const baseCount = lastCount * FOOTBALL_ANIMATION_SAMPLES_PER_COUNT + 1;
    const minimumBytes = baseCount * (channels + 1) * Float64Array.BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(minimumBytes) || minimumBytes + allocatedFootballBytes > FOOTBALL_ANIMATION_MAX_BYTES) {
      throw new Error(`Football animation exceeds the ${FOOTBALL_ANIMATION_MAX_BYTES / 1024 / 1024} MiB preparation limit. Shorten the sequence before Play.`);
    }
    const times = [...new Set([...Array.from({ length: baseCount }, (_, index) => index / FOOTBALL_ANIMATION_SAMPLES_PER_COUNT),
      ...extraBeats.filter(beat => Number.isFinite(beat) && beat >= 0 && beat <= lastCount)])].sort((a, b) => a - b);
    this.frameCount = times.length;
    this.byteLength = this.frameCount * (channels + 1) * Float64Array.BYTES_PER_ELEMENT;
    if (this.byteLength + allocatedFootballBytes > FOOTBALL_ANIMATION_MAX_BYTES) {
      throw new Error('Football event keyframes exceed the 512 MiB preparation limit. Shorten the sequence before Play.');
    }
    try {
      this.times = Float64Array.from(times);
      this.frames = new Float64Array(this.frameCount * channels);
      allocatedFootballBytes += this.byteLength;
    }
    catch { throw new Error('Not enough memory to prepare football animation. Shorten the sequence before Play.'); }
  }
  get ready() { return !!this.frames && this.completed === this.frameCount; }
  get progress() { return this.completed / this.frameCount; }
  advance(frameBudget = 16) {
    if (!this.frames) throw new Error('Football animation cache has been disposed.');
    for (let step = 0; step < frameBudget && this.completed < this.frameCount; step++) {
      const beat = this.times![this.completed];
      const values = this.sample(beat);
      if (values.length !== this.channels || values.some(value => !Number.isFinite(value))) {
        throw new Error(`Football preparation produced an invalid pose at count ${beat}.`);
      }
      this.frames.set(values, this.completed * this.channels);
      this.completed++;
    }
  }
  frameAt(beat: number) {
    if (!this.ready || !this.frames || !Number.isFinite(beat)) return null;
    const index = this.indexAt(beat);
    return this.frames.subarray(index * this.channels, (index + 1) * this.channels);
  }
  sampledBeat(beat: number) {
    return this.times?.[this.indexAt(beat)] ?? 0;
  }
  private indexAt(beat: number) {
    const time = Math.max(0, Math.min(this.lastCount, beat));
    let low = 0, high = this.frameCount;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.times![middle] <= time) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }
  dispose() {
    if (this.frames) allocatedFootballBytes -= this.byteLength;
    this.frames = null; this.times = null;
  }
}
