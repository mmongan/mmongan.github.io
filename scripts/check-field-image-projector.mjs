import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
class Control extends EventTarget { checked = false; value = ''; textContent = ''; files = []; }
const controls = Object.fromEntries(['floorCalibrationToggle', 'fieldProjectorButton', 'fieldProjectorFile',
  'fieldProjectorToggle', 'fieldProjectorX', 'fieldProjectorZ', 'fieldProjectorWidth', 'fieldProjectorRotation',
  'fieldProjectorOpacity', 'fieldProjectorFitButton', 'fieldProjectorClearButton', 'fieldProjectorStatus']
  .map(name => [name, new Control()]));
const engine = new NullEngine(), scene = new Scene(engine), root = new TransformNode('robotPathRoot', scene);
const registered = new Map(), textures = [], warnings = [], notices = [];
let placements = 0, releases = 0, closedBitmaps = 0;
let decode = async file => ({ width: file.width ?? 200, height: file.height ?? 100, close() { closedBitmaps++; } });
const context = vm.createContext({
  scene, Mesh, MeshBuilder, VertexData, TransformNode, StandardMaterial, Vector3, Color3, ...controls,
  FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120, FIELD_SURFACE_Y: -.48,
  document: { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) },
  createImageBitmap: file => decode(file),
  DynamicTexture: class {
    disposed = false;
    constructor(name, canvas) { this.name = name; this.canvas = canvas; textures.push(this); }
    update() {} dispose() { this.disposed = true; }
  },
  console: { warn: (...args) => warnings.push(args) },
  drawPanelButton() {},
  registerMenuButton: (mesh, hit) => registered.set(mesh, hit),
  FloatingPanel: class {
    placeForViewer() { placements++; }
    release() { releases++; }
  },
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const file = (overrides = {}) => ({ name: 'trace.png', type: 'image/png', size: 100, ...overrides });
const upload = async value => {
  controls.fieldProjectorFile.files = [value];
  controls.fieldProjectorFile.dispatchEvent(new Event('change'));
  await tick();
};
const projection = () => scene.getMeshByName('fieldImageProjection');
const change = (input, value, event = 'change') => {
  controls[input].value = String(value); controls[input].dispatchEvent(new Event(event));
};
const action = command => context.executeFieldProjectorAction(command);
try {
  vm.runInContext(transform(read('../src/interaction/fieldImageProjectionGeometry.ts')), context);
  const build = context.buildFieldProjectionGeometry;
  const square = build({ x: 0, z: 0, width: 20, rotation: 0 }, 2);
  const expected = [-10, -.468, 5, 10, -.468, 5, 10, -.468, -5, -10, -.468, -5];
  square.positions.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9));
  assert.deepEqual([...square.uvs], [0, 1, 1, 1, 1, 0, 0, 0], 'Image top is +Z; texture is not mirrored');
  const turned = build({ x: 3, z: 4, width: 20, rotation: 90 }, 2);
  assert.ok(Math.abs(turned.positions[0] - 8) < 1e-9 && Math.abs(turned.positions[2] - 14) < 1e-9);
  for (const rotation of [-180, -73, 0, 35, 90, 180]) {
    const clipped = build({ x: 25, z: 58, width: 100, rotation }, .7);
    assert.ok(clipped.positions.length >= 9);
    clipped.positions.forEach((value, index) => {
      assert.ok(Number.isFinite(value));
      if (index % 3 === 0) assert.ok(Math.abs(value) <= 53.333 / 2 + 1e-9, 'Projection stays inside sidelines');
      if (index % 3 === 2) assert.ok(Math.abs(value) <= 60 + 1e-9, 'Projection stays inside end zones');
    });
    assert.ok(clipped.uvs.every(value => value >= -1e-9 && value <= 1 + 1e-9), 'Clipping interpolates valid UVs');
    for (let index = 0; index < clipped.positions.length / 3; index++) {
      const u = clipped.uvs[index * 2], v = clipped.uvs[index * 2 + 1];
      const x = (u - .5) * 100, z = (v - .5) * 100 / .7, angle = rotation * Math.PI / 180;
      assert.ok(Math.abs(clipped.positions[index * 3] - (25 + x * Math.cos(angle) + z * Math.sin(angle))) < 1e-8);
      assert.ok(Math.abs(clipped.positions[index * 3 + 2] - (58 - x * Math.sin(angle) + z * Math.cos(angle))) < 1e-8,
        'Clipped image keeps its original spatial mapping rather than stretching');
    }
  }
  assert.throws(() => build({ x: 0, z: 0, width: -1, rotation: 0 }, 1), /positive/);
  assert.throws(() => build({ x: NaN, z: 0, width: 1, rotation: 0 }, 1), /finite/);
  vm.runInContext(transform(read('../src/interaction/fieldImageProjector.ts')), context);
  context.initFieldImageProjector(root, message => notices.push(message));
  const device = scene.getTransformNodeByName('fieldImageProjector');
  assert.equal(device.isEnabled(), false);
  action('show');
  assert.equal(device.isEnabled(), true);
  assert.equal(placements, 1);
  assert.equal(registered.size, 13, 'Physical projector has all alignment/fade/toggle controls');
  action('toggle');
  assert.equal(projection(), null);
  assert.match(controls.fieldProjectorStatus.textContent, /Choose a local image/);
  await upload(file());
  const mesh = projection(), texture = mesh.material.diffuseTexture;
  assert.equal(mesh.parent, root, 'Projection follows existing field transforms');
  assert.equal(mesh.isPickable, false, 'Tracing picks pass through to the turf');
  assert.equal(mesh.checkCollisions, false);
  assert.equal(mesh.isEnabled(), true);
  assert.equal(mesh.material.alpha, .5);
  assert.equal(mesh.material.useAlphaFromDiffuseTexture, true);
  assert.equal(texture.hasAlpha, true, 'PNG/WebP transparency is preserved');
  assert.equal(controls.fieldProjectorToggle.checked, true);
  assert.equal(closedBitmaps, 1);
  change('fieldProjectorWidth', 20);
  change('fieldProjectorX', 3);
  change('fieldProjectorZ', -7);
  change('fieldProjectorRotation', 45);
  change('fieldProjectorOpacity', .25, 'input');
  assert.equal(mesh.material.alpha, .25);
  assert.equal(Number(controls.fieldProjectorX.value), 3);
  action('left'); action('up'); action('turnRight'); action('wider'); action('bright');
  assert.equal(Number(controls.fieldProjectorX.value), 2);
  assert.equal(Number(controls.fieldProjectorZ.value), -6);
  assert.equal(Number(controls.fieldProjectorRotation.value), 50);
  assert.equal(Number(controls.fieldProjectorWidth.value), 22);
  assert.ok(Math.abs(mesh.material.alpha - .35) < 1e-9);
  const beforeInvalid = [...mesh.getVerticesData('position')];
  change('fieldProjectorWidth', '');
  assert.match(controls.fieldProjectorStatus.textContent, /between/);
  assert.equal(Number(controls.fieldProjectorWidth.value), 22, 'Invalid entry restores previous valid size');
  assert.deepEqual([...mesh.getVerticesData('position')], beforeInvalid);
  controls.floorCalibrationToggle.checked = true; scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(mesh.isEnabled(), false);
  action('right'); assert.equal(Number(controls.fieldProjectorX.value), 2);
  controls.floorCalibrationToggle.checked = false; scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(mesh.isEnabled(), true);
  action('hide'); assert.equal(device.isEnabled(), false);
  assert.equal(mesh.isEnabled(), true, 'Putting the device away does not hide the field projection');
  assert.equal(releases, 1);
  action('toggle'); assert.equal(mesh.isEnabled(), false);
  action('toggle'); assert.equal(mesh.isEnabled(), true);
  root.scaling.setAll(.04); root.position.set(1, 2, 3); root.rotation.set(.2, .7, -.1);
  const local = Vector3.FromArray(mesh.getVerticesData('position'));
  assert.ok(Vector3.TransformCoordinates(local, mesh.computeWorldMatrix(true)).equalsWithEpsilon(
    Vector3.TransformCoordinates(local, root.computeWorldMatrix(true))), 'Image follows translated/rotated tabletop scale');
  await upload(file({ type: 'image/svg+xml' }));
  assert.equal(mesh.material.diffuseTexture, texture, 'Rejected format preserves existing image');
  await upload(file({ size: 17 * 1024 * 1024 }));
  assert.equal(mesh.material.diffuseTexture, texture, 'Oversized file preserves existing image');
  decode = async () => { throw new Error('Decode failed'); };
  await upload(file());
  assert.match(controls.fieldProjectorStatus.textContent, /Decode failed/);
  assert.equal(mesh.material.diffuseTexture, texture);
  assert.equal(warnings.length, 3, 'Format/size/decode failures are explicitly reported');
  decode = async value => ({ width: value.width ?? 200, height: value.height ?? 100, close() { closedBitmaps++; } });
  await upload(file({ width: 8000, height: 4000 }));
  assert.ok(texture.disposed, 'Successful replacement frees the old texture');
  assert.ok(projection().material.diffuseTexture.canvas.width <= 4096);
  assert.match(controls.fieldProjectorStatus.textContent, /resized/);
  let finish;
  decode = () => new Promise(resolve => { finish = resolve; });
  await upload(file({ name: 'pending.png' }));
  controls.fieldProjectorClearButton.dispatchEvent(new Event('click'));
  finish({ width: 100, height: 100, close() { closedBitmaps++; } }); await tick();
  assert.equal(projection(), null, 'Clearing cancels an in-flight replacement');
  assert.equal(controls.fieldProjectorToggle.checked, false);
  assert.equal(controls.fieldProjectorFile.value, '');
  const closedBefore = closedBitmaps;
  await upload(file());
  scene.dispose();
  finish({ width: 100, height: 100, close() { closedBitmaps++; } }); await tick();
  assert.equal(closedBitmaps, closedBefore + 1, 'Disposal closes a pending image without creating a GPU texture');
  const placedBefore = placements;
  controls.fieldProjectorButton.dispatchEvent(new Event('click'));
  assert.equal(placements, placedBefore, 'Disposal removes DOM input handlers');
  assert.equal(scene.meshes.length, 0);
  assert.ok(notices.length > 0);
  console.log('Field image projector checks passed: clipped/rotated aspect-correct UVs, local upload, transparency, sizing/opacity, desktop/XR actions, non-pickable tracing, tabletop transforms, calibration, error preservation, async cancellation, and cleanup.');
} finally { scene.dispose(); engine.dispose(); }
