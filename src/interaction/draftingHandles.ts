import type { Ray } from '@babylonjs/core/Culling/ray';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { Material } from '@babylonjs/core/Materials/material.pure';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { scene } from '../scene/engine';
import { DetachableFloatingPanel } from '../menu/floatingPanel';
import { FIELD_LENGTH_YARDS, FIELD_SURFACE_Y, FIELD_WIDTH_YARDS } from '../field/constants';

interface DraftingHandleOptions {
  field: TransformNode;
  points: Vector3[];
  material: Material;
  allowed(): boolean;
  prepare(): void;
  notify(message: string): void;
  changed(points: Vector3[]): boolean;
  translate?: boolean;
}

export function createDraftingHandles(options: DraftingHandleOptions) {
  const { field, points } = options;
  let blocked = false;
  function move(index: number, world: Vector3) {
    const point = Vector3.TransformCoordinates(world, Matrix.Invert(field.computeWorldMatrix(true)));
    point.y = FIELD_SURFACE_Y + 0.025;
    if (!Number.isFinite(point.x + point.z) || Math.abs(point.x) > FIELD_WIDTH_YARDS / 2 ||
      Math.abs(point.z) > FIELD_LENGTH_YARDS / 2) {
      if (!blocked) options.notify('Keep drafting pins inside the field.');
      blocked = true;
      return;
    }
    if (point.equalsWithEpsilon(points[index], 0.0001)) return;
    const delta = point.subtract(points[index]);
    const next = points.map((p, i) => options.translate ? p.add(delta) : i === index ? point : p.clone());
    if (next.some(p => Math.abs(p.x) > FIELD_WIDTH_YARDS / 2 || Math.abs(p.z) > FIELD_LENGTH_YARDS / 2)) {
      if (!blocked) options.notify('Keep the entire note inside the field.');
      blocked = true;
      return;
    }
    if (options.changed(next)) {
      points.forEach((p, i) => p.copyFrom(next[i]));
      blocked = false;
    } else if (!blocked) {
      options.notify('Pin move rejected: keep the guide on the field and its points separated.');
      blocked = true;
    }
  }
  class DraftPin extends DetachableFloatingPanel {
    constructor(readonly index: number) {
      const root = new TransformNode(`draftPin-${index}`, scene);
      root.parent = field; root.position.copyFrom(points[index]);
      const head = MeshBuilder.CreateSphere(`draftPinHead-${index}`, { diameter: 0.15, segments: 8 }, scene);
      head.parent = root; head.position.y = 0.035; head.scaling.y = 0.55; head.material = options.material;
      const shaft = MeshBuilder.CreateCylinder(`draftPinShaft-${index}`,
        { height: 0.12, diameter: 0.025, tessellation: 8 }, scene);
      shaft.parent = root; shaft.material = options.material;
      super(root, new Set([head, shaft]), root, new Vector3(0.08, 0.07, 0.08));
    }
    override begin(source: string, world: Matrix) {
      if (!options.allowed()) { options.notify('Finish floor calibration before editing drafting pins.'); return; }
      options.prepare();
      super.begin(source, world);
    }
    override update(source: string, world: Matrix) {
      super.update(source, world);
      if (this.grabbed(source)) constrain(this);
    }
    override updatePointer(ray: Ray) {
      if (!this.grabbed('pointer')) return;
      if (!options.allowed()) { this.release(); return; }
      const world = field.computeWorldMatrix(true);
      const origin = Vector3.TransformCoordinates(new Vector3(0, FIELD_SURFACE_Y + 0.025, 0), world);
      const normal = Vector3.TransformNormal(Vector3.Up(), world).normalize();
      const distance = ray.intersectsPlane(Plane.FromPositionAndNormal(origin, normal));
      if (distance !== null && distance > 0) move(this.index, ray.origin.add(ray.direction.scale(distance)));
      restore(this);
    }
  }
  function restore(pin: DraftPin) {
    const fieldScale = Vector3.TransformNormal(Vector3.Up(), field.computeWorldMatrix(true)).length();
    const localScale = Math.max(1, 0.012 / Math.max(0.0001, 0.15 * fieldScale));
    if (pin.grabbed()) {
      pin.root.position.copyFrom(Vector3.TransformCoordinates(points[pin.index], field.computeWorldMatrix(true)));
      pin.root.scaling.setAll(localScale * fieldScale);
    } else {
      pin.root.setParent(field);
      pin.root.position.copyFrom(points[pin.index]);
      pin.root.scaling.setAll(localScale);
    }
  }
  function constrain(pin: DraftPin) {
    if (!options.allowed()) { pin.release(); restore(pin); return; }
    move(pin.index, pin.root.computeWorldMatrix(true).getTranslation());
    restore(pin);
  }
  const pins = points.map((_, index) => new DraftPin(index));
  const observer = scene.onBeforeRenderObservable.add(() => {
    pins.forEach(pin => {
      if (pin.grabbed()) constrain(pin);
      else restore(pin);
    });
  });
  return {
    meshes: pins.flatMap(pin => [...pin.meshes]),
    grabbed: () => pins.some(pin => pin.grabbed()),
    dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      pins.forEach(pin => { pin.release(); pin.root.dispose(); });
    },
  };
}
