import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';

export interface HandMenuPose {
  position: Vector3;
  rotation: Quaternion;
  normal: Vector3;
}

export function getHandMenuPose(
  position: Vector3, palmNormal: Vector3, towardWrist: Vector3
): HandMenuPose | null {
  if ([position, palmNormal, towardWrist].some(vector =>
    ![vector.x, vector.y, vector.z].every(Number.isFinite))) return null;
  if (palmNormal.lengthSquared() < 1e-12 || towardWrist.lengthSquared() < 1e-12) return null;
  const normal = palmNormal.normalizeToNew();
  const z = towardWrist.normalizeToNew();
  const x = Vector3.Cross(normal, z);
  if (x.lengthSquared() < 1e-6) return null;
  x.normalize();
  const y = Vector3.Cross(z, x).normalize();
  return {
    position: position.clone(),
    rotation: Quaternion.RotationQuaternionFromAxis(x, y, z),
    normal: y,
  };
}

export function getTrackedHandMenuPose(
  wrist: Vector3, index: Vector3, middle: Vector3, pinky: Vector3,
  handedness: 'left' | 'right', useRightHandedSystem: boolean
): HandMenuPose | null {
  const forward = middle.subtract(wrist);
  const across = index.subtract(pinky);
  const normal = Vector3.Cross(across, forward);
  // Reflecting WebXR's right-handed joints reverses the cross product.
  if ((handedness === 'right') !== useRightHandedSystem) normal.scaleInPlace(-1);
  return getHandMenuPose(wrist, normal, forward.negate());
}
