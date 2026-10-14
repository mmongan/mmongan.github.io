import type { Ray } from '@babylonjs/core/Culling/ray';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import type { HandMenuHit } from './handMenu';

const panels = new Set<FloatingPanel>();

export class FloatingPanel {
  private source: string | null = null;
  private offset = new Matrix();
  private dragPlane: Plane | null = null;
  private dragOffset = new Vector3();
  userPlaced = false;

  constructor(
    readonly root: TransformNode,
    readonly meshes: Set<AbstractMesh>,
    private surface: TransformNode,
    private halfSize: Vector3,
    private buttons: Map<AbstractMesh, HandMenuHit> = new Map(),
  ) {
    root.rotationQuaternion ??= Quaternion.FromEulerVector(root.rotation);
    panels.add(this);
    root.onDisposeObservable.addOnce(() => panels.delete(this));
  }

  near(point: Vector3, tolerance = 0.03) {
    if (!this.root.isEnabled()) return false;
    const local = Vector3.TransformCoordinates(point, this.surface.computeWorldMatrix(true).clone().invert());
    return Math.abs(local.x) <= this.halfSize.x + tolerance &&
      Math.abs(local.y) <= this.halfSize.y + tolerance &&
      Math.abs(local.z) <= this.halfSize.z + tolerance;
  }

  pick(ray: Ray) {
    if (!this.root.isEnabled()) return null;
    this.meshes.forEach(mesh => mesh.computeWorldMatrix(true));
    const pick = scene.pickWithRay(ray, mesh => this.meshes.has(mesh));
    return pick?.hit ? pick : null;
  }

  buttonNear(point: Vector3): HandMenuHit | null {
    if (!this.root.isEnabled()) return null;
    for (const [mesh, action] of this.buttons) {
      const local = Vector3.TransformCoordinates(point, mesh.computeWorldMatrix(true).clone().invert());
      const size = mesh.getBoundingInfo().boundingBox.extendSize;
      if (Math.abs(local.x) <= size.x + 0.01 && Math.abs(local.y) <= size.y + 0.01 && Math.abs(local.z) <= 0.04) return action;
    }
    return null;
  }

  begin(source: string, world: Matrix) {
    if (!this.root.isEnabled()) return;
    for (const panel of panels) panel.end(source);
    this.source = source;
    this.userPlaced = true;
    this.root.computeWorldMatrix(true).multiplyToRef(world.clone().invert(), this.offset);
  }

  update(source: string, world: Matrix) {
    if (this.source !== source) return;
    this.offset.multiply(world).decompose(new Vector3(), this.root.rotationQuaternion!, this.root.position);
  }

  end(source: string) {
    if (this.source === source) this.release();
  }

  release() {
    this.source = null;
    this.dragPlane = null;
  }

  grabbed(source?: string) {
    return source === undefined ? this.source !== null : this.source === source;
  }

  private face(eye: Vector3) {
    const away = this.root.position.subtract(eye);
    away.y = 0;
    if (away.lengthSquared() > 1e-6) this.root.lookAt(this.root.position.add(away));
  }

  beginPointer(ray: Ray) {
    const pick = this.pick(ray);
    if (!pick?.pickedPoint || this.source !== null) return false;
    this.begin('pointer', Matrix.Identity());
    this.dragPlane = Plane.FromPositionAndNormal(pick.pickedPoint, ray.direction.scale(-1));
    this.root.position.subtractToRef(pick.pickedPoint, this.dragOffset);
    return true;
  }

  updatePointer(ray: Ray) {
    if (this.source !== 'pointer' || !this.dragPlane) return;
    const distance = ray.intersectsPlane(this.dragPlane);
    if (distance === null || distance <= 0 || distance > 6) return;
    ray.origin.add(ray.direction.scale(distance)).addToRef(this.dragOffset, this.root.position);
    this.face(ray.origin);
  }

  nudge(ray: Ray, delta: number) {
    if (!this.pick(ray) || this.grabbed()) return false;
    const offset = this.root.position.subtract(ray.origin);
    const distance = offset.length();
    if (distance < 1e-6) return false;
    const next = Math.min(3, Math.max(0.3, distance * Math.exp(delta * 0.001)));
    ray.origin.addToRef(offset.scale(next / distance), this.root.position);
    this.face(ray.origin);
    this.userPlaced = true;
    return true;
  }
}

export function isFloatingPanelMesh(mesh: AbstractMesh) {
  return [...panels].some(panel => panel.root.isEnabled() && panel.meshes.has(mesh));
}

export function getFloatingPanelNear(point: Vector3, tolerance = 0.03) {
  return [...panels].filter(panel => panel.near(point, tolerance))
    .sort((a, b) => Vector3.DistanceSquared(point, a.root.position) - Vector3.DistanceSquared(point, b.root.position))[0];
}

export function pickFloatingPanel(ray: Ray) {
  panels.forEach(panel => {
    if (panel.root.isEnabled()) panel.meshes.forEach(mesh => mesh.computeWorldMatrix(true));
  });
  return scene.pickWithRay(ray, isFloatingPanelMesh);
}

export function getFloatingPanelButtonNearPoint(point: Vector3): HandMenuHit | null {
  for (const panel of panels) {
    const action = panel.buttonNear(point);
    if (action) return action;
  }
  return null;
}

export function beginFloatingPanelGrab(source: string, world: Matrix, mesh?: AbstractMesh | null, point?: Vector3, tolerance = 0.03) {
  const panel = mesh ? [...panels].find(panel => panel.meshes.has(mesh))
    : point ? getFloatingPanelNear(point, tolerance) : undefined;
  panel?.begin(source, world);
  return !!panel;
}

export function updateFloatingPanelGrab(source: string, world: Matrix) {
  panels.forEach(panel => panel.update(source, world));
}

export function endFloatingPanelGrab(source: string) {
  panels.forEach(panel => panel.end(source));
}

export function isFloatingPanelGrabbed(source?: string) {
  return [...panels].some(panel => panel.grabbed(source));
}

export function beginFloatingPanelPointerDrag(ray: Ray) {
  const pick = pickFloatingPanel(ray);
  return [...panels].find(panel => pick?.pickedMesh && panel.meshes.has(pick.pickedMesh))?.beginPointer(ray) ?? false;
}

export function updateFloatingPanelPointerDrag(ray: Ray) {
  panels.forEach(panel => panel.updatePointer(ray));
}

export function nudgeFloatingPanelDistance(ray: Ray, delta: number) {
  const pick = pickFloatingPanel(ray);
  return [...panels].find(panel => pick?.pickedMesh && panel.meshes.has(pick.pickedMesh))?.nudge(ray, delta) ?? false;
}
