import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { WebXRHandJoint, type WebXRHandTracking } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
import { scene } from '../scene/engine';

const HOLD_MS = 500;
const HANDLE_RADIUS = 0.025;
const TRAVEL = 0.08;
const DEADZONE = 0.015;
const SPEED = 1.5;

export function isThumbsUp(joint: (name: WebXRHandJoint) => Vector3) {
  const wrist = joint(WebXRHandJoint.WRIST);
  const thumb = joint(WebXRHandJoint.THUMB_TIP);
  const base = joint(WebXRHandJoint.THUMB_METACARPAL);
  const thumbDirection = thumb.subtract(base);
  if (thumbDirection.length() < 0.045 || thumbDirection.normalize().y < 0.75) return false;
  const fingers = [
    [WebXRHandJoint.INDEX_FINGER_TIP, WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL],
    [WebXRHandJoint.MIDDLE_FINGER_TIP, WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL],
    [WebXRHandJoint.RING_FINGER_TIP, WebXRHandJoint.RING_FINGER_PHALANX_PROXIMAL],
    [WebXRHandJoint.PINKY_FINGER_TIP, WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL],
  ] as const;
  return fingers.every(([tip, knuckle]) => {
    const finger = joint(tip);
    const palmLength = Vector3.Distance(joint(knuckle), wrist);
    return palmLength > 0.03 && Vector3.Distance(finger, wrist) < palmLength * 1.3 &&
      thumb.y - finger.y > 0.035;
  });
}

export function joystickVelocity(displacement: Vector3, forward: Vector3) {
  const length = Math.hypot(displacement.x, displacement.z);
  if (length <= DEADZONE) return Vector3.Zero();
  const heading = new Vector3(forward.x, 0, forward.z);
  if (heading.lengthSquared() < 1e-6) return Vector3.Zero();
  heading.normalize();
  const right = new Vector3(heading.z, 0, -heading.x);
  const strength = Math.min(1, (length - DEADZONE) / (TRAVEL - DEADZONE));
  return right.scale(displacement.x / length).add(heading.scale(displacement.z / length))
    .scale(strength * SPEED);
}

export class HandJoystick {
  private owner: 'left' | 'right' | null = null;
  private since = 0;
  private engaged = false;
  private wasPinching = false;
  private offset = Vector3.Zero();
  private root: TransformNode | null = null;
  private handle: TransformNode | null = null;
  private heading = Vector3.Forward();
  active = false;

  reset() {
    this.owner = null;
    this.engaged = false;
    this.wasPinching = false;
    this.active = false;
    this.root?.setEnabled(false);
  }

  private createVisual() {
    if (this.root) return;
    this.root = new TransformNode('handJoystick', scene);
    const material = new StandardMaterial('handJoystickMaterial', scene);
    material.diffuseColor = new Color3(0.08, 0.7, 0.95);
    material.emissiveColor = new Color3(0.02, 0.2, 0.3);
    const base = MeshBuilder.CreateCylinder('handJoystickBase',
      { diameter: 0.11, height: 0.012, tessellation: 16 }, scene);
    const handle = MeshBuilder.CreateSphere('handJoystickHandle', { diameter: HANDLE_RADIUS * 2, segments: 12 }, scene);
    for (const mesh of [base, handle]) {
      mesh.parent = this.root;
      mesh.material = material;
      mesh.isPickable = false;
    }
    base.position.y = -0.045;
    this.handle = handle;
    scene.onDisposeObservable.addOnce(() => material.dispose());
  }

  update(tracking: WebXRHandTracking | null, allowed: boolean, now: number, seconds: number,
    onActivate: () => void) {
    const camera = scene.activeCamera;
    if (!allowed || !tracking || !camera) { this.reset(); return false; }
    const candidates = this.owner ? [this.owner] : ['left', 'right'] as const;
    const owner = candidates.find(side => {
      const hand = tracking.getHandByHandedness(side);
      return hand && isThumbsUp(name => hand.getJointMesh(name).getAbsolutePosition());
    });
    if (!owner) { this.reset(); return false; }
    if (owner !== this.owner) {
      this.owner = owner;
      this.since = now;
    }
    if (!this.active && now - this.since < HOLD_MS) return true;
    if (!this.active) {
      this.active = true;
      onActivate();
      this.heading.copyFrom(camera.getForwardRay().direction);
      this.heading.y = 0;
      if (this.heading.lengthSquared() < 1e-6) this.heading.set(0, 0, 1);
      this.heading.normalize();
      this.createVisual();
    }
    const holding = tracking.getHandByHandedness(owner)!;
    const center = holding.getJointMesh(WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
    this.root!.position.copyFrom(center);
    this.root!.setEnabled(true);
    const other = tracking.getHandByHandedness(owner === 'left' ? 'right' : 'left');
    if (!other) { this.engaged = false; this.wasPinching = false; this.handle!.position.setAll(0); return true; }
    const thumb = other.getJointMesh(WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
    const index = other.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
    const distance = Vector3.Distance(thumb, index);
    const pinching = distance > 0.002 && distance < (this.wasPinching ? 0.04 : 0.025);
    const point = thumb.add(index).scale(0.5);
    if (pinching && !this.wasPinching && Vector3.Distance(point, center) <= 0.06) {
      this.engaged = true;
      this.offset.copyFrom(point.subtract(center));
    }
    this.wasPinching = pinching;
    if (!pinching) this.engaged = false;
    const delta = this.engaged ? point.subtract(center).subtract(this.offset) : Vector3.Zero();
    delta.y = 0;
    if (delta.length() > TRAVEL) delta.normalize().scaleInPlace(TRAVEL);
    this.handle!.position.copyFrom(delta);
    const right = new Vector3(this.heading.z, 0, -this.heading.x);
    const local = new Vector3(Vector3.Dot(delta, right), 0, Vector3.Dot(delta, this.heading));
    const velocity = joystickVelocity(local, this.heading);
    camera.position.addInPlace(velocity.scale(Math.min(0.05, Math.max(0, seconds))));
    return true;
  }
}
