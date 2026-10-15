import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { boundMarcherFootLift, boundMarcherFootTarget, marcherGroundFootPitch,
  marcherSwingFootPitch, marcherSwingLift, solvePlantedMarcherLeg,
  MARCHER_SHOE_FORWARD_OFFSET } from './marcherLegPose';

export const CYCLE_PHASE_SAMPLES = 128;
export const CYCLE_STRIDE_SAMPLES = 45;
export const CYCLE_STRIDE_INCREMENT = 0.02;
export const CYCLE_COMPONENTS = 13;
export const CYCLE_LIFTS = [0.04, 0.16] as const;

export function cycleSole(stride: number, progress: number, swing: boolean, lift: number) {
  const travel = swing ? -0.5 + 3 * progress * progress - 2 * progress ** 3 : 0.5 - progress;
  const hip = new Vector3(0, 0.69, 0);
  const sole = new Vector3(0, swing ? marcherSwingLift(progress, lift) : 0,
    MARCHER_SHOE_FORWARD_OFFSET + stride * travel);
  return boundMarcherFootLift(hip, boundMarcherFootTarget(hip, sole, 0).sole, 0);
}

export function sampleStepCycle(stride: number, progress: number, swing: boolean, lift: number) {
  const hip = new Vector3(0, 0.69, 0);
  const contact = (distance: number) => boundMarcherFootTarget(hip,
    new Vector3(0, 0, MARCHER_SHOE_FORWARD_OFFSET + distance * stride), 0).sole;
  const direction = [0.5, -0.5].some(distance => {
    const sole = contact(distance);
    return sole.z > MARCHER_SHOE_FORWARD_OFFSET && marcherGroundFootPitch(hip, sole, 0) > 0;
  }) ? 1 : undefined;
  let pitch = 0;
  if (swing) {
    const start = progress < 0.5;
    const distance = start ? -0.5 : 0.5;
    const boundary = marcherGroundFootPitch(hip, contact(distance), 0, direction);
    const nearby = marcherGroundFootPitch(hip, contact(distance + (start ? 0.001 : -0.001)), 0, direction);
    const velocity = start ? (boundary - nearby) / 0.001 : (nearby - boundary) / 0.001;
    pitch = marcherSwingFootPitch(progress, boundary, velocity);
  }
  return solvePlantedMarcherLeg(hip, cycleSole(stride, progress, swing, lift), 0, pitch, direction);
}
