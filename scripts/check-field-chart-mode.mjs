import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const root = new TransformNode('field', scene);
const robots = [0, 1, 2].map(index => {
  const robot = new TransformNode('pathRobot', scene);
  robot.parent = root;
  const body = MeshBuilder.CreateBox(`body${index}`, {}, scene);
  body.parent = robot; body.position.y = 1;
  return robot;
});
const point = (x, z) => new Vector3(x, -0.48, z);
const count = (x, z, yaw = 0) => ({ position: point(x, z), rotationY: yaw });
const schedules = new Map([
  [robots[0], [count(1, 2, 0.5), count(3, 4), count(6, 8)]],
  [robots[1], [count(-3, 2), count(-3, 2), count(-3, 2)]],
  [robots[2], [count(8, -4)]],
]);
class Control extends EventTarget {
  checked = false;
  value = '0';
}
const toggle = new Control(), selector = new Control(), calibration = new Control();
const status = { textContent: '' };
const transport = new Observable();
let beat = 0, playing = true, preview = false, pov = true, prepared = 0;
let editorEnabled = false, editorSyncing = false;
const notify = () => transport.notifyObservers({ beat, playing });
const applyPositions = () => {
  robots.forEach(robot => {
    const counts = schedules.get(robot);
    const value = counts?.[Math.min(beat, counts.length - 1)];
    if (value) {
      robot.position.copyFrom(value.position);
      robot.rotation.y = value.facingY ?? value.rotationY;
    }
  });
};
const context = vm.createContext({
  scene, Mesh, InstancedMesh, VertexData, TransformNode, StandardMaterial, Matrix, Quaternion, Vector3, Color3,
  FIELD_SURFACE_Y: -0.48, fieldChartModeToggle: toggle, fieldChartModeStatus: status,
  drillEditSet: selector, floorCalibrationToggle: calibration,
  getRobotCounts: robot => schedules.get(robot) ?? null,
  pauseAll: () => { playing = false; notify(); },
  seekToCount: count => { beat = count; applyPositions(); notify(); },
  setMarcherPOVEnabled: enabled => { pov = enabled; },
  setGhostBandPreviewEnabled: enabled => { preview = enabled; notify(); },
  isGhostBandPreviewEnabled: () => preview,
  onDrillTransportChangedObservable: transport,
});
selector.addEventListener('change', () => {
  if (!editorEnabled) return;
  editorSyncing = true;
  context.pauseAll();
  context.seekToCount(Number(selector.value));
  editorSyncing = false;
});
transport.add(state => {
  if (editorEnabled && !editorSyncing && state.beat !== Number(selector.value)) editorEnabled = false;
});
for (const file of ['marcherGhost', 'fieldChartMode']) {
  const source = readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8');
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
}
const mode = context.createFieldChartMode({ root, getMarchers: () => robots, prepare: () => { prepared++; } });
const ghosts = () => scene.transformNodes.filter(node => node.name === 'fieldChartGhost');
const arrows = () => scene.getMeshByName('fieldChartArrows');
const enable = () => { toggle.checked = true; toggle.dispatchEvent(new Event('change')); };
const select = index => { selector.value = String(index); selector.dispatchEvent(new Event('change')); };
const render = () => scene.onBeforeRenderObservable.notifyObservers(scene);
try {
  render();
  assert.equal(ghosts().length, 0, 'Chart mode defaults off');
  enable();
  assert.ok(status.textContent.includes('No drill sets'));
  assert.equal(playing, true, 'No-data toggle does not disturb playback');
  mode.setPages([{ name: 'A', count: 0 }, { name: 'B', count: 1 }, { name: 'C', count: 2 }]);
  assert.equal(playing, false);
  assert.equal(beat, 0);
  assert.ok(status.textContent.includes('no previous set'));
  assert.equal(ghosts().length, 0);
  preview = true;
  editorEnabled = true;
  select(1);
  assert.equal(editorEnabled, true, 'Changing sets in chart mode preserves multi-marcher edit mode');
  assert.equal(toggle.checked, true, 'Selection-editor transport notifications do not disable chart mode during a set change');
  assert.equal(beat, 1);
  assert.equal(playing, false);
  assert.equal(preview, false, 'Entry exits timeline ghost comparison');
  assert.equal(pov, false, 'Chart mode exits marcher POV');
  assert.ok(prepared > 0);
  assert.equal(ghosts().length, 2, 'Only schedules containing both counts receive ghosts');
  assert.ok(status.textContent.includes('1 marchers have no matching counts'));
  assert.ok(status.textContent.includes('A -> B'));
  const ghost = ghosts()[0];
  assert.ok(ghost.position.equals(schedules.get(robots[0])[0].position));
  assert.ok(Math.abs(ghost.rotationQuaternion.toEulerAngles().y - 0.5) < 1e-6);
  assert.ok(robots[0].position.equals(schedules.get(robots[0])[1].position));
  assert.ok(ghost.getChildMeshes().every(mesh => !mesh.isPickable && !mesh.checkCollisions));
  assert.equal(arrows().isPickable, false);
  assert.equal(arrows().getTotalVertices(), 7, 'A hold does not get a zero-length arrow');
  assert.equal(arrows().getTotalIndices(), 9);
  const arrow = arrows();
  render();
  assert.equal(arrows(), arrow, 'Stable charts do not rebuild each frame');
  assert.equal(ghosts()[0], ghost);
  const original = JSON.stringify([...schedules.values()]);
  for (const scale of [1, 0.04]) {
    root.position.set(3, 1, -2); root.rotation.set(0.2, 0.7, -0.1); root.scaling.setAll(scale);
    root.computeWorldMatrix(true);
    render();
    const expected = Vector3.TransformCoordinates(schedules.get(robots[0])[0].position, root.getWorldMatrix());
    assert.ok(ghost.computeWorldMatrix(true).getTranslation().equalsWithEpsilon(expected, 1e-5),
      'Ghost positions follow rotated/scaled tabletop fields');
    assert.equal(arrows().parent, root);
  }
  for (const [from, to] of [[point(0, 0), point(3, 4)], [point(5, -3), point(-4, 7)],
    [point(1, 1), point(1.001, 1)], [point(-3, 2), point(-3, 2)]]) {
    const geometry = context.buildChartArrowGeometry([{ from, to }]);
    if (from.equals(to)) {
      assert.equal(geometry.positions.length, 0);
      continue;
    }
    assert.equal(context.buildChartArrowGeometry([{ from: point(0, 0), to: point(1e-8, 0) }]).positions.length, 0,
      'Numerical-noise displacements do not create degenerate arrows');
    assert.equal(geometry.positions.length, 21);
    assert.equal(geometry.positions[18], to.x, 'Arrow tip is exactly at destination X');
    assert.ok(Math.abs(geometry.positions[20] - to.z) < 1e-9, 'Arrow tip is exactly at destination Z');
    assert.ok(geometry.positions.every(Number.isFinite));
    const direction = to.subtract(from);
    for (let index = 0; index < 7; index++) {
      const dx = geometry.positions[index * 3] - from.x, dz = geometry.positions[index * 3 + 2] - from.z;
      const along = (dx * direction.x + dz * direction.z) / direction.lengthSquared();
      assert.ok(along >= -1e-8 && along <= 1 + 1e-8, 'Arrow geometry stays within its displacement span');
    }
  }
  assert.equal(JSON.stringify([...schedules.values()]), original, 'Chart creation never mutates authored counts');
  schedules.get(robots[0])[0].position.x = -5;
  schedules.get(robots[0])[0].facingY = -0.7;
  render();
  assert.ok(ghost.isDisposed());
  assert.equal(ghosts()[0].position.x, -5, 'Previous-set edits refresh ghosts');
  assert.ok(Math.abs(ghosts()[0].rotationQuaternion.toEulerAngles().y + 0.7) < 1e-6);
  schedules.get(robots[0])[1].position.z = 9;
  render();
  assert.equal(arrows().getVerticesData('position')[20], 9, 'Destination edits refresh arrows');
  select(2);
  assert.equal(beat, 2);
  assert.ok(ghosts()[0].position.equals(schedules.get(robots[0])[1].position));
  assert.ok(status.textContent.includes('B -> C'));
  toggle.checked = false; toggle.dispatchEvent(new Event('change'));
  assert.equal(ghosts().length, 0); assert.equal(arrows(), null);
  assert.equal(beat, 2); assert.equal(playing, false, 'Exit does not auto-resume playback or rewind');
  enable();
  playing = true; notify();
  assert.equal(toggle.checked, false); assert.equal(ghosts().length, 0, 'Playing exits chart mode');
  enable();
  beat = 1.5; notify();
  assert.equal(toggle.checked, false); assert.equal(arrows(), null, 'Timeline movement exits chart mode');
  enable();
  preview = true; notify();
  assert.equal(toggle.checked, false, 'Timeline ghost preview exits chart mode even at the same beat');
  calibration.checked = true;
  enable();
  assert.equal(toggle.checked, false);
  assert.ok(status.textContent.includes('calibration'));
  calibration.checked = false;
  enable();
  robots[0].setEnabled(false); render();
  assert.equal(ghosts().length, 1); assert.equal(arrows(), null, 'Disabled marchers are removed from chart');
  robots[0].setEnabled(true); render();
  assert.equal(ghosts().length, 2);
  mode.clear();
  assert.equal(ghosts().length, 0); assert.equal(arrows(), null);
  selector.value = '';
  mode.setPages([]);
  assert.ok(status.textContent.includes('No drill sets'));
  selector.value = '1';
  mode.setPages([{ name: 'New opening', count: 0 }, { name: 'New end', count: 1 }]);
  assert.equal(beat, 1, 'Replacing a show while chart mode is armed pauses at its selected set');
  robots[0].dispose(); render();
  assert.equal(ghosts().length, 1, 'Disposed marchers release their chart ghost');
  const observersBeforeDispose = transport.observers.length;
  scene.dispose();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(transport.observers.length, observersBeforeDispose - 1, 'Scene disposal removes transport observer');
  assert.equal(scene.transformNodes.length, 0);
  console.log('Field chart mode checks passed: pause/seek, previous-set ghosts, arrow geometry and holds, short schedules, set switching and edits, tabletop transforms, playback/preview/calibration exit, scene replacement, and cleanup.');
} finally {
  scene.dispose(); engine.dispose();
}
