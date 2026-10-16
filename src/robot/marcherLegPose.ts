import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';

export const MARCHER_THIGH_LENGTH = 0.315;
export const MARCHER_CALF_LENGTH = 0.315;
export const MARCHER_SHOE_FORWARD_OFFSET = 0.055;
export const MARCHER_SHOE_HALF_HEIGHT = 0.03;
export const MARCHER_MAX_FOOT_REACH = 0.22;

export function marcherSoleFromLegPose(hip: Vector3, pose: ReturnType<typeof solvePlantedMarcherLeg>) {
  const calf = pose.legRotation.multiply(pose.kneeRotation);
  const foot = calf.multiply(pose.ankleRotation);
  const sole = hip
    .add(new Vector3(0, -pose.thighLength, 0).rotateByQuaternionToRef(pose.legRotation, Vector3.Zero()))
    .add(new Vector3(0, -MARCHER_CALF_LENGTH, 0).rotateByQuaternionToRef(calf, Vector3.Zero()))
    .add(new Vector3(0, -MARCHER_SHOE_HALF_HEIGHT, MARCHER_SHOE_FORWARD_OFFSET)
      .rotateByQuaternionToRef(foot, Vector3.Zero()));
  const pitch = foot.toEulerAngles().x;
  const forward = new Vector3(0, 0, 1).rotateByQuaternionToRef(foot, Vector3.Zero());
  const yaw = Math.atan2(forward.x, forward.z);
  const roll = marcherShoeRollOffset(pitch);
  return {
    position: sole.subtract(new Vector3(roll * Math.sin(yaw), marcherShoeGroundDepth(pitch), roll * Math.cos(yaw))),
    yaw,
  };
}
const MAX_KNEE_FLEXION = 1.35;
const MAX_LEG_REACH = MARCHER_THIGH_LENGTH + MARCHER_CALF_LENGTH;
const MIN_LEG_REACH = Math.sqrt(MARCHER_THIGH_LENGTH ** 2 + MARCHER_CALF_LENGTH ** 2 +
  2 * MARCHER_THIGH_LENGTH * MARCHER_CALF_LENGTH * Math.cos(MAX_KNEE_FLEXION));

export function marcherSwingLift(progress: number, requestedLift: number): number {
  // Reserve knee reach before shaping the arc, rather than flattening its peak with IK clipping.
  const clearance = 0.95 * (0.69 - 2 * MARCHER_SHOE_HALF_HEIGHT - MIN_LEG_REACH);
  const arc = Math.sin(Math.PI * Math.max(0, Math.min(1, progress)));
  return Math.min(requestedLift, clearance) * arc * arc;
}

function ankleAtSole(sole: Vector3, facingYaw: number): Vector3 {
  return sole.add(new Vector3(-MARCHER_SHOE_FORWARD_OFFSET * Math.sin(facingYaw), 2 * MARCHER_SHOE_HALF_HEIGHT,
    -MARCHER_SHOE_FORWARD_OFFSET * Math.cos(facingYaw)));
}

export function boundMarcherFootTarget(hip: Vector3, sole: Vector3, facingYaw: number) {
  const ankle = ankleAtSole(sole, facingYaw);
  const horizontal = new Vector3(ankle.x - hip.x, 0, ankle.z - hip.z);
  const forward = horizontal.x * Math.sin(facingYaw) + horizontal.z * Math.cos(facingYaw);
  const lateral = horizontal.x * Math.cos(facingYaw) - horizontal.z * Math.sin(facingYaw);
  const reachRatio = Math.hypot(forward / MARCHER_MAX_FOOT_REACH, lateral / MARCHER_MAX_FOOT_REACH);
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
  if (pitch < 0) return Math.max(MARCHER_SHOE_HALF_HEIGHT * cos + 0.075 * sin, 0.085 * sin);
  return Math.max(MARCHER_SHOE_HALF_HEIGHT * cos + 0.055 * sin,
    0.0225 * cos + 0.095 * sin, 0.105 * sin);
}

function shoeArc(height: number, length: number, angle: number): number {
  return height * Math.sin(angle) + length * (1 - Math.cos(angle));
}

const HEEL_CORNER = Math.atan2(0.03, 0.01);
const SOLE_CORNER = Math.atan2(0.0075, 0.04);
const TOE_CORNER = Math.atan2(0.0225, 0.01);

export function marcherShoeRollOffset(pitch: number): number {
  const angle = Math.abs(pitch);
  // Integrate sole depth over pitch so the contacting surface rolls without skating.
  if (pitch < 0) {
    const offset = shoeArc(0.03, 0.075, angle);
    return -(angle <= HEEL_CORNER ? offset :
      offset + shoeArc(-0.03, 0.01, angle) - shoeArc(-0.03, 0.01, HEEL_CORNER));
  }
  let offset = shoeArc(0.03, 0.055, angle);
  if (angle > SOLE_CORNER) {
    offset += shoeArc(-0.0075, 0.04, angle) - shoeArc(-0.0075, 0.04, SOLE_CORNER);
  }
  if (angle > TOE_CORNER) {
    offset += shoeArc(-0.0225, 0.01, angle) - shoeArc(-0.0225, 0.01, TOE_CORNER);
  }
  return offset;
}

function solveMarcherFootContact(
  hip: Vector3, sole: Vector3, facingYaw: number, preferredPitch = 0, rollDirection?: number
) {
  const ankleForPitch = (pitch: number) => {
    const rotation = Quaternion.FromEulerAngles(pitch, facingYaw, 0);
    const offset = new Vector3(0, -MARCHER_SHOE_HALF_HEIGHT, MARCHER_SHOE_FORWARD_OFFSET)
      .rotateByQuaternionToRef(rotation, Vector3.Zero());
    const roll = marcherShoeRollOffset(pitch);
    return sole.subtract(offset).add(new Vector3(roll * Math.sin(facingYaw),
      marcherShoeGroundDepth(pitch), roll * Math.cos(facingYaw)));
  };
  const neutralAnkle = ankleAtSole(sole, facingYaw);
  const forwardDistance = (neutralAnkle.x - hip.x) * Math.sin(facingYaw) +
    (neutralAnkle.z - hip.z) * Math.cos(facingYaw);
  // Positive X pitch lowers the toe: heel strike ahead, toe push-off behind.
  let sign = rollDirection ?? (forwardDistance >= 0 ? -1 : 1);
  let pitch = preferredPitch;
  let ankle = ankleForPitch(pitch);
  const extended = Vector3.Distance(hip, ankle) > MAX_LEG_REACH;
  if (extended) {
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
  return { pitch, ankle, extended };
}

export function marcherGroundFootPitch(
  hip: Vector3, sole: Vector3, facingYaw: number, rollDirection?: number
): number {
  return solveMarcherFootContact(hip, sole, facingYaw, 0, rollDirection).pitch;
}

export function marcherSwingFootPitch(
  progress: number, boundaryPitch: number, boundaryVelocity = 0
): number {
  const roll = Math.cos(Math.PI * progress);
  const width = 0.15;
  const distance = progress < 0.5 ? progress : 1 - progress;
  const blend = Math.min(1, distance / width);
  // Match stance velocity at contact; fade the correction out with zero slope.
  const correction = boundaryVelocity * width * blend * (1 - blend) ** 2;
  return boundaryPitch * roll * roll + (progress < 0.5 ? correction : -correction);
}

export function solvePlantedMarcherLeg(
  hip: Vector3, sole: Vector3, facingYaw: number, preferredPitch = 0, rollDirection?: number
) {
  const { pitch, ankle, extended } = solveMarcherFootContact(hip, sole, facingYaw, preferredPitch, rollDirection);
  const footRotation = Quaternion.FromEulerAngles(pitch, facingYaw, 0);
  const delta = ankle.subtract(hip);
  const distance = delta.length();
  if (!Number.isFinite(distance) || distance < MIN_LEG_REACH - 1e-6 || distance > MAX_LEG_REACH + 1e-6) {
    throw new RangeError(`Marcher foot target exceeds fixed leg reach: ${distance}`);
  }
  const direction = delta.scale(1 / distance);
  // Contact root-finding noise near full extension must not become visible knee-angle noise.
  const ikDistance = extended ? MAX_LEG_REACH : distance;
  const thighLength = MARCHER_THIGH_LENGTH;
  const calfLength = MARCHER_CALF_LENGTH;
  const kneeAngle = Math.acos(Math.max(-1, Math.min(1,
    (ikDistance ** 2 - thighLength ** 2 - calfLength ** 2) / (2 * thighLength * calfLength))));
  const along = (thighLength * thighLength + ikDistance * ikDistance - calfLength * calfLength) /
    (2 * ikDistance);
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

const precalculatedLegPoses = new Map<string, ReturnType<typeof solvePlantedMarcherLeg>>();
const MAX_PRECALCULATED_LEG_POSES = 4096;

export function precalculateMarcherLegPose(
  hip: Vector3, sole: Vector3, facingYaw: number, preferredPitch = 0, rollDirection?: number
) {
  // Rig-local poses can be shared across marchers regardless of field position.
  // Nanounit rounding removes subtraction noise, not visible foot movement.
  const key = [hip.x, hip.y, hip.z, sole.x, sole.y, sole.z, facingYaw, preferredPitch]
    .map(value => Math.round(value * 1e9)).join(":") + `:${rollDirection}`;
  let pose = precalculatedLegPoses.get(key);
  if (!pose) {
    pose = solvePlantedMarcherLeg(hip, sole, facingYaw, preferredPitch, rollDirection);
    if (precalculatedLegPoses.size >= MAX_PRECALCULATED_LEG_POSES) {
      precalculatedLegPoses.delete(precalculatedLegPoses.keys().next().value!);
    }
    precalculatedLegPoses.set(key, pose);
  }
  return {
    thighLength: pose.thighLength,
    kneeAngle: pose.kneeAngle,
    legRotation: pose.legRotation,
    kneeRotation: pose.kneeRotation.clone(),
    ankleRotation: pose.ankleRotation.clone(),
  };
}
