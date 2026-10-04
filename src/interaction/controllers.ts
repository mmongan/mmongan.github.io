import * as BABYLON from 'babylonjs';
import {
  getARPosition,
  getARScale,
  setARScale,
  setARPosition,
  setARRotation,
  getARScaleRange,
  getARRotation,
} from '../xr/ar';
import { scene } from '../scene/engine';
import { floorCalibrationToggle } from '../ui/dom';

export const activeControllers = new Map<string, BABYLON.WebXRInputSource>();

const SCALE_EXPONENT_AT_MIN = 0.4;
const SCALE_EXPONENT_AT_MAX = 1.6;
const pinchState = {
  active: false,
  startDistance: 0,
  startScale: 1,
  scaleExponent: SCALE_EXPONENT_AT_MIN,
  localAnchor: new BABYLON.Vector3(),
  startYaw: 0,
  startRotation: 0,
};

function resetPinchState() {
  pinchState.active = false;
  pinchState.startDistance = 0;
  pinchState.startScale = 1;
  pinchState.scaleExponent = SCALE_EXPONENT_AT_MIN;
  pinchState.localAnchor = new BABYLON.Vector3();
  pinchState.startYaw = 0;
  pinchState.startRotation = 0;
}

function getScaleExponentFor(scale: number): number {
  const { min, max } = getARScaleRange();
  const t = (Math.log(scale) - Math.log(min)) / (Math.log(max) - Math.log(min));
  const clampedT = Math.min(1, Math.max(0, t));
  return SCALE_EXPONENT_AT_MIN + (SCALE_EXPONENT_AT_MAX - SCALE_EXPONENT_AT_MIN) * clampedT;
}

export function rotateAroundY(vector: BABYLON.Vector3, angle: number): BABYLON.Vector3 {
  return BABYLON.Vector3.TransformCoordinates(vector, BABYLON.Matrix.RotationY(angle));
}

function isGripPressed(controller: BABYLON.WebXRInputSource): boolean {
  const motionController = controller.motionController;
  if (!motionController) return false;
  const squeeze = motionController.getComponentOfType('squeeze');
  return !!squeeze?.pressed || !!controller.inputSource.gamepad?.buttons?.[1]?.pressed;
}

function getControllerPosition(controller: BABYLON.WebXRInputSource) {
  return controller.grip ?? controller.pointer;
}

function getScaleFromControllerDistance(distance: number) {
  const { min, max } = getARScaleRange();
  const scaleRatio = distance / pinchState.startDistance;
  const easedRatio = Math.pow(scaleRatio, pinchState.scaleExponent);
  return Math.min(max, Math.max(min, pinchState.startScale * easedRatio));
}

export function getControllerYaw(leftPosition: BABYLON.Vector3, rightPosition: BABYLON.Vector3) {
  return Math.atan2(rightPosition.x - leftPosition.x, rightPosition.z - leftPosition.z);
}

export function setActiveController(controller: BABYLON.WebXRInputSource) {
  const handedness = controller.inputSource.handedness || controller.uniqueId;
  activeControllers.set(String(handedness), controller);
}

export function getActiveControllers(): ReadonlyMap<string, BABYLON.WebXRInputSource> {
  return activeControllers;
}

export function removeActiveController(
  controller: BABYLON.WebXRInputSource,
  cleanup: (handedness: string) => void
) {
  const handedness = String(controller.inputSource.handedness || controller.uniqueId);
  if (activeControllers.get(handedness) !== controller) return;
  cleanup(handedness);
  activeControllers.delete(handedness);
}

export function updateARResizeFromControllers(cornerDragActive: boolean) {
  if (floorCalibrationToggle?.checked || cornerDragActive) {
    resetPinchState();
    return;
  }
  const left = activeControllers.get('left');
  const right = activeControllers.get('right');
  if (!left || !right) return;

  if (!isGripPressed(left) || !isGripPressed(right)) {
    resetPinchState();
    return;
  }

  const leftPosition = getControllerPosition(left).getAbsolutePosition();
  const rightPosition = getControllerPosition(right).getAbsolutePosition();
  const distance = BABYLON.Vector3.Distance(leftPosition, rightPosition);
  if (distance <= 0.05) return;

  const midpoint = leftPosition.add(rightPosition).scale(0.5);
  const currentYaw = getControllerYaw(leftPosition, rightPosition);
  if (!pinchState.active || pinchState.startDistance <= 0.02) {
    pinchState.active = true;
    pinchState.startDistance = distance;
    pinchState.startScale = getARScale();
    pinchState.scaleExponent = getScaleExponentFor(pinchState.startScale);
    pinchState.startYaw = currentYaw;
    pinchState.startRotation = getARRotation();
    const worldOffsetFromPivot = midpoint.subtract(getARPosition());
    pinchState.localAnchor = rotateAroundY(worldOffsetFromPivot, -pinchState.startRotation)
      .scale(1 / pinchState.startScale);
    setARRotation(pinchState.startRotation);
    return;
  }

  const scale = getScaleFromControllerDistance(distance);
  const yaw = pinchState.startRotation + (currentYaw - pinchState.startYaw);
  const anchorWorldOffset = rotateAroundY(pinchState.localAnchor.scale(scale), yaw);
  setARScale(scale);
  setARPosition(midpoint.subtract(anchorWorldOffset));
  setARRotation(yaw);
}
