import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

const load = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
class Toggle extends EventTarget { checked = false; }
const toggle = new Toggle(), legacy = new Toggle(), calibration = new Toggle();
const engine = new NullEngine(), scene = new Scene(engine), root = new TransformNode('fieldRoot', scene);
const robot = new TransformNode('pathRobot', scene);
robot.parent = root;
const body = MeshBuilder.CreateBox('body', {}, scene); body.parent = robot;
const counts = Array.from({ length: 17 }, (_, i) => ({
  position: new Vector3(i, -.48, i * .2), rotationY: i / 16,
}));
let beat = 8, blank = null;
const context = vm.createContext({
  scene, Mesh, InstancedMesh, MeshBuilder, TransformNode, StandardMaterial, Matrix, Quaternion, Vector3, Color3, Event,
  chartGhostModeToggle: toggle, fieldChartModeToggle: legacy, floorCalibrationToggle: calibration,
  getBlankChartPageState: () => blank, getChartPageCounts: () => [0, 8, 16],
  getDrillLastCountIndex: () => 16, getGlobalCountIndex: () => beat,
  getRobotCounts: () => counts, setGhostBandPreviewEnabled() {},
});
const ghosts = name => scene.transformNodes.filter(node => node.name === name);
const render = () => scene.onBeforeRenderObservable.notifyObservers(scene);
try {
  vm.runInContext(load('../src/robot/marcherGhost.ts'), context);
  vm.runInContext(load('../src/robot/chartPageGhostMode.ts'), context);
  context.initChartPageGhostMode(root, () => [robot]);
  render();
  assert.equal(ghosts('beforeChartPageGhost').length, 0);
  const realPose = robot.position.clone();
  context.setChartGhostModeEnabled(true);
  assert.ok(toggle.checked);
  let before = ghosts('beforeChartPageGhost')[0], after = ghosts('afterChartPageGhost')[0];
  assert.ok(before.position.equals(counts[0].position) && after.position.equals(counts[16].position));
  assert.ok(Math.abs(after.rotationQuaternion.toEulerAngles().y - counts[16].rotationY) < 1e-6);
  assert.ok(before.getChildMeshes()[0].material.diffuseColor.equals(new Color3(.35, .8, 1)));
  assert.ok(after.getChildMeshes()[0].material.diffuseColor.equals(new Color3(1, .45, .85)));
  assert.ok(robot.position.equals(realPose), 'Preview never moves the real marcher or playhead');
  assert.ok([...before.getChildMeshes(), ...after.getChildMeshes()].every(mesh => !mesh.isPickable && !mesh.checkCollisions));
  render(); assert.equal(ghosts('beforeChartPageGhost')[0], before, 'Stable state reuses ghost meshes');
  root.position.set(2, 1, -3); root.rotation.y = .7; root.scaling.setAll(.04);
  const expected = Vector3.TransformCoordinates(counts[16].position, root.computeWorldMatrix(true));
  assert.ok(after.computeWorldMatrix(true).getTranslation().equalsWithEpsilon(expected, 1e-5));
  counts[16].position.x += 1;
  render(); assert.ok(ghosts('afterChartPageGhost')[0].position.equals(counts[16].position), 'Edits refresh previews');
  beat = 0; render();
  assert.equal(ghosts('beforeChartPageGhost').length, 0, 'First page has no before ghost');
  assert.ok(ghosts('afterChartPageGhost')[0].position.equals(counts[8].position));
  beat = 16; render();
  assert.equal(ghosts('afterChartPageGhost').length, 0, 'Final page has no after ghost');
  blank = {}; render();
  assert.equal(ghosts('beforeChartPageGhost').length, 0, 'Blank-page placement ghosts remain the sole preview on blank pages');
  blank = null; calibration.checked = true; render();
  assert.equal(ghosts('beforeChartPageGhost').length, 0);
  calibration.checked = false; render();
  assert.equal(ghosts('beforeChartPageGhost').length, 1);
  toggle.checked = false; toggle.dispatchEvent(new Event('change'));
  assert.equal(ghosts('beforeChartPageGhost').length, 0);
  assert.equal(context.isChartGhostModeEnabled(), false);
  legacy.checked = true;
  context.setChartGhostModeEnabled(true);
  assert.equal(legacy.checked, false, 'Enabling adjacent-page ghosts disables the duplicate legacy comparison');
  robot.dispose(); render();
  assert.equal(ghosts('beforeChartPageGhost').length, 0);
  console.log('Chart page ghost checks passed: before/current/after, colors, headings, noninteraction, boundaries, live edits, tabletop, blank pages, calibration, toggle and cleanup.');
} finally {
  scene.dispose(); engine.dispose();
}
