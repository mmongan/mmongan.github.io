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
interface SharedSamples { values: Float32Array; references: number; hash: number }
const sharedSamples = new Map<number, SharedSamples[]>();

function retainSamples(values: Float32Array): SharedSamples | undefined {
  let hash = 2166136261;
  const bits = new Uint32Array(values.buffer, values.byteOffset, values.length);
  for (const value of bits) hash = Math.imul(hash ^ value, 16777619) >>> 0;
  const bucket = sharedSamples.get(hash) ?? [];
  const existing = bucket.find(item => item.values.every((value, index) => value === values[index]));
  if (existing) { existing.references++; return existing; }
  if (allocatedBytes + values.byteLength > MAX_BAKE_BYTES) return undefined;
  const item = { values, references: 1, hash };
  bucket.push(item);
  sharedSamples.set(hash, bucket);
  allocatedBytes += values.byteLength;
  return item;
}

function releaseSamples(samples: SharedSamples) {
  if (--samples.references > 0) return;
  const bucket = sharedSamples.get(samples.hash)!;
  bucket.splice(bucket.indexOf(samples), 1);
  if (bucket.length === 0) sharedSamples.delete(samples.hash);
  allocatedBytes -= samples.values.byteLength;
}

export function getBakedLegAnimationBytes() { return allocatedBytes; }

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
  ]);
}

function interpolate(samples: Float32Array, progress: number): Float64Array {
  const t = progress * 3;
  const weights = [
    -(t - 1) * (t - 2) * (t - 3) / 6,
    t * (t - 2) * (t - 3) / 2,
    -t * (t - 1) * (t - 3) / 2,
    t * (t - 1) * (t - 2) / 6,
  ];
  const result = new Float64Array(COMPONENTS);
  for (let component = 0; component < COMPONENTS; component++) {
    for (let sample = 0; sample < 4; sample++) {
      result[component] += weights[sample] * samples[sample * COMPONENTS + component];
    }
  }
  for (let offset = 0; offset < 24; offset += 4) {
    const length = Math.hypot(...result.subarray(offset, offset + 4));
    for (let component = offset; component < offset + 4; component++) result[component] /= length;
  }
  return result;
}

function unpack(values: Float64Array, limited: boolean): BakedLegPose {
  const leg = (offset: number, knee: number): LegPose => ({
    thighLength: MARCHER_THIGH_LENGTH,
    kneeAngle: Math.max(0, Math.min(1.35, values[knee])),
    legRotation: Quaternion.FromArray(values, offset),
    kneeRotation: Quaternion.FromArray(values, offset + 4),
    ankleRotation: Quaternion.FromArray(values, offset + 8),
  });
  return { legs: [leg(0, 24), leg(12, 25)], hipHalfSpacing: values[26], limited };
}

// Musical-count curves are built cooperatively; unresolved or discontinuous intervals use live IK.
export class BakedLegAnimation {
  private readonly intervals = new Map<number, PoseInterval[]>();
  private readonly work: Generator<void>;
  private bytes = 0;
  private disposed = false;
  complete = false;
  memoryLimited = false;
  completedCounts = 0;
  fallbackIntervals = 0;

  constructor(readonly lastCount: number, sample: (beat: number) => BakedLegPose | undefined,
    firstCount = 0) {
    this.work = this.build(sample, firstCount);
  }

  get byteLength() { return this.bytes; }

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
    this.bytes = 0;
  }

  poseAt(beat: number): BakedLegPose | undefined {
    const intervals = this.intervals.get(Math.floor(beat));
    const interval = intervals?.find(item => beat >= item.start && beat < item.end);
    if (!interval) return undefined;
    return unpack(interpolate(interval.samples.values, (beat - interval.start) / (interval.end - interval.start)),
      interval.limited);
  }

  private *build(sample: (beat: number) => BakedLegPose | undefined, firstCount: number): Generator<void> {
    for (let ordinal = 0; ordinal < this.lastCount; ordinal++) {
      const count = (Math.max(0, Math.min(this.lastCount - 1, Math.floor(firstCount))) + ordinal) % this.lastCount;
      const intervals: PoseInterval[] = [];
      this.intervals.set(count, intervals);
      const evaluate = function* (beat: number): Generator<void, BakedLegPose | undefined> {
        const pose = sample(beat);
        yield;
        return pose;
      };
      const subdivide = function* (this: BakedLegAnimation, start: number, end: number): Generator<void> {
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
        this.bytes += samples.byteLength;
      };
      for (let quarter = 0; quarter < 4 && !this.memoryLimited; quarter++) {
        yield* subdivide.call(this, count + quarter / 4, count + (quarter + 1) / 4);
      }
      this.completedCounts = ordinal + 1;
      if (this.memoryLimited) {
        console.warn('Leg animation bake reached its shared 128 MiB budget; remaining poses use live IK.');
        return;
      }
    }
  }
}
