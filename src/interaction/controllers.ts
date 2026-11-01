import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import {
  getARPosition,
  getARScale,
  setARScale,
  setARPosition,
  setARRotation,
  getARScaleRange,
  getARRotation,
  getARSurfaceHeight,
  preserveARSurfaceHeight,
} from '../xr/ar';
import { scene } from '../scene/engine';
import { floorCalibrationToggle } from '../ui/dom';

export const activeControllers = new Map<string, WebXRInputSource>();

const SCALE_EXPONENT_AT_MIN = 0.4;
const SCALE_EXPONENT_AT_MAX = 1.6;
const pinchState = {
  active: false,
  startDistance: 0,
  startScale: 1,
  scaleExponent: SCALE_EXPONENT_AT_MIN,
  localAnchor: new Vector3(),
  startYaw: 0,
  startRotation: 0,
  startSurfaceY: 0,
};
let singleControllerMove: {
  handedness: string;
  movement: SingleHandFieldMovement;
} | null = null;
let sceneManipulationLocked = false;
// After a two-grip resize, the grip still held must not turn into a one-handed
// move (which would drag the field up/down) until both grips are released.
let awaitingTwoGripRelease = false;

function resetPinchState() {
  pinchState.active = false;
  pinchState.startDistance = 0;
  pinchState.startScale = 1;
  pinchState.scaleExponent = SCALE_EXPONENT_AT_MIN;
  pinchState.localAnchor = new Vector3();
  pinchState.startYaw = 0;
  pinchState.startRotation = 0;
  pinchState.startSurfaceY = 0;
}

function getScaleExponentFor(scale: number): number {
  const { min, max } = getARScaleRange();
  const t = (Math.log(scale) - Math.log(min)) / (Math.log(max) - Math.log(min));
  const clampedT = Math.min(1, Math.max(0, t));
  return SCALE_EXPONENT_AT_MIN + (SCALE_EXPONENT_AT_MAX - SCALE_EXPONENT_AT_MIN) * clampedT;
}

export function rotateAroundY(vector: Vector3, angle: number): Vector3 {
  return Vector3.TransformCoordinates(vector, Matrix.RotationY(angle));
}

export function getARPositionForScaleAnchor(
  midpoint: Vector3,
  localAnchor: Vector3,
  scale: number,
  rotation: number,
): Vector3 {
  return midpoint.subtract(rotateAroundY(localAnchor.scale(scale), rotation));
}

// Two-handed scene sizing is a floor-plane gesture: vertical hand movement
// neither changes the scale nor moves the shrink point.
export function getHorizontalHandSpan(left: Vector3, right: Vector3) {
  return {
    distance: Math.hypot(right.x - left.x, right.z - left.z),
    midpoint: new Vector3((left.x + right.x) / 2, 0, (left.z + right.z) / 2),
  };
}

export function getARPositionForSingleHandMovement(
  startARPosition: Vector3,
  startHandPosition: Vector3,
  currentHandPosition: Vector3,
  rotationDelta = 0,
): Vector3 {
  return currentHandPosition.subtract(rotateAroundY(
    startHandPosition.subtract(startARPosition), rotationDelta,
  ));
}

export type SingleHandFieldMovement = {
  startHandPosition: Vector3;
  startARPosition: Vector3;
  startRotation: number;
  rotation: number;
  previousYaw: number | null;
};

export function getSingleHandYaw(direction: Vector3): number | null {
  const lengthSquared = direction.lengthSquared();
  if (lengthSquared < 1e-10 ||
    direction.x * direction.x + direction.z * direction.z < lengthSquared * 0.01) return null;
  return Math.atan2(direction.x, direction.z);
}

export function beginSingleHandFieldMovement(position: Vector3, yaw: number | null): SingleHandFieldMovement {
  const rotation = getARRotation();
  return {
    startHandPosition: position.clone(), startARPosition: getARPosition(),
    startRotation: rotation, rotation, previousYaw: yaw,
  };
}

export function updateSingleHandFieldMovement(
  movement: SingleHandFieldMovement, position: Vector3, yaw: number | null,
) {
  if (yaw !== null && movement.previousYaw !== null) {
    const delta = yaw - movement.previousYaw;
    movement.rotation += Math.atan2(Math.sin(delta), Math.cos(delta));
  }
  movement.previousYaw = yaw;
  setARRotation(movement.rotation);
  setARPosition(getARPositionForSingleHandMovement(
    movement.startARPosition, movement.startHandPosition, position,
    movement.rotation - movement.startRotation,
  ));
  // Own the hand-chosen altitude so Giant floor-following cannot undo a lift.
  preserveARSurfaceHeight(getARSurfaceHeight());
}

function resetSingleControllerMove() {
  singleControllerMove = null;
}

function isGripPressed(controller: WebXRInputSource): boolean {
  const motionController = controller.motionController;
  if (!motionController) return false;
  const squeeze = motionController.getComponentOfType('squeeze');
  return !!squeeze?.pressed || !!controller.inputSource.gamepad?.buttons?.[1]?.pressed;
}

function getControllerPosition(controller: WebXRInputSource) {
  return controller.grip ?? controller.pointer;
}

function getScaleFromControllerDistance(distance: number) {
  const { min, max } = getARScaleRange();
  const scaleRatio = distance / pinchState.startDistance;
  const easedRatio = Math.pow(scaleRatio, pinchState.scaleExponent);
  return Math.min(max, Math.max(min, pinchState.startScale * easedRatio));
}

export function getControllerYaw(leftPosition: Vector3, rightPosition: Vector3) {
  return Math.atan2(rightPosition.x - leftPosition.x, rightPosition.z - leftPosition.z);
}

export function setActiveController(controller: WebXRInputSource) {
  const handedness = controller.inputSource.handedness || controller.uniqueId;
  activeControllers.set(String(handedness), controller);
}

export function getActiveControllers(): ReadonlyMap<string, WebXRInputSource> {
  return activeControllers;
}

export function removeActiveController(
  controller: WebXRInputSource,
  cleanup: (handedness: string) => void
) {
  const handedness = String(controller.inputSource.handedness || controller.uniqueId);
  if (activeControllers.get(handedness) !== controller) return;
  cleanup(handedness);
  activeControllers.delete(handedness);
}

export function isControllerSceneManipulationActive() {
  return pinchState.active || singleControllerMove !== null;
}

export function setSceneManipulationLocked(locked: boolean) {
  sceneManipulationLocked = locked;
  if (locked) {
    resetPinchState();
    resetSingleControllerMove();
  }
}

export function isSceneManipulationLocked() {
  return sceneManipulationLocked;
}

export function updateARResizeFromControllers(grabActive: boolean) {
  if (sceneManipulationLocked || floorCalibrationToggle?.checked || grabActive) {
    resetPinchState();
    resetSingleControllerMove();
    return;
  }
  const left = activeControllers.get('left');
  const right = activeControllers.get('right');
  if (!left && !right) {
    resetPinchState();
    resetSingleControllerMove();
    return;
  }

  const leftPressed = !!left && isGripPressed(left);
  const rightPressed = !!right && isGripPressed(right);
  if (!leftPressed && !rightPressed) awaitingTwoGripRelease = false;
  if (left && right && leftPressed && rightPressed) {
    resetSingleControllerMove();
    awaitingTwoGripRelease = true;
  } else if (awaitingTwoGripRelease) {
    resetPinchState();
    resetSingleControllerMove();
    return;
  } else if (leftPressed !== rightPressed) {
    resetPinchState();
    const handedness = leftPressed ? 'left' : 'right';
    const controller = leftPressed ? left : right;
    if (!controller) {
      resetSingleControllerMove();
      return;
    }
    const pose = getControllerPosition(controller);
    pose.computeWorldMatrix(true);
    const currentPosition = pose.getAbsolutePosition();
    const yaw = getSingleHandYaw(Vector3.TransformNormal(new Vector3(0, 0, 1), pose.getWorldMatrix()));
    if (!singleControllerMove || singleControllerMove.handedness !== handedness) {
      singleControllerMove = {
        handedness,
        movement: beginSingleHandFieldMovement(currentPosition, yaw),
      };
      return;
    }
    updateSingleHandFieldMovement(singleControllerMove.movement, currentPosition, yaw);
    return;
  } else {
    resetPinchState();
    resetSingleControllerMove();
    return;
  }

  if (!left || !right) return;
  const leftPose = getControllerPosition(left);
  const rightPose = getControllerPosition(right);
  leftPose.computeWorldMatrix(true);
  rightPose.computeWorldMatrix(true);
  const leftPosition = leftPose.getAbsolutePosition();
  const rightPosition = rightPose.getAbsolutePosition();
  const { distance, midpoint } = getHorizontalHandSpan(leftPosition, rightPosition);
  if (distance <= 0.05) {
    resetPinchState();
    return;
  }

  const currentYaw = getControllerYaw(leftPosition, rightPosition);
  if (!pinchState.active || pinchState.startDistance <= 0.02) {
    pinchState.active = true;
    pinchState.startDistance = distance;
    pinchState.startScale = getARScale();
    pinchState.scaleExponent = getScaleExponentFor(pinchState.startScale);
    pinchState.startYaw = currentYaw;
    pinchState.startRotation = getARRotation();
    pinchState.startSurfaceY = getARSurfaceHeight();
    preserveARSurfaceHeight(pinchState.startSurfaceY);
    const worldOffsetFromPivot = midpoint.subtract(getARPosition());
    pinchState.localAnchor = rotateAroundY(worldOffsetFromPivot, -pinchState.startRotation)
      .scale(1 / pinchState.startScale);
    setARRotation(pinchState.startRotation);
    return;
  }

  // Scale and turn around the horizontal midpoint at a fixed surface altitude.
  const yaw = pinchState.startRotation + (currentYaw - pinchState.startYaw);
  const scale = setARScale(getScaleFromControllerDistance(distance));
  setARPosition(getARPositionForScaleAnchor(midpoint, pinchState.localAnchor, scale, yaw));
  preserveARSurfaceHeight(pinchState.startSurfaceY);
  setARRotation(yaw);
}
