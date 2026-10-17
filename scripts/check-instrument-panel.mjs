import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine();
const scene = new Scene(engine);
const registered = new Map();
let placements = 0;
let releases = 0;
let selected = {};
let chosen;
let placementMode = false;
const models = [];
const toggleListeners = new Map();
const toggle = {
  checked: false,
  addEventListener: (event, listener) => toggleListeners.set(event, listener),
  removeEventListener: event => toggleListeners.delete(event),
};
const context = vm.createContext({
  scene, MeshBuilder, TransformNode, StandardMaterial, Vector3, Color3,
  instrumentPanelButton: null,
  instrumentPanelToggle: toggle,
  document: { createElement: () => ({ getContext: () => ({}) }) },
  DynamicTexture: class { update() {} dispose() {} },
  drawPanelButton() {}, PANEL_FRAME_COLOR: '#18263b',
  getInstrumentLabel: value => value,
  registerMenuButton: (mesh, hit) => registered.set(mesh, hit),
  addInstrumentButtonModel: (_, instrument) => models.push(instrument),
  FloatingPanel: class {
    placeForViewer() { placements++; return true; }
    release() { releases++; }
  },
  selectRobot: value => { selected = value; },
  chooseInstrument: value => {
    assert.equal(selected, null, 'Creation selection must not replace an existing marcher instrument');
    chosen = value;
  },
  setPlacementMode: value => { placementMode = value; },
  showPlacementNotice() {},
});
try {
  vm.runInContext(transform(read('../src/menu/instrumentPanel.ts')), context);
  const interaction = read('../src/interaction/pathInteraction.ts');
  const actionStart = interaction.indexOf('function executeMenuAction(');
  const actionEnd = interaction.indexOf('\nconst handInteraction =', actionStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  // Only the action dispatcher is needed; subsequent helpers may have module dependencies.
  const actionSource = interaction.slice(actionStart, actionEnd);
  let depth = 0;
  let end = actionSource.indexOf('{') + 1;
  for (let index = end - 1; index < actionSource.length; index++) {
    if (actionSource[index] === '{') depth++;
    if (actionSource[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  vm.runInContext(transform(actionSource.slice(0, end)), context);
  context.initInstrumentPanel();
  const root = scene.getTransformNodeByName('instrumentPanelRoot');
  assert.equal(root.isEnabled(), false);
  assert.equal(toggle.checked, false);
  toggle.checked = true;
  toggleListeners.get('change')();
  assert.equal(root.isEnabled(), true, 'Settings toggle shows the panel');
  toggle.checked = false;
  toggleListeners.get('change')();
  assert.equal(root.isEnabled(), false, 'Settings toggle hides the panel');
  assert.equal(releases, 1, 'Hiding through Settings releases grabs');
  placements = 0;
  releases = 0;
  assert.equal(root.parent, null, 'Room-scale panel must not inherit field scaling');
  context.summonInstrumentPanel();
  assert.equal(root.isEnabled(), true);
  assert.equal(toggle.checked, true, 'Summoning synchronizes the Settings toggle');
  assert.equal(placements, 1);
  const radios = [...read('../src/index.html').matchAll(/name="marcherInstrument" value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual([...models].sort(), radios.sort(), 'Panel offers every supported instrument exactly once');
  assert.equal(models.length, 17, 'Cymbals and all three guard equipment choices join the instrument picker');
  const done = scene.getMeshByName('instrumentPanelDone');
  done.computeWorldMatrix(true);
  for (const instrument of models) {
    const button = scene.getMeshByName(`instrumentPanel-${instrument}`);
    const label = scene.getMeshByName(`instrumentPanelLabel-${instrument}`);
    button.computeWorldMatrix(true);
    label.computeWorldMatrix(true);
    const backing = scene.getMeshByName('instrumentPanelBacking');
    backing.computeWorldMatrix(true);
    assert.ok(label.getBoundingInfo().boundingBox.minimumWorld.y >
      backing.getBoundingInfo().boundingBox.minimumWorld.y, 'Expanded panel contains every label');
    assert.ok(label.getBoundingInfo().boundingBox.minimumWorld.y >
      done.getBoundingInfo().boundingBox.maximumWorld.y, 'Done button never overlaps instrument/guard labels');
    assert.equal(registered.get(button).instrument, instrument);
    assert.equal(registered.get(label).instrument, instrument);
    selected = {};
    context.executeMenuAction(registered.get(button));
    assert.equal(chosen, instrument);
    assert.equal(placementMode, true);
  }
  context.executeMenuAction({ action: 'instrumentPanelHide' });
  assert.equal(root.isEnabled(), false);
  assert.equal(toggle.checked, false, 'Close synchronizes the Settings toggle');
  assert.equal(placementMode, true, 'Hiding the panel does not cancel placement');
  context.executeMenuAction({ action: 'instrumentPanelSummon' });
  context.executeMenuAction({ action: 'finishMarcherPlacement' });
  assert.equal(placementMode, false);
  assert.equal(toggle.checked, false, 'Done placing synchronizes the Settings toggle');
  assert.equal(root.isEnabled(), false);
  assert.equal(releases, 2);
  const handMenu = read('../src/menu/handMenu.ts');
  const instrumentStart = handMenu.indexOf('  const instrumentButtons = ([');
  const instrumentEnd = handMenu.indexOf('  buttons.push(...instrumentButtons);', instrumentStart);
  assert.ok(instrumentStart >= 0 && instrumentEnd > instrumentStart);
  const palmButtons = [];
  const palmContext = vm.createContext({
    spacing: 0.04,
    createButton: (label, x, hit) => {
      const mesh = MeshBuilder.CreatePlane(`palm-${label}`, { size: 0.03 }, scene);
      palmButtons.push([mesh, hit]);
      return mesh;
    },
  });
  vm.runInContext(transform(handMenu.slice(instrumentStart, instrumentEnd)), palmContext);
  assert.deepEqual(palmButtons.map(([, hit]) => hit.instrument).sort(), [...models].sort());
  assert.ok(palmButtons.every(([, hit]) => hit.action === 'createMarcher'),
    'Palm-up instrument buttons create new marchers rather than modifying the selected marcher');
  const updateStart = handMenu.indexOf('export function updateHandMenu(');
  const updateEnd = handMenu.indexOf('// Resolves a pick', updateStart);
  const progressPlane = MeshBuilder.CreatePlane('palm-progress', { size: 0.1 }, scene);
  const mediaButtons = ['rewind', 'stepBack', 'playPause', 'stepForward', 'fastForward'].map(action => [
    MeshBuilder.CreatePlane(`watch-${action}`, { size: 0.022 }, scene), { action },
  ]);
  const watchFace = MeshBuilder.CreateBox('watch-face', { size: 0.1 }, scene);
  const wrist = MeshBuilder.CreateBox('test-wrist', { size: 0.01 }, scene);
  let palmUp = true;
  Object.assign(palmContext, {
    openPalmHolds: new Map(), performance: { now: () => 0 },
    Vector3, Axis: { Y: Vector3.Up(), Z: Vector3.Forward() }, StandardMaterial,
    ensureMenuMeshes() {}, drawProgressBar() {},
    getHandMenuPose: position => ({
      position: position.clone(), normal: new Vector3(0, palmUp ? 1 : -1, 0),
      rotation: wrist.absoluteRotationQuaternion.clone(),
    }),
    handMenuAnchor: new TransformNode('test-menu-anchor', scene),
  });
  palmContext.progressPlane = progressPlane;
  palmContext.palmButtons = palmButtons;
  palmContext.mediaButtons = mediaButtons;
  palmContext.watchFace = watchFace;
  const watchRoot = new TransformNode('test-watch-root', scene);
  const plateRoot = new TransformNode('test-plate-root', scene);
  mediaButtons.forEach(([mesh]) => { mesh.parent = watchRoot; mesh.position.y = 0; });
  palmButtons.forEach(([mesh]) => { mesh.parent = plateRoot; mesh.position.y = 0; });
  watchFace.parent = watchRoot;
  progressPlane.parent = watchRoot;
  progressPlane.position.z = -0.019;
  palmContext.watchRoot = watchRoot;
  palmContext.instrumentPlateRoot = plateRoot;
  palmContext.watchPanel = { userPlaced: false };
  palmContext.instrumentPlatePanel = { userPlaced: false };
  vm.runInContext(`
    const progressBar = { plane: progressPlane, ctx: {}, texture: {} };
    const watchButtons = mediaButtons.map(([mesh]) => mesh);
    const watchMeshes = [watchFace];
    const instrumentPlateButtons = palmButtons.map(([mesh]) => mesh);
    const buttons = [...palmButtons, ...mediaButtons].map(([mesh]) => mesh);
    const buttonActions = new Map([...palmButtons, ...mediaButtons]);
    const formationButtons = [], letterButtons = [];
    let attachedTo = null, trackedHands = null, lastDrawnProgress = -1;
    let controllerMenuHand = "left", controllerInstrumentMenuOpen = true, controllerMediaMenuOpen = true;
    let controllerMenuShown = false;
    let draftingPlateRoot = null, draftingPlateAnchor = null;
    const draftingPlateButtons = [], draftingPlateMeshes = [];
    let formationLibraryPage = "closed";
    const activeInstrument = "trumpet";
    const BUTTON_Y = 0.09, PALM_UP_DOT_THRESHOLD = 0.5;
    const WATCH_Y = 0.035, WATCH_Z = 0.13;
  `, palmContext);
  vm.runInContext(transform(handMenu.slice(updateStart, updateEnd)), palmContext);
  const palmControllers = new Map([['left', { grip: wrist, inputSource: { handedness: 'left' } }]]);
  palmContext.updateHandMenu(palmControllers, 0);
  assert.ok(palmButtons.every(([mesh]) => mesh.isEnabled() && mesh.parent === plateRoot) &&
    plateRoot.parent === palmContext.handMenuAnchor,
    'X on the controller displays every instrument over that hand');
  assert.ok(mediaButtons.every(([mesh]) => mesh.isEnabled() && mesh.parent === watchRoot) &&
    watchRoot.parent === palmContext.handMenuAnchor && watchRoot.position.y === 0.035,
    'Transport buttons follow the wrist at watch height rather than palm-menu height');
  assert.equal(progressPlane.position.z, -0.019, 'Transport progress sits on the watch');
  assert.equal(watchFace.isEnabled(), true);
  vm.runInContext('formationLibraryPage = "shapes"', palmContext);
  palmContext.updateHandMenu(palmControllers, 0);
  assert.ok(mediaButtons.every(([mesh]) => mesh.isEnabled()), 'Watch stays usable in the formation library');
  assert.ok(palmButtons.every(([mesh]) => !mesh.isEnabled()));
  palmUp = false;
  vm.runInContext('formationLibraryPage = "closed"', palmContext);
  palmContext.updateHandMenu(palmControllers, 0);
  assert.ok(palmButtons.every(([mesh]) => mesh.isEnabled()) && mediaButtons.every(([mesh]) => mesh.isEnabled()),
    'Controller menus no longer depend on palm orientation');
  vm.runInContext('controllerInstrumentMenuOpen = false; controllerMediaMenuOpen = false;', palmContext);
  palmContext.updateHandMenu(palmControllers, 0);
  assert.ok(palmButtons.every(([mesh]) => !mesh.isEnabled()), 'Closing X hides instrument buttons');
  assert.ok(mediaButtons.every(([mesh]) => !mesh.isEnabled()));
  assert.equal(watchFace.isEnabled(), false, 'Closing Y hides the watch');
  vm.runInContext('controllerInstrumentMenuOpen = true; controllerMediaMenuOpen = true;', palmContext);
  palmUp = true;
  vm.runInContext('formationLibraryPage = "closed"', palmContext);
  palmContext.updateHandMenu(palmControllers, 0);
  watchRoot.setParent(null);
  plateRoot.setParent(null);
  palmContext.watchPanel.userPlaced = true;
  palmContext.instrumentPlatePanel.userPlaced = true;
  const platePosition = plateRoot.position.clone();
  const watchPosition = watchRoot.position.clone();
  palmUp = false;
  palmContext.updateHandMenu(new Map(), 0.5);
  assert.ok(palmButtons.every(([mesh]) => mesh.isEnabled()) && mediaButtons.every(([mesh]) => mesh.isEnabled()),
    'Detached instruments and watch remain usable without a tracked palm');
  wrist.position.set(2, 3, 4);
  palmUp = true;
  palmContext.updateHandMenu(palmControllers, 0.7);
  assert.equal(plateRoot.parent, null);
  assert.equal(watchRoot.parent, null);
  assert.ok(plateRoot.position.equals(platePosition) && watchRoot.position.equals(watchPosition),
    'Detached panels do not reattach or move when the wrist returns');
  console.log('Instrument panel and watch passed: all 17 instrument/guard choices, unobstructed labels, creation actions, visibility toggle, controller X/Y choices, wrist transport layout, formation-library transport, and hide/release.');
} finally {
  scene.dispose();
  engine.dispose();
}
