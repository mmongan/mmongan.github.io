import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine(), scene = new Scene(engine);
engine.getDeltaTime = () => 100;
const canvases = [];
const context = vm.createContext({
  scene, StandardMaterial, MeshBuilder, AbstractMesh, TransformNode, Matrix, Vector3, Color3,
  performance, TOP_DOWN_MARKER_LAYER_MASK: 0x10000000,
  Texture: { TRILINEAR_SAMPLINGMODE: 3 },
  document: { createElement: () => {
    const calls = [];
    const ctx = new Proxy({ calls }, { get: (target, key) =>
      target[key] ?? ((...args) => calls.push([key, ...args])) });
    const canvas = { getContext: () => ctx };
    canvases.push(canvas);
    return canvas;
  } },
  DynamicTexture: class {
    constructor(name, canvas) { this.name = name; this.canvas = canvas; }
    update() {} dispose() {}
  },
});
try {
  scene.activeCamera = new FreeCamera('viewer', new Vector3(-28, 22, 0), scene);
  for (const file of ['constants', 'midfieldLogo', 'draftingFieldPreview']) {
    vm.runInContext(compile(read(`../src/field/${file}.ts`)), context);
  }
  const logo = context.createMidfieldLogo();
  assert.equal(logo.name, 'midfieldLogo');
  assert.equal(logo.position.x, 0);
  assert.equal(logo.position.z, 0);
  assert.equal(logo.position.y, -0.48 + 0.012, 'Logo sits just above turf, not at marcher height');
  assert.equal(logo.isPickable, false, 'Logo never intercepts field selection or placement');
  assert.equal(logo.checkCollisions, false);
  logo.computeWorldMatrix(true);
  const size = logo.getBoundingInfo().boundingBox.extendSizeWorld.scale(2);
  assert.ok(Math.abs(size.x - 6) < 1e-6 && Math.abs(size.z - 16) < 1e-6,
    'Six-by-sixteen-yard badge is centered on the fifty-yard line');
  const calls = canvases[0].getContext('2d').calls;
  assert.ok(calls.some(call => call[0] === 'scale' && call[1] === -1), 'Ground text compensates mirrored UVs');
  assert.ok(calls.some(call => call[0] === 'fillText' && call[1] === 'OpenChart'));
  assert.ok(calls.some(call => call[0] === 'fillText' && call[1] === 'xr'));
  const field = MeshBuilder.CreateGround('field', { width: 53.333, height: 120 }, scene);
  field.position.y = -0.5;
  field.computeWorldMatrix(true);
  const pick = scene.pickWithRay(new Ray(new Vector3(0, 10, 0), Vector3.Down(), 20));
  assert.equal(pick.pickedMesh, field, 'Ray at center field still reaches the turf');
  const coordinates = new TransformNode('fieldCoordinates', scene);
  const preview = context.createDraftingFieldPreview(coordinates);
  preview.setEnabled(true);
  assert.ok(scene.getMeshByName(`draftingFullSizePreview-${logo.uniqueId}`),
    'Full-size drafting preview includes the same midfield logo');
  preview.dispose();
  const source = read('../src/field/videoBoard.ts');
  const start = source.indexOf('function createVideoField(');
  const end = source.indexOf('// A straight-down orthographic view', start);
  vm.runInContext(compile(source.slice(start, end)), context);
  const videoField = context.createVideoField();
  for (const level of ['highschool', 'college', 'nfl']) videoField.updateFieldLevel(level);
  assert.equal(videoField.logo.material, logo.material, 'Live board shares the logo artwork and fade material');
  assert.equal(videoField.logo.parent, videoField.mesh);
  assert.equal(videoField.logo.isPickable, false);
  assert.equal(videoField.logo.position.y, 0.012);
  for (let frame = 0; frame < 50; frame++) scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(logo.material.alpha, 1, 'Logo remains visible for the first five seconds');
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(logo.material.alpha, 0.875, 'Startup timer begins a smooth fade, not an abrupt hide');
  for (let frame = 0; frame < 7; frame++) scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(logo.material.alpha, 0, 'Logo disappears after its five-second hold and 800 ms fade');
  assert.equal(videoField.logo.material.alpha, 0, 'Live board fades with the field without repainting its texture');
  for (let frame = 0; frame < 10; frame++) scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(logo.material.alpha, 0, 'Logo stays hidden rather than returning after startup');
  assert.equal(scene.meshes.filter(mesh => mesh.name === 'midfieldLogo').length, 1);
  console.log('Midfield logo checks passed: centered dimensions, readable UV orientation, non-pickable turf overlay, shared live-board artwork, all field levels, and drafting preview inclusion.');
} finally {
  scene.dispose();
  engine.dispose();
}
