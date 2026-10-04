import { Axis } from '@babylonjs/core/Maths/math.axis';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import { scene } from '../scene/engine';
import { getARScale, getARScaleRange } from '../xr/ar';
import { getActiveControllers } from '../interaction/pathInteraction';
import { createMarcherAvatar } from '../robot/robot';
import { isCameraIntroComplete } from './desktopCamera';

function createPlayerBody() {
  return createMarcherAvatar(scene);
}

let playerBody: TransformNode | null = null;
let playerFloorOffset = 0;

export function resetPlayerFloorOffset() {
  playerFloorOffset = 0;
}

export function setPlayerFloorOffset(offset: number) {
  if (!Number.isFinite(offset)) return false;
  playerFloorOffset = offset;
  return true;
}

export function getTrackedPlayerHeight(camera: WebXRCamera) {
  return camera.realWorldHeight - playerFloorOffset;
}

scene.onBeforeRenderObservable.add(() => {
  const activeCamera = scene.activeCamera;
  const visible = getARScale() === getARScaleRange().max &&
    isCameraIntroComplete() && !!activeCamera;
  if (!visible || !activeCamera) {
    playerBody?.setEnabled(false);
    return;
  }

  playerBody ??= createPlayerBody();
  const isXRCamera = activeCamera instanceof WebXRCamera;
  const eyeHeight = isXRCamera ? getTrackedPlayerHeight(activeCamera) : 1.8;
  if (!Number.isFinite(eyeHeight) || eyeHeight <= 0) {
    playerBody.setEnabled(false);
    return;
  }
  playerBody.setEnabled(true);
  playerBody.position.copyFrom(activeCamera.globalPosition);
  playerBody.position.y -= eyeHeight;
  const controllers = isXRCamera
    ? [...getActiveControllers().values()].filter((controller) =>
      controller.grip && !controller.grip.isDisposed() && controller.motionController
    )
    : [];
  if (controllers.length > 0) {
    const midpoint = Vector3.Zero();
    const forward = Vector3.Zero();
    controllers.forEach((controller) => {
      midpoint.addInPlace(controller.grip!.getAbsolutePosition());
      const direction = controller.pointer.getDirection(Axis.Z);
      direction.y = 0;
      if (direction.lengthSquared() > 0.0001) forward.addInPlace(direction.normalize());
    });
    midpoint.scaleInPlace(1 / controllers.length);
    if (forward.lengthSquared() > 0.0001) playerBody.rotation.y = Math.atan2(forward.x, forward.z);
    const yaw = playerBody.rotation.y;
    playerBody.position.x = midpoint.x - Math.sin(yaw) * 0.3;
    playerBody.position.z = midpoint.z - Math.cos(yaw) * 0.3;
  } else if (!isXRCamera) {
    const forward = activeCamera.getDirection(Axis.Z);
    if (Math.hypot(forward.x, forward.z) > 0.01) playerBody.rotation.y = Math.atan2(forward.x, forward.z);
  }
});