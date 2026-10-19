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
let panelInteraction;
const models = [];
const toggleListeners = new Map();
const toggle = {
  checked: false,
  addEventListener: (event, listener) => toggleListeners.set(event, listener),
  removeEventListener: event => toggleListeners.delete(event),
};
const context = vm.createContext({
  isMenuActionAvailable: () => true,
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
    userPlaced = false;
    constructor() { panelInteraction = this; }
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
  assert.equal(scene.getMeshByName('instrumentPanelBacking').material.alpha, .45,
    'Instrument panel background is semi-transparent');
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
  panelInteraction.userPlaced = true;
  toggle.checked = false;
  toggleListeners.get('change')();
  toggle.checked = true;
  toggleListeners.get('change')();
  assert.equal(placements, 1, 'Reopening through Settings retains manual placement');
  context.summonInstrumentPanel();
  assert.equal(placements, 2, 'Explicit summon still brings the palette back');
  releases = 0;
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
  console.log('Instrument panel checks passed: 17 instrument/guard choices, unobstructed labels, creation actions, visibility, retained placement, explicit summon, and hide/release.');
} finally {
  scene.dispose();
  engine.dispose();
}
