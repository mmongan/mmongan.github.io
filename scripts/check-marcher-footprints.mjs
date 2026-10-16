import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const root = new TransformNode('field', scene);
const robot = new TransformNode('marcher', scene);
robot.parent = root;
class Toggle extends EventTarget { checked = false; }
const toggle = new Toggle(), calibration = new Toggle(), status = { textContent: '' };
let selected = null;
let counts = [
  { position: new Vector3(1, -0.48, 2), rotationY: 0 },
  { position: new Vector3(4, -0.48, 5), rotationY: 0, facingY: Math.PI / 2 },
  { position: new Vector3(4, -0.48, 5), rotationY: 0 },
];
const contacts = () => counts.map((count, index) => ({
  position: count.position, yaw: count.facingY ?? count.rotationY, left: index % 2 === 0, beat: index,
}));
const context = vm.createContext({
  scene, Mesh, VertexData, StandardMaterial, Color3, FIELD_SURFACE_Y: -0.48,
  marcherFootprintsToggle: toggle, marcherFootprintsStatus: status, floorCalibrationToggle: calibration,
  getRobotFootprintSource: () => counts?.length ? { key: JSON.stringify(counts), build: contacts } : null,
});
const source = readFileSync(new URL('../src/robot/marcherFootprints.ts', import.meta.url), 'utf8');
vm.runInContext(stripTypeScriptTypes(readFileSync(new URL('../src/robot/marcherFootContacts.ts', import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import .*?;\r?$/gm, '').replace(/export /g, ''), context);
for (const rate of [.5, 1, 2]) {
  const beats = context.gaitContactBeats(4, (_, beat) => beat * rate, (_, step) => step / rate);
  assert.deepEqual([...beats], Array.from({ length: 4 * rate }, (_, index) => index / rate));
}
const offsets = [0, .5, 1.5, 3.5, 4], rates = [.5, 1, 2, .5];
assert.deepEqual([...context.gaitContactBeats(4,
  (segment, beat) => offsets[segment] + (beat - segment) * rates[segment],
  (segment, step) => segment + (step - offsets[segment]) / rates[segment])], [0, 1.5, 2.25, 2.75]);
const discontinuous = context.gaitContactBeats(3,
  (segment, beat) => beat * (segment === 0 ? 1 : .5),
  (segment, step) => step / (segment === 0 ? 1 : .5));
assert.ok(discontinuous.includes(1), 'MIDI cadence discontinuity includes the newly entered stance');
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
const overlay = () => scene.getMeshByName('marcherFootprints');
const render = () => scene.onBeforeRenderObservable.notifyObservers(scene);
try {
  context.initMarcherFootprints(() => selected);
  assert.equal(overlay(), null);
  toggle.checked = true; toggle.dispatchEvent(new Event('change'));
  assert.ok(status.textContent.includes('Select a marcher'));
  selected = robot;
  const original = JSON.stringify(counts);
  render();
  const mesh = overlay();
  assert.equal(mesh.getTotalVertices(), 21);
  assert.equal(mesh.getTotalIndices(), 54);
  assert.equal(mesh.parent, root);
  assert.equal(mesh.isPickable, false);
  assert.equal(mesh.checkCollisions, false);
  assert.equal(JSON.stringify(counts), original);
  const geometry = context.buildMarcherFootprintGeometry(contacts());
  assert.equal(geometry.positions[0], 1, 'Print centers use actual contact positions without extra side offsets');
  assert.ok(Math.abs(geometry.positions[21] - 4) < 1e-9);
  assert.equal(geometry.positions[23], 5);
  assert.ok(geometry.positions[24] < geometry.positions[21], 'Shoe silhouette rotates with facing');
  assert.deepEqual([...geometry.colors.slice(0, 4)], [0.2, 0.9, 1, 1]);
  assert.deepEqual([...geometry.colors.slice(28, 32)], [1, 0.65, 0.15, 1]);
  assert.equal(geometry.positions[43], geometry.positions[22], 'Holds remain on the turf');
  render(); assert.equal(overlay(), mesh, 'Unchanged routes reuse geometry');
  root.position.set(3, 1, -2); root.rotation.set(0.2, 0.7, -0.1); root.scaling.setAll(0.04);
  root.computeWorldMatrix(true);
  const world = Vector3.TransformCoordinates(Vector3.FromArray(geometry.positions), mesh.computeWorldMatrix(true));
  const expected = Vector3.TransformCoordinates(Vector3.FromArray(geometry.positions), root.getWorldMatrix());
  assert.ok(world.equalsWithEpsilon(expected), 'Overlay follows tabletop transforms');
  counts[0].position.x = 8;
  render(); assert.ok(mesh.isDisposed()); assert.notEqual(overlay(), mesh);
  assert.equal(overlay().getVerticesData('position')[0], 8);
  calibration.checked = true; render(); assert.equal(overlay(), null);
  calibration.checked = false; render(); assert.ok(overlay());
  robot.setEnabled(false); render(); assert.equal(overlay(), null);
  robot.setEnabled(true); render(); assert.ok(overlay());
  counts = null; render(); assert.equal(overlay(), null);
  assert.ok(status.textContent.includes('no scheduled route'));
  counts = []; render(); assert.equal(overlay(), null);
  counts = [{ position: Vector3.Zero(), rotationY: -Math.PI }];
  render(); assert.equal(overlay().getTotalVertices(), 7);
  const another = new TransformNode('otherMarcher', scene); another.parent = root;
  selected = another;
  const beforeSwitch = overlay(); render(); assert.ok(beforeSwitch.isDisposed());
  selected = null; render(); assert.equal(overlay(), null);
  selected = another; render();
  toggle.checked = false; toggle.dispatchEvent(new Event('change')); assert.equal(overlay(), null);
  toggle.checked = true; toggle.dispatchEvent(new Event('change'));
  another.dispose(); render(); assert.equal(overlay(), null);
  selected = robot; render();
  scene.dispose();
  assert.equal(scene.meshes.length, 0);
  toggle.dispatchEvent(new Event('change'));
  assert.equal(scene.meshes.length, 0, 'Disposal unregisters the toggle listener');
  console.log('Marcher footprint checks passed: left/right geometry, facing, holds, route edits, selection, empty schedules, tabletop transforms, calibration, toggle, and cleanup.');
} finally { scene.dispose(); engine.dispose(); }
