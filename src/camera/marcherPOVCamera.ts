import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';

const POV_HIDDEN_LAYER = 0x20000000;
const TOP_DOWN_LAYER = 0x10000000;

export interface MarcherEyePose {
  position: Vector3;
  yaw: number;
}

export class MarcherPOVCamera {
  private camera: TargetCamera | null = null;
  private robot: TransformNode | null = null;
  private savedPosition = Vector3.Zero();
  private savedRotation = Vector3.Zero();
  private savedQuaternion: Quaternion | null = null;
  private savedLayerMask = 0;
  private lastEye = Vector3.Zero();
  private lastYaw = 0;
  private xrOffset = Vector3.Zero();
  private hiddenMeshes = new Map<AbstractMesh, number>();
  private xr = false;

  constructor(private getEyePose: (robot: TransformNode) => MarcherEyePose | null) {}

  get active() { return this.camera !== null; }
  get trackedCamera() { return this.camera; }

  start(robot: TransformNode, camera: TargetCamera, xr: boolean) {
    const eye = this.getEyePose(robot);
    if (!eye) return false;
    this.stop();
    this.camera = camera;
    this.xr = xr;
    this.savedPosition.copyFrom(camera.position);
    this.savedRotation.copyFrom(camera.rotation);
    this.savedQuaternion = camera.rotationQuaternion?.clone() ?? null;
    this.savedLayerMask = camera.layerMask;
    camera.layerMask &= ~POV_HIDDEN_LAYER;
    this.lastEye.copyFrom(eye.position);
    this.lastYaw = eye.yaw;
    if (xr) {
      eye.position.subtractToRef(camera.position, this.xrOffset);
      camera.position.addInPlace(this.xrOffset);
    } else {
      camera.position.copyFrom(eye.position);
      camera.rotation.set(0, eye.yaw, 0);
      if (camera.rotationQuaternion) Quaternion.FromEulerAnglesToRef(0, eye.yaw, 0, camera.rotationQuaternion);
    }
    this.trackRobot(robot);
    return true;
  }

  update(robot: TransformNode) {
    const camera = this.camera;
    const eye = this.getEyePose(robot);
    if (!camera || !eye) return false;
    if (robot !== this.robot) this.trackRobot(robot);
    if (this.xr) {
      const movement = eye.position.subtract(this.lastEye);
      camera.position.addInPlace(movement);
      this.xrOffset.addInPlace(movement);
    } else {
      camera.position.copyFrom(eye.position);
      const turn = Math.atan2(Math.sin(eye.yaw - this.lastYaw), Math.cos(eye.yaw - this.lastYaw));
      camera.rotation.y += turn;
      if (camera.rotationQuaternion) {
        const rotation = camera.rotationQuaternion.toEulerAngles();
        Quaternion.FromEulerAnglesToRef(rotation.x, rotation.y + turn, rotation.z, camera.rotationQuaternion);
      }
    }
    this.lastEye.copyFrom(eye.position);
    this.lastYaw = eye.yaw;
    this.hideRobotMeshes();
    return true;
  }

  stop() {
    this.restoreMeshes();
    const camera = this.camera;
    if (camera && !camera.isDisposed()) {
      if (this.xr) camera.position.subtractInPlace(this.xrOffset);
      else {
        camera.position.copyFrom(this.savedPosition);
        camera.rotation.copyFrom(this.savedRotation);
        camera.rotationQuaternion = this.savedQuaternion?.clone() ?? null;
      }
      camera.layerMask = this.savedLayerMask;
    }
    this.camera = null;
    this.robot = null;
    this.xrOffset.setAll(0);
  }

  private trackRobot(robot: TransformNode) {
    this.restoreMeshes();
    this.robot = robot;
    this.hideRobotMeshes();
  }

  private hideRobotMeshes() {
    this.robot?.getChildMeshes(false).forEach(mesh => {
      if (mesh.layerMask === TOP_DOWN_LAYER || this.hiddenMeshes.has(mesh)) return;
      this.hiddenMeshes.set(mesh, mesh.layerMask);
      mesh.layerMask = POV_HIDDEN_LAYER;
    });
  }

  private restoreMeshes() {
    this.hiddenMeshes.forEach((mask, mesh) => { if (!mesh.isDisposed()) mesh.layerMask = mask; });
    this.hiddenMeshes.clear();
  }
}
