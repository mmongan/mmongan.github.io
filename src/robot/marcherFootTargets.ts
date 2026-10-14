import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';

export function marcherSoleInRig(target: Vector3, bodyYaw: number, bodyScale: number): Vector3 {
  const sin = Math.sin(bodyYaw);
  const cos = Math.cos(bodyYaw);
  return new Vector3((target.x * cos - target.z * sin) / bodyScale,
    target.y / bodyScale, (target.x * sin + target.z * cos) / bodyScale);
}

export function marcherFootTarget(
  stepNumber: number,
  progress: number,
  left: boolean,
  landing: (step: number, left: boolean) => Vector3
): Vector3 {
  const leftStance = ((stepNumber % 2) + 2) % 2 === 0;
  if (left === leftStance) return landing(stepNumber, left);
  const from = landing(stepNumber - 1, left);
  const to = landing(stepNumber + 1, left);
  const blend = progress * progress * (3 - 2 * progress);
  return Vector3.Lerp(from, to, blend);
}
