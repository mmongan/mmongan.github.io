import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { scene } from '../scene/engine';
import { fieldChartModeToggle, fieldChartModeStatus, drillEditSet, floorCalibrationToggle } from '../ui/dom';
import { FIELD_SURFACE_Y } from '../field/constants';
import { setMarcherPOVEnabled } from '../camera/marcherPOV';
import { createMarcherDragGhost } from './marcherGhost';
import {
  getRobotCounts, isGhostBandPreviewEnabled, onDrillTransportChangedObservable,
  pauseAll, seekToCount, setGhostBandPreviewEnabled,
} from './robot';

interface ChartSet { name: string; count: number }
interface ChartDependencies {
  root: TransformNode;
  getMarchers(): TransformNode[];
  prepare(): void;
}

export function buildChartArrowGeometry(moves: readonly { from: Vector3; to: Vector3 }[]) {
  const positions: number[] = [], indices: number[] = [], normals: number[] = [];
  for (const { from, to } of moves) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-6) continue;
    const x = dx / distance, z = dz / distance;
    const head = Math.min(0.7, distance * 0.35);
    const stemWidth = Math.min(0.055, distance * 0.04);
    const headWidth = Math.min(0.3, distance * 0.18);
    const base = positions.length / 3;
    const vertex = (along: number, across: number) => {
      positions.push(from.x + x * along - z * across, FIELD_SURFACE_Y + 0.065,
        from.z + z * along + x * across);
      normals.push(0, 1, 0);
    };
    vertex(0, stemWidth); vertex(0, -stemWidth);
    vertex(distance - head, stemWidth); vertex(distance - head, -stemWidth);
    vertex(distance - head, headWidth); vertex(distance - head, -headWidth);
    vertex(distance, 0);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3, base + 4, base + 5, base + 6);
  }
  return { positions, indices, normals };
}

export function createFieldChartMode(deps: ChartDependencies) {
  let sets: ChartSet[] = [];
  let ghosts: TransformNode[] = [];
  let arrows: Mesh | null = null;
  let signature = '';
  let syncing = false;
  let displayedSetIndex = -1;
  const material = new StandardMaterial('fieldChartArrowMaterial', scene);
  material.diffuseColor = new Color3(1, 0.72, 0.15);
  material.emissiveColor.copyFrom(material.diffuseColor);
  material.disableLighting = true;
  material.backFaceCulling = false;
  const active = () => !!fieldChartModeToggle?.checked;
  const selectedIndex = () => drillEditSet.value === '' ? -1 : Number(drillEditSet.value);
  const status = (message: string) => {
    if (fieldChartModeStatus && fieldChartModeStatus.textContent !== message) fieldChartModeStatus.textContent = message;
  };
  function clearVisuals() {
    ghosts.forEach(ghost => ghost.dispose());
    ghosts = [];
    arrows?.dispose(); arrows = null;
    signature = '';
  }
  function disable(message: string) {
    if (fieldChartModeToggle) fieldChartModeToggle.checked = false;
    clearVisuals();
    status(message);
  }
  function refresh() {
    if (!active()) return;
    if (floorCalibrationToggle?.checked) {
      disable('Chart mode off. Finish floor calibration before comparing sets.');
      return;
    }
    const index = selectedIndex(), current = sets[index], previous = sets[index - 1];
    if (!current || !previous) {
      clearVisuals();
      status(current ? `${current.name}: no previous set. Choose a later destination set to see ghosts and arrows.`
        : 'No drill sets loaded. Load or generate a drill to use chart mode.');
      return;
    }
    const marchers = deps.getMarchers().filter(robot => !robot.isDisposed() && robot.isEnabled());
    const entries = marchers.flatMap(robot => {
      const counts = getRobotCounts(robot);
      const from = counts?.[previous.count], to = counts?.[current.count];
      return from && to ? [{ robot, from, to }] : [];
    });
    const nextSignature = JSON.stringify([marchers.length, entries.map(({ robot, from, to }) => [
      robot.uniqueId, from.position.x, from.position.y, from.position.z, from.facingY ?? from.rotationY,
      to.position.x, to.position.y, to.position.z,
    ])]);
    if (signature === nextSignature) return;
    clearVisuals();
    signature = nextSignature;
    for (const { robot, from } of entries) {
      const ghost = createMarcherDragGhost(robot, robot);
      ghost.name = 'fieldChartGhost';
      ghost.setParent(deps.root);
      ghost.position.copyFrom(from.position);
      ghost.rotationQuaternion = Quaternion.FromEulerAngles(0, from.facingY ?? from.rotationY, 0);
      ghost.scaling.copyFrom(robot.scaling);
      ghosts.push(ghost);
    }
    const geometry = buildChartArrowGeometry(entries.map(({ from, to }) => ({ from: from.position, to: to.position })));
    if (geometry.positions.length) {
      arrows = new Mesh('fieldChartArrows', scene);
      const data = new VertexData();
      data.positions = geometry.positions; data.indices = geometry.indices; data.normals = geometry.normals;
      data.applyToMesh(arrows);
      arrows.parent = deps.root;
      arrows.material = material;
      arrows.isPickable = false;
    }
    const skipped = marchers.length - entries.length;
    status(`${previous.name} -> ${current.name}: ${entries.length} cyan previous-set ghosts; gold arrows point to the real band at count ${current.count}.` +
      (skipped ? ` ${skipped} marchers have no matching counts in both sets.` : '') +
      ' Holds have ghosts but no arrow. Arrows show displacement, not the traveled route.');
  }
  function changeContext() {
    clearVisuals();
    displayedSetIndex = selectedIndex();
    if (!active()) { status('Chart mode off. Compare the previous set with the selected destination set.'); return; }
    if (floorCalibrationToggle?.checked) {
      disable('Chart mode off. Finish floor calibration before comparing sets.');
      return;
    }
    const current = sets[selectedIndex()];
    if (!current) { refresh(); return; }
    syncing = true;
    try {
      deps.prepare();
      setMarcherPOVEnabled(false);
      setGhostBandPreviewEnabled(false);
      pauseAll();
      seekToCount(current.count);
    } finally { syncing = false; }
    refresh();
  }
  fieldChartModeToggle?.addEventListener('change', changeContext);
  drillEditSet.addEventListener('change', changeContext);
  const transportObserver = onDrillTransportChangedObservable.add(state => {
    // The selection editor seeks first when the shared destination selector changes.
    if (!active() || syncing || selectedIndex() !== displayedSetIndex) return;
    const current = sets[selectedIndex()];
    if (current && (state.playing || Math.abs(state.beat - current.count) > 1e-6 || isGhostBandPreviewEnabled())) {
      disable('Chart mode off because playback or the timeline changed. Enable it again to compare the selected sets.');
    }
  });
  const renderObserver = scene.onBeforeRenderObservable.add(refresh);
  function dispose() {
    fieldChartModeToggle?.removeEventListener('change', changeContext);
    drillEditSet.removeEventListener('change', changeContext);
    onDrillTransportChangedObservable.remove(transportObserver);
    scene.onBeforeRenderObservable.remove(renderObserver);
    clearVisuals(); material.dispose();
  }
  scene.onDisposeObservable.addOnce(dispose);
  status('Chart mode off. Compare the previous set with the selected destination set.');
  return {
    setPages(pages: readonly ChartSet[]) { sets = pages.map(page => ({ ...page })); changeContext(); },
    clear() { sets = []; clearVisuals(); status('No drill sets loaded. Load or generate a drill to use chart mode.'); },
  };
}
