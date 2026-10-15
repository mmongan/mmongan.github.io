import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { CYCLE_COMPONENTS, CYCLE_LIFTS, CYCLE_PHASE_SAMPLES, CYCLE_STRIDE_INCREMENT,
  CYCLE_STRIDE_SAMPLES, cycleSole } from './marcherStepCycleModel';
import { MARCHER_THIGH_LENGTH, MARCHER_CALF_LENGTH, MARCHER_SHOE_FORWARD_OFFSET,
  MARCHER_SHOE_HALF_HEIGHT, marcherShoeGroundDepth, marcherShoeRollOffset,
  type solvePlantedMarcherLeg } from './marcherLegPose';
import cycleUrl from './marcherStepCycles.bin?url';

let samples: Float32Array | undefined;
let hits = 0;
let rejected = 0;
export function getMarcherStepCycleStatus() {
  return { ready: samples !== undefined, bytes: samples?.byteLength ?? 0, hits, rejected };
}

export function loadMarcherStepCycles(values: Float32Array) {
  const expected = CYCLE_LIFTS.length * CYCLE_STRIDE_SAMPLES * (CYCLE_PHASE_SAMPLES + 1) * 2 * CYCLE_COMPONENTS;
  if (values.length !== expected || !values.every(Number.isFinite)) {
    throw new Error('Invalid precomputed marcher step-cycle library');
  }
  samples = values;
}

fetch(cycleUrl).then(response => {
  if (!response.ok) throw new Error(`Step-cycle library HTTP ${response.status}`);
  return response.arrayBuffer();
}).then(buffer => loadMarcherStepCycles(new Float32Array(buffer)))
  .catch(error => console.error('Step-cycle library unavailable; using cached live IK.', error));

export function sharedMarcherStepPose(stride: number, progress: number, swing: boolean, lift: number):
  ReturnType<typeof solvePlantedMarcherLeg> | undefined {
  if (!samples || !Number.isFinite(stride) || !Number.isFinite(progress) || progress < 0 || progress > 1) return;
  const strideIndex = stride / CYCLE_STRIDE_INCREMENT + (CYCLE_STRIDE_SAMPLES - 1) / 2;
  if (strideIndex < 0 || strideIndex > CYCLE_STRIDE_SAMPLES - 1) return;
  const liftIndex = lift === 0.04 ? 0 : lift >= 0.11 ? 1 : -1;
  if (liftIndex < 0) return;
  const s0 = Math.min(CYCLE_STRIDE_SAMPLES - 2, Math.floor(strideIndex));
  const p = progress * CYCLE_PHASE_SAMPLES;
  const p0 = Math.min(CYCLE_PHASE_SAMPLES - 1, Math.floor(p));
  const strideBlend = strideIndex - s0;
  const phaseBlend = p - p0;
  const values = new Float64Array(CYCLE_COMPONENTS);
  for (let ds = 0; ds < 2; ds++) {
    for (let dp = 0; dp < 2; dp++) {
      const weight = (ds ? strideBlend : 1 - strideBlend) * (dp ? phaseBlend : 1 - phaseBlend);
      const offset = (((liftIndex * CYCLE_STRIDE_SAMPLES + s0 + ds) *
        (CYCLE_PHASE_SAMPLES + 1) + p0 + dp) * 2 + Number(swing)) * CYCLE_COMPONENTS;
      for (let axis = 0; axis < CYCLE_COMPONENTS; axis++) values[axis] += samples[offset + axis] * weight;
    }
  }
  const legRotation = Quaternion.FromArray(values, 0).normalize();
  const kneeRotation = Quaternion.FromArray(values, 4).normalize();
  const ankleRotation = Quaternion.FromArray(values, 8).normalize();
  const calf = legRotation.multiply(kneeRotation);
  const foot = calf.multiply(ankleRotation);
  const ankle = new Vector3(0, 0.69, 0)
    .add(new Vector3(0, -MARCHER_THIGH_LENGTH, 0).rotateByQuaternionToRef(legRotation, Vector3.Zero()))
    .add(new Vector3(0, -MARCHER_CALF_LENGTH, 0).rotateByQuaternionToRef(calf, Vector3.Zero()));
  const pitch = foot.toEulerAngles().x;
  const sole = ankle.add(new Vector3(0, -MARCHER_SHOE_HALF_HEIGHT, MARCHER_SHOE_FORWARD_OFFSET)
    .rotateByQuaternionToRef(foot, Vector3.Zero()))
    .subtract(new Vector3(0, marcherShoeGroundDepth(pitch), marcherShoeRollOffset(pitch)));
  // Do not trade planted-foot accuracy for cache coverage at contact/roll branch changes.
  if (Vector3.DistanceSquared(sole, cycleSole(stride, progress, swing, lift)) > 1e-8) {
    rejected++;
    return;
  }
  hits++;
  return { thighLength: MARCHER_THIGH_LENGTH, kneeAngle: values[12],
    legRotation, kneeRotation, ankleRotation };
}
