import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { FIELD_SURFACE_Y, FIELD_WIDTH_YARDS } from './constants';

const PREVIEW_PREFIX = 'draftingFullSizePreview';

export function isDraftingPreviewSource(mesh: AbstractMesh) {
  if (mesh.name.startsWith(PREVIEW_PREFIX)) return false;
  for (let node = mesh.parent; node; node = node.parent) {
    if (node.name.startsWith(PREVIEW_PREFIX)) return false;
    if (node.name === 'pathRobot') return true;
  }
  return /^(field|midfieldLogo|fieldLines|hashMarks|leftEndZone|rightEndZone|goalLineNorth|goalLineSouth|leftSideline|rightSideline|drawingGuide|draftingGuideLabel|draftingStickyNote)$/.test(mesh.name) ||
    /^(turfStripe|yardLine|hashMark|yardNumber|topDownHashMarks|drawingGuideDivisionMark-)/.test(mesh.name);
}

export function createDraftingFieldPreview(fieldCoordinates: TransformNode) {
  const root = new TransformNode(PREVIEW_PREFIX, scene);
  const copies = new Map<AbstractMesh, AbstractMesh>();
  let enabled = false;
  let lastScan = -Infinity;
  root.setEnabled(false);
  function clear() {
    copies.forEach(copy => copy.dispose(false, false));
    copies.clear();
  }
  function sync() {
    if (!enabled) return;
    const now = performance.now();
    if (now - lastScan >= 200) {
      lastScan = now;
      for (const source of [...scene.meshes]) {
        if (copies.has(source) || !isDraftingPreviewSource(source)) continue;
        const copy = source.clone(`${PREVIEW_PREFIX}-${source.uniqueId}`, root, true);
        if (!copy) throw new Error(`Could not create full-size drafting preview for ${source.name}.`);
        copy.isPickable = false;
        copy.checkCollisions = false;
        copy.metadata = null;
        copy.actionManager = null;
        copy.renderingGroupId = 0;
        copies.set(source, copy);
      }
    }
    const inverse = Matrix.Invert(fieldCoordinates.computeWorldMatrix(true));
    const destination = root.computeWorldMatrix(true);
    for (const [source, copy] of copies) {
      if (source.isDisposed()) {
        copy.dispose(false, false); copies.delete(source); continue;
      }
      copy.setEnabled(source.isEnabled());
      copy.isVisible = source.isVisible;
      copy.visibility = source.visibility;
      copy.material = source.material;
      copy.layerMask = source.layerMask;
      copy.skeleton = source.skeleton;
      copy.morphTargetManager = source.morphTargetManager;
      const world = source.computeWorldMatrix(true).multiply(inverse).multiply(destination);
      copy.freezeWorldMatrix(world);
    }
  }
  const observer = scene.onBeforeRenderObservable.add(sync);
  return {
    setEnabled(value: boolean, floorY = 0) {
      enabled = value;
      root.setEnabled(value);
      if (!value) { clear(); return; }
      const camera = scene.activeCamera;
      if (!camera) throw new Error('A camera is required to place the full-size drafting preview.');
      camera.computeWorldMatrix();
      const forward = camera.getDirection(new Vector3(0, 0, scene.useRightHandedSystem ? -1 : 1));
      forward.y = 0;
      if (forward.lengthSquared() < 1e-6) {
        const right = camera.getDirection(Vector3.Right());
        forward.set(-right.z, 0, right.x);
        if (scene.useRightHandedSystem) forward.negateInPlace();
      }
      forward.normalize();
      root.position.copyFrom(camera.globalPosition.add(forward.scale(FIELD_WIDTH_YARDS / 2 + 30)));
      root.position.y = floorY - FIELD_SURFACE_Y;
      root.rotation.y = Math.atan2(forward.x, forward.z) + Math.PI / 2;
      lastScan = -Infinity;
      sync();
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      clear(); root.dispose();
    },
  };
}
