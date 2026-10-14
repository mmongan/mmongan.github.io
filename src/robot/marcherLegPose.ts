import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';

export const MARCHER_THIGH_LENGTH = 0.315;
export const MARCHER_CALF_LENGTH = 0.315;
export const MARCHER_SHOE_FORWARD_OFFSET = 0.055;
export const MARCHER_SHOE_HALF_HEIGHT = 0.03;
export const MARCHER_MAX_FOOT_REACH = 0.24;
const MAX_KNEE_FLEXION = 1.35;
const MAX_LEG_REACH = MARCHER_THIGH_LENGTH + MARCHER_CALF_LENGTH;
const MIN_LEG_REACH = Math.sqrt(MARCHER_THIGH_LENGTH ** 2 + MARCHER_CALF_LENGTH ** 2 +
  2 * MARCHER_THIGH_LENGTH * MARCHER_CALF_LENGTH * Math.cos(MAX_KNEE_FLEXION));

function ankleAtSole(sole: Vector3, facingYaw: number): Vector3 {
  return sole.add(new Vector3(-MARCHER_SHOE_FORWARD_OFFSET * Math.sin(facingYaw), 2 * MARCHER_SHOE_HALF_HEIGHT,
    -MARCHER_SHOE_FORWARD_OFFSET * Math.cos(facingYaw)));
}

export function boundMarcherFootTarget(hip: Vector3, sole: Vector3, facingYaw: number) {
  const ankle = ankleAtSole(sole, facingYaw);
  const horizontal = new Vector3(ankle.x - hip.x, 0, ankle.z - hip.z);
  const forward = horizontal.x * Math.sin(facingYaw) + horizontal.z * Math.cos(facingYaw);
  const lateral = horizontal.x * Math.cos(facingYaw) - horizontal.z * Math.sin(facingYaw);
  const reachRatio = Math.hypot(forward / MARCHER_MAX_FOOT_REACH, lateral / 0.27);
  const limited = reachRatio > 1 + 1e-6;
  if (limited) {
    horizontal.scaleInPlace(1 / reachRatio);
    sole = sole.add(new Vector3(hip.x + horizontal.x - ankle.x, 0, hip.z + horizontal.z - ankle.z));
  }
  return { sole, limited };
}

export function boundMarcherFootLift(hip: Vector3, sole: Vector3, facingYaw: number): Vector3 {
  const ankle = ankleAtSole(sole, facingYaw);
  const horizontalSquared = (ankle.x - hip.x) ** 2 + (ankle.z - hip.z) ** 2;
  const maxLift = hip.y - 2 * MARCHER_SHOE_HALF_HEIGHT - Math.sqrt(Math.max(0, MIN_LEG_REACH ** 2 - horizontalSquared));
  return new Vector3(sole.x, Math.min(sole.y, maxLift), sole.z);
}

export function marcherShoeGroundDepth(pitch: number): number {
  const sin = Math.abs(Math.sin(pitch));
  const cos = Math.cos(pitch);
  return Math.max(MARCHER_SHOE_HALF_HEIGHT * cos + 0.055 * sin,
    0.0225 * cos + 0.095 * sin, 0.105 * sin);
}

export function solvePlantedMarcherLeg(
  hip: Vector3, sole: Vector3, facingYaw: number
) {
  const ankleForPitch = (pitch: number) => {
    const rotation = Quaternion.FromEulerAngles(pitch, facingYaw, 0);
    const offset = new Vector3(0, -MARCHER_SHOE_HALF_HEIGHT, MARCHER_SHOE_FORWARD_OFFSET)
      .rotateByQuaternionToRef(rotation, Vector3.Zero());
    return sole.subtract(offset).add(new Vector3(0, marcherShoeGroundDepth(pitch), 0));
  };
  const neutralAnkle = ankleAtSole(sole, facingYaw);
  const forwardDistance = (neutralAnkle.x - hip.x) * Math.sin(facingYaw) +
    (neutralAnkle.z - hip.z) * Math.cos(facingYaw);
  let sign = forwardDistance >= 0 ? 1 : -1;
  let pitch = 0;
  let ankle = ankleForPitch(pitch);
  if (Vector3.Distance(hip, ankle) > MAX_LEG_REACH) {
    let low = 0;
    let high = 0;
    for (let sample = 1; sample <= 100; sample++) {
      high = sample * 0.012;
      if (Vector3.Distance(hip, ankleForPitch(sign * high)) <= MAX_LEG_REACH) break;
      low = high;
    }
    if (Vector3.Distance(hip, ankleForPitch(sign * high)) > MAX_LEG_REACH) {
      sign = -sign;
      low = 0;
      for (let sample = 1; sample <= 100; sample++) {
        high = sample * 0.012;
        if (Vector3.Distance(hip, ankleForPitch(sign * high)) <= MAX_LEG_REACH) break;
        low = high;
      }
    }
    if (Vector3.Distance(hip, ankleForPitch(sign * high)) > MAX_LEG_REACH + 1e-6) {
      throw new RangeError('Marcher foot target exceeds upright leg and ankle reach');
    }
    for (let iteration = 0; iteration < 24; iteration++) {
      const middle = (low + high) / 2;
      if (Vector3.Distance(hip, ankleForPitch(sign * middle)) > MAX_LEG_REACH) low = middle;
      else high = middle;
    }
    pitch = sign * high;
    ankle = ankleForPitch(pitch);
  }
  const footRotation = Quaternion.FromEulerAngles(pitch, facingYaw, 0);
  const delta = ankle.subtract(hip);
  const distance = delta.length();
  if (!Number.isFinite(distance) || distance < MIN_LEG_REACH - 1e-6 || distance > MAX_LEG_REACH + 1e-6) {
    throw new RangeError(`Marcher foot target exceeds fixed leg reach: ${distance}`);
  }
  const direction = delta.scale(1 / distance);
  const thighLength = MARCHER_THIGH_LENGTH;
  const calfLength = MARCHER_CALF_LENGTH;
  const kneeAngle = Math.acos(Math.max(-1, Math.min(1,
    (distance ** 2 - thighLength ** 2 - calfLength ** 2) / (2 * thighLength * calfLength))));
  const along = (thighLength * thighLength + distance * distance - calfLength * calfLength) /
    (2 * distance);
  const forward = new Vector3(Math.sin(facingYaw), 0, Math.cos(facingYaw));
  const pole = forward.subtract(direction.scale(Vector3.Dot(forward, direction))).normalize();
  const knee = hip.add(direction.scale(along))
    .add(pole.scale(Math.sqrt(Math.max(0, thighLength * thighLength - along * along))));
  const upperDirection = knee.subtract(hip).normalize();
  const lowerDirection = ankle.subtract(knee).normalize();
  const legRotation = Quaternion.FromUnitVectorsToRef(Vector3.Down(), upperDirection, Quaternion.Identity());
  const calfRotation = Quaternion.FromUnitVectorsToRef(Vector3.Down(), lowerDirection, Quaternion.Identity());
  const inverseLeg = legRotation.conjugate();
  const kneeRotation = inverseLeg.multiply(calfRotation);
  const ankleRotation = calfRotation.conjugate().multiply(footRotation);
  return { thighLength, kneeAngle, legRotation, kneeRotation, ankleRotation };
}
