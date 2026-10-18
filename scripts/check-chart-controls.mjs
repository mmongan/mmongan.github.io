import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const load = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine(), scene = new Scene(engine);
let ghosts = false, drafting = false, playing = false, count = 8;
const steps = [], modes = [], seeks = [];
const context = vm.createContext({
  scene, Mesh, MeshBuilder, TransformNode, StandardMaterial, Matrix, Quaternion, Vector3, Plane, Color3, Ray, Observable,
  document: { createElement: () => {
    const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
    return { getContext: () => ctx };
  } },
  DynamicTexture: class {
    constructor(_, canvas) { this.ctx = canvas.getContext('2d'); }
    update() {} dispose() {}
  },
  Texture: { TRILINEAR_SAMPLINGMODE: 3 },
  drawPanelButton: (ctx, _, __, text) => { ctx.label = text; },
  PANEL_FRAME_COLOR: '#18263b', PANEL_PAPER_COLOR: '#fffdf7',
  FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333, END_ZONE_DEPTH_YARDS: 10,
  HASH_OFFSETS_YARDS: { highSchool: 17.777 }, getSelectedFieldLevel: () => 'highSchool',
  getBlankChartPageState: () => null, getDrillLastCountIndex: () => 16, getGlobalCountIndex: () => count,
  getChartPageCounts: () => [0, 8, 16], getChartPageTimeline: () => ({ authoredCounts: [0, 16] }),
  isAuthoredChartPage: value => value === 0 || value === 16,
  getRobotPositionsAtCount: value => [new Vector3(value, 0, 0)],
  getMarcherPOVRobot: () => null,
  getChartTransition: () => ({ shape: 'straight', pace: 'linear', styleIndex: 0 }),
  getChartTransitionLabels: () => ({ shape: 'Straight', pace: 'Linear', style: 'March' }),
  isChartGhostModeEnabled: () => ghosts, isDraftingTableMode: () => drafting,
  setChartGhostModeEnabled: value => { ghosts = value; },
  getDrillTransportState: () => ({ playing }),
  executeDrawingToolAction: action => { modes.push(action.tool); drafting = action.tool === 'table'; },
  toggleAllPlayback: () => { playing = !playing; },
  rewindAll: () => seeks.push('rewind'), fastForwardAll: () => seeks.push('fastForward'),
  stepAll: direction => steps.push(direction),
});
try {
  vm.runInContext(load(read('../src/interaction/editingMode.ts')), context);
  context.setDrillEditingEnabled(true);
  context.setDraftingToolsEnabled(true);
  scene.activeCamera = new FreeCamera('chartCamera', Vector3.Zero(), scene);
  for (const file of ['menu/handMenu', 'menu/floatingPanel', 'menu/panelTransparencySlider', 'menu/drillChartPad']) {
    vm.runInContext(load(read(`../src/${file}.ts`)), context);
  }
  const interaction = read('../src/interaction/pathInteraction.ts');
  const start = interaction.indexOf('function executeMenuAction(');
  const end = interaction.indexOf('\nconst handInteraction =', start);
  vm.runInContext(load(interaction.slice(start, end)), context);
  context.setDrillChartPadVisible(true);
  const root = scene.getTransformNodeByName('drillChartPadRoot');
  const button = name => scene.getMeshByName(`drillChartButton-${name}`);
  const action = name => context.executeMenuAction(context.getHandMenuHit({ pickedMesh: button(name) }));
  const label = name => button(name).material.diffuseTexture.ctx.label;
  for (const [name, expected] of [['ghostMode', 'chartGhostMode'], ['draftingMode', 'chartDraftingMode'],
    ['playPause', 'playPause'], ['stepBack', 'stepBack'], ['stepForward', 'stepForward']]) {
    assert.equal(context.getHandMenuHit({ pickedMesh: button(name) }).action, expected);
  }
  const binding = scene.getMeshByName('drillChartBinding');
  const front = binding.position.z - binding.getBoundingInfo().boundingBox.extendSize.z;
  for (const name of ['ghostMode', 'draftingMode']) {
    assert.ok(button(name).position.z < front, 'Header toggles sit in front of the solid binding');
  }
  assert.equal(label('ghostMode'), 'Ghosts off');
  action('ghostMode'); assert.ok(ghosts); assert.equal(label('ghostMode'), 'Ghosts on');
  action('ghostMode'); assert.equal(ghosts, false);
  action('draftingMode'); assert.ok(drafting); assert.equal(label('draftingMode'), 'Draft on');
  action('draftingMode'); assert.equal(drafting, false); assert.deepEqual(modes, ['table', 'tableExit']);
  action('playPause'); context.redrawDrillChartPad(); assert.ok(playing); assert.equal(label('playPause'), 'Pause');
  action('playPause'); context.redrawDrillChartPad(); assert.equal(playing, false); assert.equal(label('playPause'), 'Play');
  action('stepBack'); action('stepForward'); assert.deepEqual(steps, [-1, 1]);
  action('rewind'); action('fastForward'); assert.deepEqual(seeks, ['rewind', 'fastForward']);
  const fastTapStart = interaction.indexOf('    if (pointerInfo.type === PointerEventTypes.POINTERDOUBLETAP && !isMarcherPainting()) {');
  const fastTapEnd = interaction.indexOf('\n    if (pointerInfo.type !== PointerEventTypes.POINTERTAP', fastTapStart);
  assert.ok(fastTapStart >= 0 && fastTapEnd > fastTapStart);
  context.PointerEventTypes = { POINTERDOUBLETAP: 64 };
  context.isMarcherPainting = () => false;
  vm.runInContext(load(`function handleFastTap(pointerInfo) {${interaction.slice(fastTapStart, fastTapEnd)}}`), context);
  const pick = scene.pick;
  try {
    for (const name of ['ghostMode', 'draftingMode', 'playPause']) {
      scene.pick = () => ({ hit: true, pickedMesh: button(name) });
      context.handleFastTap({ type: 64 });
      context.redrawDrillChartPad();
      assert.equal(label(name), { ghostMode: 'Ghosts on', draftingMode: 'Draft on', playPause: 'Pause' }[name]);
      context.handleFastTap({ type: 64 });
      context.redrawDrillChartPad();
      assert.equal(label(name), { ghostMode: 'Ghosts off', draftingMode: 'Draft off', playPause: 'Play' }[name]);
    }
  } finally {
    scene.pick = pick;
  }
  ghosts = true; drafting = true; playing = true;
  context.redrawDrillChartPad();
  assert.equal(label('ghostMode'), 'Ghosts on'); assert.equal(label('draftingMode'), 'Draft on');
  assert.equal(label('playPause'), 'Pause', 'External state changes update chart labels');
  const controls = root.getChildMeshes().filter(mesh => mesh.name.startsWith('drillChartButton-'));
  const backing = scene.getMeshByName('drillChartBacking');
  const half = backing.getBoundingInfo().boundingBox.extendSize;
  for (const mesh of controls) {
    const size = mesh.getBoundingInfo().boundingBox.extendSize;
    assert.ok(Math.abs(mesh.position.x) + size.x <= half.x + .003, `${mesh.name} fits backing width`);
    assert.ok(Math.abs(mesh.position.y - backing.position.y) + size.y <= half.y + .003, `${mesh.name} fits backing height`);
  }
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j];
    const sa = a.getBoundingInfo().boundingBox.extendSize, sb = b.getBoundingInfo().boundingBox.extendSize;
    assert.ok(Math.abs(a.position.x - b.position.x) >= sa.x + sb.x - .0001 ||
      Math.abs(a.position.y - b.position.y) >= sa.y + sb.y - .0001, `${a.name} does not overlap ${b.name}`);
  }
  const scaleBefore = root.scaling.x;
  const chrome = command => scene.getMeshByName(`drillChartPadRootPanel-${command}`);
  context.executeMenuAction(context.getHandMenuHit({ pickedMesh: chrome('larger') }));
  assert.ok(Math.abs(root.scaling.x - scaleBefore * 1.2) < 1e-6);
  context.executeMenuAction(context.getHandMenuHit({ pickedMesh: chrome('smaller') }));
  assert.ok(Math.abs(root.scaling.x - scaleBefore) < 1e-6);
  context.executeMenuAction(context.getHandMenuHit({ pickedMesh: chrome('close') }));
  assert.equal(root.isEnabled(), false, 'Shared close dispatches the chart hide lifecycle');
  context.setDrillChartPadVisible(true);
  assert.equal(root.isEnabled(), true, 'Chart reopens normally after shared close');
  context.setDraftingToolsEnabled(false);
  root.position.set(1, 2, 3); root.scaling.setAll(0.75);
  const previousPose = root.computeWorldMatrix(true).clone();
  context.setDrillChartPadVisible(false);
  context.setDraftingToolsEnabled(true);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(root.isEnabled(), true, 'Drafting opens the chart whiteboard');
  assert.equal(root.scaling.x, 5, 'Whiteboard is room-sized');
  context.setDraftingToolsEnabled(false);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(root.isEnabled(), false, 'Leaving drafting restores prior chart visibility');
  assert.ok(root.computeWorldMatrix(true).asArray().every((value, index) =>
    Math.abs(value - previousPose.asArray()[index]) < 1e-6), 'Leaving drafting restores the original chart pose and size');
  console.log('Chart controls passed: ghost/drafting toggles, shared transport, common resize/close and reopen, state labels, and nonoverlapping controls.');
} finally {
  scene.dispose(); engine.dispose();
}
