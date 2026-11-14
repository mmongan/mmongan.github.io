// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Quaternion } from '@babylonjs/core/Maths/math.vector.pure';
import { MARCHER_THIGH_LENGTH, type solvePlantedMarcherLeg } from './marcherLegPose';

type LegPose = ReturnType<typeof solvePlantedMarcherLeg>;
export interface BakedLegPose {
  legs: [LegPose, LegPose];
  hipHalfSpacing: number;
  limited: boolean;
}

const COMPONENTS = 27;
const TOLERANCE = 2e-7;
const MIN_INTERVAL = 1 / 4096;
const MAX_BAKE_BYTES = 128 * 1024 * 1024;
let allocatedBytes = 0;
interface SharedSamples {
  values: Float32Array;
  channels: Uint8Array;
  references: number;
  hash: number;
}
const sharedSamples = new Map<number, SharedSamples[]>();
const stepCycles = new Map<string, { table: BakedLegAnimation; owners: number }>();

export function getStepCycleCacheStatus() {
  let ready = 0;
  let references = 0;
  stepCycles.forEach(entry => {
    ready += entry.table.complete ? 1 : 0;
    references += entry.owners;
  });
  return { uniqueCycles: stepCycles.size, readyCycles: ready, cycleReferences: references };
}

function retainSamples(samples: Float32Array): SharedSamples | undefined {
  // Identity quaternion components and unused axes need no storage.
  const channels = Uint8Array.from(Array.from({ length: COMPONENTS }, (_, index) => index)
    .filter(component => {
      const defaultValue = component < 24 && component % 4 === 3 ? 1 : 0;
      return [0, 1, 2, 3].some(sample => samples[sample * COMPONENTS + component] !== defaultValue);
    }));
  const values = new Float32Array(channels.length * 4);
  for (let sample = 0; sample < 4; sample++) {
    channels.forEach((component, index) => { values[sample * channels.length + index] = samples[sample * COMPONENTS + component]; });
  }
  let hash = 2166136261;
  for (const channel of channels) hash = Math.imul(hash ^ channel, 16777619) >>> 0;
  const bits = new Uint32Array(values.buffer, values.byteOffset, values.length);
  for (const value of bits) hash = Math.imul(hash ^ value, 16777619) >>> 0;
  const bucket = sharedSamples.get(hash) ?? [];
  const existing = bucket.find(item => item.channels.length === channels.length &&
    item.channels.every((channel, index) => channel === channels[index]) &&
    item.values.every((value, index) => value === values[index]));
  if (existing) { existing.references++; return existing; }
  if (allocatedBytes + values.byteLength + channels.byteLength > MAX_BAKE_BYTES) return undefined;
  const item = { values, channels, references: 1, hash };
  bucket.push(item);
  sharedSamples.set(hash, bucket);
  allocatedBytes += values.byteLength + channels.byteLength;
  return item;
}

function releaseSamples(samples: SharedSamples) {
  if (--samples.references > 0) return;
  const bucket = sharedSamples.get(samples.hash)!;
  bucket.splice(bucket.indexOf(samples), 1);
  if (bucket.length === 0) sharedSamples.delete(samples.hash);
  allocatedBytes -= samples.values.byteLength + samples.channels.byteLength;
}

export function getBakedLegAnimationBytes() { return allocatedBytes; }

export class SharedLegBakePool {
  private readonly entries = new Map<string, { table: BakedLegAnimation; owners: number }>();

  acquire(key: string, create: () => BakedLegAnimation, onUnused: (table: BakedLegAnimation) => void) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { table: create(), owners: 0 };
      this.entries.set(key, entry);
    }
    entry.owners++;
    const owned = entry;
    let released = false;
    return {
      table: owned.table,
      release: () => {
        if (released) return;
        released = true;
        if (--owned.owners !== 0) return;
        this.entries.delete(key);
        onUnused(owned.table);
        owned.table.dispose();
      },
    };
  }
}

interface PoseInterval {
  start: number;
  end: number;
  samples: SharedSamples;
  limited: boolean;
}

function pack(pose: BakedLegPose): Float32Array {
  return Float32Array.from([
    ...pose.legs.flatMap(leg => [leg.legRotation, leg.kneeRotation, leg.ankleRotation]
      .flatMap(rotation => rotation.asArray())),
    pose.legs[0].kneeAngle, pose.legs[1].kneeAngle, pose.hipHalfSpacing,
  ], value => Math.abs(value) < 1e-10 ? 0 : value);
}

// Scratch reused by every interpolate/unpack call: playback consumes each
// returned pose immediately (applyLegPose copies the values onto the rig), so
// one shared buffer and pose avoid ~35 allocations per marcher per frame.
// Callers must not retain the result across another poseAt/interpolate call.
const interpolateScratch = new Float64Array(COMPONENTS);
const scratchLeg = (): LegPose => ({
  thighLength: MARCHER_THIGH_LENGTH, kneeAngle: 0,
  legRotation: new Quaternion(), kneeRotation: new Quaternion(), ankleRotation: new Quaternion(),
});
const unpackScratch: BakedLegPose = { legs: [scratchLeg(), scratchLeg()], hipHalfSpacing: 0, limited: false };

function interpolate(samples: Float32Array, progress: number, channels?: Uint8Array): Float64Array {
  const t = progress * 3;
  const weight0 = -(t - 1) * (t - 2) * (t - 3) / 6;
  const weight1 = t * (t - 2) * (t - 3) / 2;
  const weight2 = -t * (t - 1) * (t - 3) / 2;
  const weight3 = t * (t - 1) * (t - 2) / 6;
  const result = interpolateScratch;
  result.fill(0);
  for (let component = 3; component < 24; component += 4) result[component] = 1;
  const stride = channels?.length ?? COMPONENTS;
  for (let index = 0; index < stride; index++) {
    const component = channels ? channels[index] : index;
    result[component] = weight0 * samples[index] + weight1 * samples[stride + index] +
      weight2 * samples[2 * stride + index] + weight3 * samples[3 * stride + index];
  }
  for (let offset = 0; offset < 24; offset += 4) {
    const length = Math.sqrt(result[offset] ** 2 + result[offset + 1] ** 2 +
      result[offset + 2] ** 2 + result[offset + 3] ** 2);
    for (let component = offset; component < offset + 4; component++) result[component] /= length;
  }
  return result;
}

function unpack(values: Float64Array, limited: boolean): BakedLegPose {
  for (const [index, offset, knee] of [[0, 0, 24], [1, 12, 25]] as const) {
    const leg = unpackScratch.legs[index];
    leg.kneeAngle = Math.max(0, Math.min(1.35, values[knee]));
    leg.legRotation.copyFromFloats(values[offset], values[offset + 1], values[offset + 2], values[offset + 3]);
    leg.kneeRotation.copyFromFloats(values[offset + 4], values[offset + 5], values[offset + 6], values[offset + 7]);
    leg.ankleRotation.copyFromFloats(values[offset + 8], values[offset + 9], values[offset + 10], values[offset + 11]);
  }
  unpackScratch.hipHalfSpacing = values[26];
  unpackScratch.limited = limited;
  return unpackScratch;
}

// Musical-count curves are built cooperatively; unresolved or discontinuous intervals use live IK.
export class BakedLegAnimation {
  private readonly intervals = new Map<number, PoseInterval[]>();
  private readonly finishedCounts = new Set<number>();
  private readonly work: Generator<void>;
  private bytes = 0;
  private disposed = false;
  private readonly cycles = new Map<number, { table: BakedLegAnimation; key: string }>();
  reusedCycles = 0;
  complete = false;
  memoryLimited = false;
  completedCounts = 0;
  fallbackIntervals = 0;

  constructor(readonly lastCount: number, sample: (beat: number) => BakedLegPose | undefined,
    firstCount = 0, cycleKey?: (count: number) => string | undefined) {
    this.work = this.build(sample, firstCount, cycleKey);
  }

  get byteLength(): number {
    return this.bytes + Array.from(this.cycles.values()).reduce((sum, cycle) => sum + cycle.table.byteLength, 0);
  }

  advance() {
    if (this.disposed || this.complete) return;
    this.complete = this.work.next().done === true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.work.return(undefined);
    this.intervals.forEach(intervals => intervals.forEach(interval => releaseSamples(interval.samples)));
    this.intervals.clear();
    this.finishedCounts.clear();
    this.cycles.forEach(cycle => {
      const entry = stepCycles.get(cycle.key)!;
      if (--entry.owners === 0) {
        stepCycles.delete(cycle.key);
        entry.table.dispose();
      }
    });
    this.cycles.clear();
    this.bytes = 0;
  }

  poseAt(beat: number): BakedLegPose | undefined {
    const cycle = this.cycles.get(Math.floor(beat));
    if (cycle) return cycle.table.poseAt(beat - Math.floor(beat));
    const intervals = this.intervals.get(Math.floor(beat));
    const interval = intervals?.find(item => beat >= item.start && beat < item.end);
    if (!interval) return undefined;
    return unpack(interpolate(interval.samples.values, (beat - interval.start) / (interval.end - interval.start),
      interval.samples.channels),
      interval.limited);
  }

  fallbackReasonAt(beat: number): 'pending' | 'accuracy' | 'memory' {
    const count = Math.floor(beat);
    const cycle = this.cycles.get(count);
    if (cycle) return cycle.table.fallbackReasonAt(beat - count);
    if (this.finishedCounts.has(count)) return 'accuracy';
    return this.memoryLimited ? 'memory' : 'pending';
  }

  private *build(sample: (beat: number) => BakedLegPose | undefined, firstCount: number,
    cycleKey?: (count: number) => string | undefined): Generator<void> {
    for (let ordinal = 0; ordinal < this.lastCount; ordinal++) {
      const count = (Math.max(0, Math.min(this.lastCount - 1, Math.floor(firstCount))) + ordinal) % this.lastCount;
      const key = cycleKey?.(count);
      if (key !== undefined) {
        let entry = stepCycles.get(key);
        if (!entry) {
          entry = { table: new BakedLegAnimation(1, beat => sample(count + beat)), owners: 0 };
          stepCycles.set(key, entry);
        } else this.reusedCycles++;
        entry.owners++;
        this.cycles.set(count, { key, table: entry.table });
        while (!entry.table.complete) {
          entry.table.advance();
          yield;
        }
        this.fallbackIntervals += entry.table.fallbackIntervals;
        this.memoryLimited = entry.table.memoryLimited;
        this.completedCounts = ordinal + 1;
        if (!this.memoryLimited) this.finishedCounts.add(count);
        if (this.memoryLimited) return;
        continue;
      }
      const intervals: PoseInterval[] = [];
      this.intervals.set(count, intervals);
      const evaluate = function* (beat: number): Generator<void, BakedLegPose | undefined> {
        const pose = sample(beat);
        yield;
        return pose;
      };
      const subdivide = function* (this: BakedLegAnimation, start: number, end: number): Generator<void> {
        if (this.memoryLimited) return;
        const poses: BakedLegPose[] = [];
        for (let index = 0; index < 4; index++) {
          // Segment boundaries can change cadence or halt; never interpolate across them.
          const beat = Math.min(end - 1e-10, start + (end - start) * index / 3);
          const pose = yield* evaluate(beat);
          if (!pose) {
            this.fallbackIntervals++;
            return;
          }
          poses.push(pose);
        }
        const samples = new Float32Array(COMPONENTS * 4);
        poses.forEach((pose, index) => {
          const values = pack(pose);
          if (index > 0) {
            for (let offset = 0; offset < 24; offset += 4) {
              let dot = 0;
              for (let axis = 0; axis < 4; axis++) dot += samples[offset + axis] * values[offset + axis];
              if (dot < 0) for (let axis = 0; axis < 4; axis++) values[offset + axis] *= -1;
            }
          }
          samples.set(values, index * COMPONENTS);
        });
        let valid = poses.every(pose => pose.limited === poses[0].limited);
        for (const progress of [0.125, 0.25, 0.5, 0.75, 0.875]) {
          const exact = yield* evaluate(start + (end - start) * progress);
          if (!exact) { valid = false; break; }
          const expected = pack(exact);
          const actual = interpolate(samples, progress);
          for (let offset = 0; offset < 24; offset += 4) {
            let dot = 0;
            for (let axis = 0; axis < 4; axis++) dot += actual[offset + axis] * expected[offset + axis];
            if (dot < 0) for (let axis = 0; axis < 4; axis++) expected[offset + axis] *= -1;
          }
          if (exact.limited !== poses[0].limited ||
            actual.some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) > TOLERANCE)) {
            valid = false;
            break;
          }
        }
        if (!valid) {
          if (end - start <= MIN_INTERVAL) { this.fallbackIntervals++; return; }
          const middle = (start + end) / 2;
          yield* subdivide.call(this, start, middle);
          yield* subdivide.call(this, middle, end);
          return;
        }
        const retained = retainSamples(samples);
        if (!retained) {
          this.memoryLimited = true;
          return;
        }
        intervals.push({ start, end, samples: retained, limited: poses[0].limited });
        this.bytes += retained.values.byteLength + retained.channels.byteLength;
      };
      for (let quarter = 0; quarter < 4 && !this.memoryLimited; quarter++) {
        yield* subdivide.call(this, count + quarter / 4, count + (quarter + 1) / 4);
      }
      this.completedCounts = ordinal + 1;
      if (!this.memoryLimited) this.finishedCounts.add(count);
      if (this.memoryLimited) {
        console.warn('Leg animation bake reached its shared 128 MiB budget; remaining poses use live IK.');
        return;
      }
    }
  }
}
