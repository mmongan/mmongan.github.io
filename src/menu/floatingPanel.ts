import type { Ray } from '@babylonjs/core/Culling/ray';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { scene } from '../scene/engine';
import { registerMenuButton, type HandMenuHit } from './handMenu';
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
  private viewerPlacement: ViewerPlacement | null = null;
  private closed = false;
  userPlaced = false;
  get canGrab() { return true; }
  get hasPanelChrome() { return true; }

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
    const shortSide = Math.min(halfSize.x, halfSize.y);
    if (meshes.size && shortSide >= 0.1 && this.hasPanelChrome) {
      if (!this.resize) {
        let initialScale: number | null = null;
        const getScale = () => {
          initialScale ??= root.scaling.length();
          return root.scaling.length() / initialScale;
        };
        this.resize = {
          getScale,
          setScale: value => {
            const scale = Math.min(3, Math.max(0.25, value));
            root.scaling.scaleInPlace(scale / getScale());
            this.userPlaced = true;
          },
        };
      }
      const rim = Math.max(0.018, shortSide * 0.06);
      const depth = Math.max(0.055, shortSide * 0.16, halfSize.z * 2);
      const material = new StandardMaterial(`${root.name}GrabRimMaterial`, scene);
      material.diffuseColor = Color3.FromHexString('#18263b');
      material.emissiveColor = new Color3(0.03, 0.1, 0.14);
      material.specularColor = new Color3(0.35, 0.45, 0.5);
      const rails = [
        { x: -halfSize.x - rim / 2, y: 0, width: rim, height: halfSize.y * 2 + rim * 2 },
        { x: halfSize.x + rim / 2, y: 0, width: rim, height: halfSize.y * 2 + rim * 2 },
        { x: 0, y: -halfSize.y - rim / 2, width: halfSize.x * 2, height: rim },
        { x: 0, y: halfSize.y + rim / 2, width: halfSize.x * 2, height: rim },
      ];
      rails.forEach(({ x, y, width, height }, index) => {
        const rail = MeshBuilder.CreateBox(`${root.name}GrabRim-${index}`, { width, height, depth }, scene);
        rail.parent = surface;
        rail.position.set(x, y, halfSize.z / 2);
        rail.material = material;
        meshes.add(rail);
      });
      const size = Math.max(0.035, shortSide * 0.24);
      const y = halfSize.y + rim + size / 2;
      const front = -Math.max(halfSize.z, depth / 2) - rim;
      const header = MeshBuilder.CreateBox(`${root.name}PanelHeader`,
        { width: halfSize.x * 2 + rim * 2, height: size + rim, depth }, scene);
      header.parent = surface;
      header.position.set(0, y, halfSize.z / 2);
      header.material = material;
      meshes.add(header);
      const controlMaterial = new StandardMaterial(`${root.name}PanelControlMaterial`, scene);
      controlMaterial.diffuseColor = Color3.FromHexString('#38bdf8');
      controlMaterial.emissiveColor = Color3.FromHexString('#38bdf8').scale(0.5);
      const glyphMaterial = new StandardMaterial(`${root.name}PanelGlyphMaterial`, scene);
      glyphMaterial.diffuseColor = Color3.White();
      glyphMaterial.emissiveColor = Color3.White();
      glyphMaterial.disableLighting = true;
      (['smaller', 'larger', 'close'] as const).forEach((command, index) => {
        const x = halfSize.x - size / 2 - (2 - index) * size * 1.25;
        const button = MeshBuilder.CreateBox(`${root.name}Panel-${command}`,
          { width: size, height: size, depth: rim }, scene);
        button.parent = surface;
        button.position.set(x, y, front);
        button.material = controlMaterial;
        const action: HandMenuHit = { action: 'panelControl', panelId: root.uniqueId, command };
        const own = (mesh: AbstractMesh) => {
          meshes.add(mesh); buttons.set(mesh, action); registerMenuButton(mesh, action);
        };
        own(button);
        for (let line = 0; line < (command === 'smaller' ? 1 : 2); line++) {
          const glyph = MeshBuilder.CreateBox(`${root.name}Panel-${command}Glyph${line}`,
            { width: size * 0.58, height: size * 0.09, depth: rim * 0.2 }, scene);
          glyph.parent = button;
          glyph.position.z = -rim * 0.65;
          glyph.rotation.z = command === 'close' ? (line ? -1 : 1) * Math.PI / 4 : line * Math.PI / 2;
          glyph.material = glyphMaterial;
          own(glyph);
        }
      });
      this.halfSize = new Vector3(halfSize.x + rim, halfSize.y + rim * 1.5 + size,
        Math.max(depth / 2 + halfSize.z / 2, -front + rim));
      root.onDisposeObservable.addOnce(() => material.dispose());
      root.onDisposeObservable.addOnce(() => { controlMaterial.dispose(); glyphMaterial.dispose(); });
    }

    panels.add(this);
    root.onDisposeObservable.addOnce(() => {
      panels.delete(this);
    });
  }

  control(command: 'close' | 'smaller' | 'larger'): HandMenuHit | null {
    if (command !== 'close') {
      if (this.resize) {
        this.resize.setScale(this.resize.getScale() * (command === 'larger' ? 1.2 : 1 / 1.2));
        this.userPlaced = true;
      }
      return null;
    }
    this.release();
    this.closed = true;
    for (const action of this.buttons.values()) {
      if (action.action === 'drawingTool' && action.tool === 'toolboxStore') {
        this.root.setEnabled(false);
        return action;
      }
      if (action.action === 'drillChartHide' || action.action === 'musicStandHide' ||
        action.action === 'instrumentPanelHide' || action.action === 'xrSettingsHide' ||
        (action.action === 'drawingTool' && (action.tool === 'hide' || action.tool === 'tableExit')) ||
        (action.action === 'marcherPaint' && action.command === 'done') ||
        (action.action === 'fieldProjector' && action.command === 'hide')) {
        this.closed = false;
        return action;
      }
    }
    this.root.setEnabled(false);
    return null;
  }

  near(point: Vector3, tolerance = 0.03) {
    if (!this.canGrab || !this.root.isEnabled()) return false;
    const inverse = this.surface.computeWorldMatrix(true).clone().invert();
    const local = Vector3.TransformCoordinates(point, inverse);
    const margin = this.localMargin(inverse, tolerance);
    return Math.abs(local.x) <= this.halfSize.x + margin.x &&
      Math.abs(local.y) <= this.halfSize.y + margin.y &&
      Math.abs(local.z) <= this.halfSize.z + margin.z;
  }

  private localMargin(inverse: Matrix, distance: number) {
    const m = inverse.m;
    return new Vector3(Math.hypot(m[0], m[4], m[8]),
      Math.hypot(m[1], m[5], m[9]), Math.hypot(m[2], m[6], m[10])).scale(distance);
  }

  pick(ray: Ray) {
    if (!this.root.isEnabled()) return null;
    this.meshes.forEach(mesh => mesh.computeWorldMatrix(true));
    const pick = scene.pickWithRay(ray, mesh => this.meshes.has(mesh));
    return pick?.hit ? pick : null;
  }

  buttonNear(point: Vector3): HandMenuHit | null {
    if (!this.root.isEnabled()) return null;
    let nearest: HandMenuHit | null = null;
    let nearestDistance = Infinity;
    for (const [mesh, action] of this.buttons) {
      if (!mesh.isEnabled() || !mesh.isVisible) continue;
      const inverse = mesh.computeWorldMatrix(true).clone().invert();
      const local = Vector3.TransformCoordinates(point, inverse);
      const margin = this.localMargin(inverse, 0.01);
      const depth = this.localMargin(inverse, 0.04).z;
      const size = mesh.getBoundingInfo().boundingBox.extendSize;
      if (Math.abs(local.x) <= size.x + margin.x && Math.abs(local.y) <= size.y + margin.y &&
        Math.abs(local.z) <= size.z + depth) {
        const distance = Vector3.DistanceSquared(point, mesh.getBoundingInfo().boundingBox.centerWorld);
        if (distance < nearestDistance) {
          nearest = action;
          nearestDistance = distance;
        }
      }
    }
    return nearest;
  }

  begin(source: string, world: Matrix) {
    if (!this.canGrab || !this.root.isEnabled()) return;
    if (this.grabWorlds.has(source)) return;
    this.root.computeWorldMatrix(true);
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
        offset: this.root.getAbsolutePosition().subtract(midpoint),
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
      this.root.setAbsolutePosition(points[0].add(points[1]).scale(0.5)
        .add(this.stretch.offset.scale(actualRatio)));
      return;
    }
    if (this.source !== source) return;
    let pose = this.offset.multiply(world);
    if (this.root.parent) pose = pose.multiply(this.root.parent.computeWorldMatrix(true).clone().invert());
    pose.decompose(new Vector3(), this.root.rotationQuaternion!, this.root.position);
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

  // Pushes or pulls a one-handed grab along the line from the grabbing controller to the panel.
  telescope(source: string, delta: number) {
    if (this.source !== source || this.stretch || this.sliderDrag) return false;
    const offset = this.offset.getTranslation();
    const distance = offset.length();
    if (distance < 1e-4) offset.set(0, 0, 1);
    else offset.scaleInPlace(1 / distance);
    this.offset.setTranslation(offset.scale(Math.min(20, Math.max(0.05, distance + delta))));
    return true;
  }

  showForViewer(placement: ViewerPlacement) {
    this.viewerPlacement = placement;
    return this.userPlaced || this.placeForViewer(placement);
  }

  recall() {
    if (this.closed) {
      this.root.setEnabled(true);
      this.closed = false;
    }
    if (this.viewerPlacement) this.placeForViewer(this.viewerPlacement);
  }

  placeForViewer(placement: ViewerPlacement, recallable = true) {
    if (recallable) this.viewerPlacement = placement;
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
    this.root.setParent(null);
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
      this.root.setParent(null);
    }
    this.dragPlane = Plane.FromPositionAndNormal(pick.pickedPoint, ray.direction.scale(-1));
    this.root.getAbsolutePosition().subtractToRef(pick.pickedPoint, this.dragOffset);
    return true;
  }

  updatePointer(ray: Ray) {
    if (!this.grabbed('pointer') || !this.dragPlane) return;
    const distance = ray.intersectsPlane(this.dragPlane);
    if (distance === null || distance <= 0 || distance > 250) return;
    if (this.sliderDrag && this.transparencySlider) {
      this.transparencySlider.setFromWorld(ray.origin.add(ray.direction.scale(distance)));
      return;
    }
    this.root.setAbsolutePosition(ray.origin.add(ray.direction.scale(distance)).add(this.dragOffset));
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
    const offset = this.root.getAbsolutePosition().subtract(ray.origin);
    const distance = offset.length();
    if (distance < 1e-6) return false;
    const next = Math.min(3, Math.max(0.3, distance * Math.exp(delta * 0.001)));
    this.root.setParent(null);
    this.root.position.copyFrom(ray.origin.add(offset.scale(next / distance)));
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

export function recallFloatingPanels() {
  panels.forEach(panel => panel.recall());
}

export function executeFloatingPanelControl(hit: Extract<HandMenuHit, { action: 'panelControl' }>) {
  const panel = [...panels].find(panel => panel.root.uniqueId === hit.panelId);
  if (!panel) throw new Error('This panel is no longer available.');
  return panel.control(hit.command);
}

export function isFloatingPanelMesh(mesh: AbstractMesh) {
  return [...panels].some(panel => panel.canGrab && panel.root.isEnabled() && panel.meshes.has(mesh));
}

export function getFloatingPanelNear(point: Vector3, tolerance = 0.03) {
  return [...panels].filter(panel => panel.near(point, tolerance))
    .sort((a, b) => Vector3.DistanceSquared(point, a.root.getAbsolutePosition()) -
      Vector3.DistanceSquared(point, b.root.getAbsolutePosition()))[0];
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
  const panel = mesh ? [...panels].find(panel => panel.canGrab && panel.root.isEnabled() && panel.meshes.has(mesh))
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

export function telescopeFloatingPanelGrab(source: string, delta: number) {
  return [...panels].some(panel => panel.telescope(source, delta));
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
