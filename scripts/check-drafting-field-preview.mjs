import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import '@babylonjs/core/Meshes/instancedMesh.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine();
const scene = new Scene(engine);
let now = 0;
const context = vm.createContext({
  scene, TransformNode, Matrix, Vector3, Observable,
  FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333, FIELD_SURFACE_Y: -0.48,
  performance: { now: () => now },
});
vm.runInContext(transform(read('../src/xr/ar.ts')), context);
vm.runInContext(transform(read('../src/field/draftingFieldPreview.ts')), context);
const camera = new FreeCamera('viewer', new Vector3(4, 1.7, -3), scene);
scene.activeCamera = camera;
const paths = new TransformNode('robotPathRoot', scene);
context.attachToARTransform(paths);
const turf = MeshBuilder.CreateGround('field', { width: 53.333, height: 120 }, scene);
turf.position.y = -0.48;
const robot = new TransformNode('pathRobot', scene);
robot.parent = paths; robot.position.set(3, 0, 4);
const body = MeshBuilder.CreateBox('marcherBody', { size: 1 }, scene);
body.parent = robot; body.position.y = 1;
body.material = new StandardMaterial('marcherMaterial', scene);
const instance = body.createInstance('instrumentInstance');
instance.parent = robot; instance.position.set(0.5, 1, 0);
const guide = MeshBuilder.CreateTube('drawingGuide', {
  path: [new Vector3(0, 0, 0), new Vector3(4, 0, 0)], radius: 0.012,
}, scene);
guide.parent = paths;
const excluded = MeshBuilder.CreateBox('drawingToolTrayBacking', {}, scene);
const preview = context.createDraftingFieldPreview(paths);
const copies = () => scene.meshes.filter(m => m.name.startsWith('draftingFullSizePreview-'));
const copyOf = mesh => scene.getMeshByName(`draftingFullSizePreview-${mesh.uniqueId}`);
const near = (a, b, message) => assert.ok(a.equalsWithEpsilon(b, 1e-4), `${message}: ${a} vs ${b}`);
const tick = () => {
  now += 250; scene.incrementRenderId(); scene.onBeforeRenderObservable.notifyObservers(scene);
};
try {
  context.captureContentRootMeshes();
  assert.equal(copies().length, 0, 'Optional preview allocates no copied meshes while off');
  context.fieldPreview = preview;
  const drawingSource = read('../src/interaction/fieldDrawingTools.ts');
  const modeStart = drawingSource.indexOf('  function setTableMode(');
  const modeEnd = drawingSource.indexOf('  function snapForDrafting(', modeStart);
  assert.ok(modeStart >= 0 && modeEnd > modeStart);
  vm.runInContext(stripTypeScriptTypes(`{
    let tableMode = false, previousFieldPose = null, previousGridVisible = false;
    const fullSizePreview = false, tools = [], draftingModeToggle = { checked: false };
    const fieldGridToggle = { checked: false, dispatchEvent() {} };
    const draftingTableControls = { hidden: true };
    const memoryWire = { panel: { grabbed: () => false }, handles: [] };
    const floorCalibrationToggle = { checked: false }, tabletopScaleButton = { click() {} };
    const deps = { prepare() {}, notify() {} }, tablePanel = { show() {}, hide() {} };
    function guidesBusy() { return false; }
    function action() {}
    function updateTableStatus() {}
    function show() {}
    function setMarcherPOVEnabled(enabled) { globalThis.povDisabled = !enabled; }
    ${drawingSource.slice(modeStart, modeEnd)}
    this.mode = { setTableMode, active: () => tableMode, grid: fieldGridToggle };
  }`, { mode: 'transform' }), context);
  context.Event = Event;
  context.setFieldHeightMode('floor');
  context.setARScale(0.37); context.setARRotation(0.6);
  context.setARPosition(new Vector3(5, 0.4, -8));
  const originalPosition = context.getARPosition();
  camera.position.y = 22;
  context.mode.setTableMode(true);
  assert.equal(context.povDisabled, true, 'Drafting entry stops marcher POV');
  assert.equal(context.mode.active(), true);
  assert.equal(context.getARScale(), 1 / 120, 'Drafting entry makes a one-meter-long field');
  assert.ok(Math.abs(context.getARSurfaceHeight() - (camera.globalPosition.y - 0.45)) < 1e-6,
    'Desktop table is placed below the viewer, even from an elevated spectator position');
  assert.equal(context.getFieldHeightMode(), 'table');
  context.mode.setTableMode(false);
  near(context.getARPosition(), originalPosition, 'Exit restores the previous field position');
  assert.equal(context.getARScale(), 0.37, 'Exit restores the previous field scale');
  assert.equal(context.getARRotation(), 0.6, 'Exit restores the previous field rotation');
  assert.equal(context.getFieldHeightMode(), 'floor');
  assert.equal(context.mode.grid.checked, false);
  const cameraClassName = camera.getClassName;
  camera.getClassName = () => 'WebXRCamera';
  camera.position.y = 1.1;
  context.mode.setTableMode(true);
  assert.ok(context.getARSurfaceHeight() <= 0.65 + 1e-6,
    'Seated XR table stays at least 45 cm below eye level');
  context.mode.setTableMode(false);
  camera.getClassName = cameraClassName;
  camera.position.y = 1.7;
  context.setARScale(1 / 120); context.setARRotation(0.7);
  context.setARPosition(new Vector3(8, 0.8, -4));
  preview.setEnabled(true, 0.2);
  assert.equal(copies().length, 4, 'Preview includes turf, marcher mesh, instanced instrument and guide only');
  assert.equal(copyOf(excluded), null, 'Tool trays are never duplicated');
  const root = scene.getTransformNodeByName('draftingFullSizePreview');
  assert.equal(root.parent, null, 'Full-size preview stays outside tabletop transforms');
  assert.equal(root.scaling.x, 1);
  const fieldSurface = Vector3.TransformCoordinates(new Vector3(0, -0.48, 0), root.computeWorldMatrix(true));
  assert.ok(Math.abs(fieldSurface.y - 0.2) < 1e-6, 'Preview surface sits on the requested floor');
  assert.ok(Vector3.Distance(root.position, camera.position) > 50, 'Preview is placed in the distance');
  const expectedBody = () => Vector3.TransformCoordinates(new Vector3(3, 1, 4), root.computeWorldMatrix(true));
  near(copyOf(body).getWorldMatrix().getTranslation(), expectedBody(), 'Marcher position is unscaled and field-local');
  const worldScale = new Vector3();
  copyOf(body).getWorldMatrix().decompose(worldScale);
  near(worldScale, Vector3.One(), 'Full-size marcher stays life-sized');
  for (const copy of copies()) {
    assert.equal(copy.isPickable, false);
    assert.equal(copy.checkCollisions, false);
    assert.equal(copy.metadata, null, 'Copies carry no editing metadata');
    assert.equal(copy.actionManager, null, 'Copies have no interaction actions');
  }
  robot.position.x = 6; tick();
  const expectedMoved = Vector3.TransformCoordinates(new Vector3(6, 1, 4), root.computeWorldMatrix(true));
  near(copyOf(body).getWorldMatrix().getTranslation(), expectedMoved, 'Playback and marcher movement update live');
  context.setARScale(0.02); context.setARRotation(-0.4); context.setARPosition(new Vector3(-2, 2, 5)); tick();
  near(copyOf(body).getWorldMatrix().getTranslation(), expectedMoved, 'Moving/resizing the table does not move the distant field');
  const material = new StandardMaterial('updatedMaterial', scene);
  body.material = material; tick();
  assert.equal(copyOf(body).material, material, 'Material changes update without duplicating textures');
  body.setEnabled(false); tick();
  assert.equal(copyOf(body).isEnabled(), false, 'Disabled source meshes are hidden in the view');
  body.setEnabled(true);
  const replacement = MeshBuilder.CreateTube('drawingGuide', {
    path: [Vector3.Zero(), new Vector3(8, 0, 0)], radius: 0.012,
  }, scene);
  replacement.parent = paths;
  const removedCopy = copyOf(guide);
  guide.dispose(); tick();
  assert.equal(removedCopy.isDisposed(), true, 'Replaced guides clean up their previous preview');
  assert.ok(copyOf(replacement), 'New and edited guides appear live');
  for (let i = 0; i < 3; i++) tick();
  assert.equal(copies().length, 4, 'Repeated updates never recursively duplicate previews');
  preview.setEnabled(false);
  assert.equal(copies().length, 0, 'Turning preview off disposes copied geometry holders');
  assert.equal(body.isDisposed(), false);
  assert.ok(body.material === material, 'Hiding preview preserves source material ownership');
  for (const rightHanded of [false, true]) {
    scene.useRightHandedSystem = rightHanded;
    camera.rotation.x = Math.PI / 2; camera.computeWorldMatrix(true);
    preview.setEnabled(true); tick();
    assert.ok(Number.isFinite(root.position.x + root.position.z), 'Vertical gaze has a valid placement fallback');
    preview.setEnabled(false);
  }
  preview.dispose();
  assert.equal(scene.getTransformNodeByName('draftingFullSizePreview'), null);
  console.log('Drafting full-size preview passed: world scale, distant floor placement, tabletop independence, live marcher/guide/material updates, instances, non-pickable copies, no recursion, and cleanup.');
} finally {
  scene.dispose(); engine.dispose();
}
