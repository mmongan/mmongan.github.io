import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { DetachableFloatingPanel } from '../menu/floatingPanel';
import { FIELD_SURFACE_Y } from '../field/constants';

interface MemoryWireDependencies {
  dock: TransformNode;
  field: TransformNode;
  prepare(): boolean;
  allowed(): boolean;
  selected(): void;
  commit(points: Vector3[]): void;
}

export function createMemoryWire(deps: MemoryWireDependencies) {
  const root = new TransformNode('fieldTool-wire', scene);
  root.rotationQuaternion = Quaternion.Identity();
  const material = new StandardMaterial('memoryWireCopper', scene);
  material.diffuseColor = new Color3(0.85, 0.42, 0.16);
  material.specularColor = new Color3(0.8, 0.65, 0.4);
  const beadMaterial = new StandardMaterial('memoryWireBeads', scene);
  beadMaterial.diffuseColor = new Color3(0.15, 0.85, 0.9);
  const points = Array.from({ length: 9 }, (_, index) => new Vector3((index - 4) * 0.04, -0.12, 0));
  const grip = MeshBuilder.CreateBox('memoryWireGrip', { width: 0.055, height: 0.025, depth: 0.04 }, scene);
  grip.parent = root; grip.position.set(0, -0.05, 0.055); grip.material = material;
  let stem = MeshBuilder.CreateTube('memoryWireStem', {
    path: [grip.position.clone(), new Vector3(0, -0.12, 0)], radius: 0.005, tessellation: 8, updatable: true,
  }, scene);
  stem.parent = root; stem.material = material;
  const bodyMeshes = new Set<AbstractMesh>([grip, stem]);
  let wire = MeshBuilder.CreateTube('memoryWireBody', { path: points, radius: 0.004, tessellation: 8, updatable: true }, scene);
  wire.parent = root; wire.material = material; wire.isPickable = false;
  let pending: Vector3[] | null = null;

  class WireGrip extends DetachableFloatingPanel {
    override begin(source: string, world: Matrix) {
      if (!deps.prepare()) return;
      deps.selected();
      super.begin(source, world);
    }
  }
  const panel = new WireGrip(root, bodyMeshes, grip, new Vector3(0.03, 0.015, 0.025));
  class BendHandle extends DetachableFloatingPanel {
    override begin(source: string, world: Matrix) {
      if (!deps.prepare()) return;
      deps.selected();
      root.setParent(null);
      super.begin(source, world);
    }
    override end(source: string) {
      const wasHeld = this.grabbed(source);
      super.end(source);
      if (wasHeld && !this.grabbed()) this.root.setParent(root);
    }
  }
  const handles = points.map((point, index) => {
    const node = new TransformNode(`memoryWireBend-${index}`, scene);
    node.parent = root; node.position.copyFrom(point);
    const bead = MeshBuilder.CreateSphere(`memoryWireBead-${index}`, { diameter: 0.019, segments: 8 }, scene);
    bead.parent = node; bead.material = beadMaterial;
    return new BendHandle(node, new Set([bead]), node, new Vector3(0.01, 0.01, 0.01));
  });
  function returnToDock() {
    panel.release();
    handles.forEach(handle => {
      handle.release();
      handle.root.setParent(root);
    });
    pending = null;
    root.parent = deps.dock;
    root.position.set(0.3, 0.03, -0.12);
    root.rotationQuaternion!.copyFrom(Quaternion.FromEulerAngles(-Math.PI / 2, 0, 0));
    root.scaling.setAll(0.65);
  }
  function reset() {
    handles.forEach((handle, index) => {
      handle.release(); handle.root.setParent(root);
      handle.root.position.set((index - 4) * 0.04, -0.12, 0);
      points[index].copyFrom(handle.root.position);
    });
    wire = MeshBuilder.CreateTube('memoryWireBody', { path: points, instance: wire });
    stem = MeshBuilder.CreateTube('memoryWireStem', { path: [grip.position.clone(), points[4]], instance: stem });
    pending = null;
  }
  function shapeAt(start: Vector3, end: Vector3): Vector3[] {
    const direction = end.subtract(start);
    const length = direction.length();
    if (length < 0.05) return [];
    const angle = Math.atan2(direction.z, direction.x);
    return points.map(point => {
      const x = point.x - points[0].x, z = point.z - points[0].z;
      return new Vector3(start.x + (x * Math.cos(angle) - z * Math.sin(angle)) * length / 0.32,
        FIELD_SURFACE_Y + 0.025,
        start.z + (x * Math.sin(angle) + z * Math.cos(angle)) * length / 0.32);
    });
  }
  returnToDock();
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (!deps.allowed()) { pending = null; return; }
    if (!root.isEnabled()) return;
    const inverse = Matrix.Invert(root.computeWorldMatrix(true));
    let changed = false;
    handles.forEach((handle, index) => {
      const point = Vector3.TransformCoordinates(handle.root.computeWorldMatrix(true).getTranslation(), inverse);
      point.set(Math.max(-0.4, Math.min(0.4, point.x)), -0.12, Math.max(-0.4, Math.min(0.4, point.z)));
      if (!point.equalsWithEpsilon(points[index], 0.00001)) {
        points[index].copyFrom(point); changed = true;
      }
      if (handle.grabbed()) handle.root.position.copyFrom(Vector3.TransformCoordinates(point, root.getWorldMatrix()));
      else handle.root.position.copyFrom(point);
    });
    if (changed) {
      wire = MeshBuilder.CreateTube('memoryWireBody', { path: points, instance: wire });
      stem = MeshBuilder.CreateTube('memoryWireStem', { path: [grip.position.clone(), points[4]], instance: stem });
    }
    if (handles.some(handle => handle.grabbed())) { pending = null; return; }
    const fieldWorld = deps.field.computeWorldMatrix(true);
    const fieldInverse = Matrix.Invert(fieldWorld);
    const scale = Vector3.TransformNormal(Vector3.Up(), fieldWorld).length();
    const world = root.computeWorldMatrix(true);
    const aligned = Vector3.Dot(Vector3.TransformNormal(Vector3.Up(), world).normalize(),
      Vector3.TransformNormal(Vector3.Up(), fieldWorld).normalize()) >= 0.95;
    const projected = points.map(point => Vector3.TransformCoordinates(Vector3.TransformCoordinates(point, world), fieldInverse));
    const touching = panel.grabbed() && aligned && projected.every(point =>
      Math.abs(point.y - FIELD_SURFACE_Y) * scale <= 0.025);
    if (touching) {
      pending = projected.map(point => new Vector3(point.x, FIELD_SURFACE_Y + 0.025, point.z));
    } else if (pending) {
      const stamp = pending; pending = null; deps.commit(stamp);
    }
  });
  const dispose = () => {
    scene.onBeforeRenderObservable.remove(observer);
    handles.forEach(handle => handle.root.dispose());
    root.dispose(); material.dispose(); beadMaterial.dispose();
  };
  return { root, panel, handles, returnToDock, reset, shapeAt, dispose };
}
