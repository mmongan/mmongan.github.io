import type { Ray } from '@babylonjs/core/Culling/ray';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import type { HandMenuHit } from './handMenu';
import type { PanelTransparencySlider } from './panelTransparencySlider';

const panels = new Set<FloatingPanel>();

interface PanelResize {
  getScale(): number;
  setScale(scale: number): void;
}

interface ViewerPlacement {
  desktop: { distance: number; height: number; side?: number };
  xr: { distance: number; height: number };
  side: number;
  uprightInXR?: boolean;
}

export class FloatingPanel {
  private source: string | null = null;
  private grabWorlds = new Map<string, Matrix>();
  private stretch: { distance: number; scale: number; offset: Vector3 } | null = null;
  private offset = new Matrix();
  private dragPlane: Plane | null = null;
  private dragOffset = new Vector3();
  private sliderDrag: { source: string; origin: Vector3; point: Vector3 } | null = null;
  userPlaced = false;

  constructor(
    readonly root: TransformNode,
    readonly meshes: Set<AbstractMesh>,
    private surface: TransformNode,
    private halfSize: Vector3,
    private buttons: Map<AbstractMesh, HandMenuHit> = new Map(),
    private resize?: PanelResize,
    private transparencySlider?: PanelTransparencySlider,
  ) {
    root.rotationQuaternion ??= Quaternion.FromEulerVector(root.rotation);
    panels.add(this);
    root.onDisposeObservable.addOnce(() => {
      panels.delete(this);
    });
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
    if (this.grabWorlds.has(source)) return;
    for (const panel of panels) {
      if (panel !== this) panel.end(source);
    }
    if (this.resize && this.source && this.source !== 'pointer' && source !== 'pointer' &&
      this.grabWorlds.size === 1) {
      this.grabWorlds.set(source, world.clone());
      const points = [...this.grabWorlds.values()].map(matrix => matrix.getTranslation());
      const midpoint = points[0].add(points[1]).scale(0.5);
      this.stretch = {
        distance: Math.max(0.03, Vector3.Distance(points[0], points[1])),
        scale: this.resize.getScale(),
        offset: this.root.position.subtract(midpoint),
      };
      return;
    }
    this.release();
    this.source = source;
    this.grabWorlds.set(source, world.clone());
    this.userPlaced = true;
    this.root.computeWorldMatrix(true).multiplyToRef(world.clone().invert(), this.offset);
  }

  update(source: string, world: Matrix) {
    if (this.sliderDrag?.source === source && this.transparencySlider) {
      this.transparencySlider.setFromWorld(this.sliderDrag.point.add(world.getTranslation().subtract(this.sliderDrag.origin)));
      return;
    }
    if (!this.grabWorlds.has(source)) return;
    this.grabWorlds.set(source, world.clone());
    if (this.stretch && this.resize) {
      const points = [...this.grabWorlds.values()].map(matrix => matrix.getTranslation());
      const ratio = Vector3.Distance(points[0], points[1]) / this.stretch.distance;
      this.resize.setScale(this.stretch.scale * ratio);
      const actualRatio = this.resize.getScale() / this.stretch.scale;
      this.root.position.copyFrom(points[0].add(points[1]).scale(0.5)
        .add(this.stretch.offset.scale(actualRatio)));
      return;
    }
    if (this.source !== source) return;
    this.offset.multiply(world).decompose(new Vector3(), this.root.rotationQuaternion!, this.root.position);
  }

  end(source: string) {
    if (this.sliderDrag?.source === source) {
      this.release();
      return;
    }
    if (!this.grabWorlds.delete(source)) return;
    this.stretch = null;
    const remaining = this.grabWorlds.entries().next().value;
    if (!remaining) {
      this.release();
      return;
    }
    this.source = remaining[0];
    this.root.computeWorldMatrix(true).multiplyToRef(remaining[1].clone().invert(), this.offset);
  }

  release() {
    this.sliderDrag = null;
    this.source = null;
    this.grabWorlds.clear();
    this.stretch = null;
    this.dragPlane = null;
  }

  grabbed(source?: string) {
    if (this.sliderDrag && (source === undefined || source === this.sliderDrag.source)) return true;
    return source === undefined ? this.source !== null : this.grabWorlds.has(source);
  }

  placeForViewer(placement: ViewerPlacement) {
    const camera = scene.activeCamera;
    if (!camera) return false;
    camera.getViewMatrix(true);
    const inXR = camera.getClassName() === 'WebXRCamera';
    const forward = camera.getForwardRay().direction.clone();
    if (inXR) forward.y = 0;
    if (forward.lengthSquared() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    const right = new Vector3(forward.z, 0, -forward.x);
    if (right.lengthSquared() < 1e-6) right.copyFrom(camera.getDirection(Vector3.Right()));
    right.normalize();
    const pose = inXR ? placement.xr : placement.desktop;
    this.release();
    this.root.position.copyFrom(camera.globalPosition.add(forward.scale(pose.distance))
      .add(right.scale(!inXR ? placement.desktop.side ?? placement.side : placement.side)));
    this.root.position.y += pose.height;
    const away = this.root.position.subtract(camera.globalPosition);
    if (inXR && placement.uprightInXR) away.y = 0;
    this.root.lookAt(this.root.position.add(away));
    this.userPlaced = false;
    return true;
  }

  private face(eye: Vector3) {
    const away = this.root.position.subtract(eye);
    away.y = 0;
    if (away.lengthSquared() > 1e-6) this.root.lookAt(this.root.position.add(away));
  }

  beginPointer(ray: Ray) {
    const pick = this.pick(ray);
    if (!pick?.pickedPoint || this.grabbed()) return false;
    if (!this.beginSlider('pointer', Matrix.Identity(), pick.pickedMesh, pick.pickedPoint)) {
      this.begin('pointer', Matrix.Identity());
    }
    this.dragPlane = Plane.FromPositionAndNormal(pick.pickedPoint, ray.direction.scale(-1));
    this.root.position.subtractToRef(pick.pickedPoint, this.dragOffset);
    return true;
  }

  updatePointer(ray: Ray) {
    if (!this.grabbed('pointer') || !this.dragPlane) return;
    const distance = ray.intersectsPlane(this.dragPlane);
    if (distance === null || distance <= 0 || distance > 6) return;
    if (this.sliderDrag && this.transparencySlider) {
      this.transparencySlider.setFromWorld(ray.origin.add(ray.direction.scale(distance)));
      return;
    }
    ray.origin.add(ray.direction.scale(distance)).addToRef(this.dragOffset, this.root.position);
    this.face(ray.origin);
  }

  beginSlider(source: string, world: Matrix, mesh?: AbstractMesh | null, point?: Vector3) {
    if (!this.root.isEnabled() || !this.transparencySlider?.hit(mesh, point)) return false;
    for (const panel of panels) panel.end(source);
    this.release();
    const start = point ?? this.transparencySlider.mesh.getAbsolutePosition();
    this.sliderDrag = { source, origin: world.getTranslation(), point: start.clone() };
    this.transparencySlider.beginDrag(start);
    return true;
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

export class DetachableFloatingPanel extends FloatingPanel {
  override begin(source: string, world: Matrix) {
    if (!this.root.isEnabled()) return;
    this.root.setParent(null);
    super.begin(source, world);
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

export function beginFloatingPanelGrab(source: string, world: Matrix, mesh?: AbstractMesh | null, point?: Vector3,
  tolerance = 0.03, moveOnly = false) {
  const panel = mesh ? [...panels].find(panel => panel.meshes.has(mesh))
    : point ? getFloatingPanelNear(point, tolerance) : undefined;
  if (panel && (moveOnly || !panel.beginSlider(source, world, mesh, point))) panel.begin(source, world);
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
