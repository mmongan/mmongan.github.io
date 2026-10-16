import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const source = readFileSync(new URL('../src/field/adjustableGrid.ts', import.meta.url), 'utf8');
const transformed = stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '');
const listeners = new Map();
const toggle = {
  checked: false,
  addEventListener: (type, listener) => listeners.set(`toggle:${type}`, listener),
  removeEventListener: type => listeners.delete(`toggle:${type}`),
};
const interval = {
  value: '5',
  get valueAsNumber() { return Number(this.value); },
  disabled: false,
  validityMessage: '',
  addEventListener: (type, listener) => listeners.set(`interval:${type}`, listener),
  removeEventListener: type => listeners.delete(`interval:${type}`),
  setCustomValidity: message => { interval.validityMessage = message; },
  reportValidity() {},
};
const engine = new NullEngine();
const scene = new Scene(engine);
const context = vm.createContext({
  Color3, MeshBuilder, Vector3, scene,
  FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333, FIELD_SURFACE_Y: -0.48,
  fieldGridToggle: toggle, fieldGridInterval: interval,
});
vm.runInContext(transformed, context);
try {
  const field = new TransformNode('field', scene);
  field.position.y = -0.5;
  context.createAdjustableFieldGrid(field);
  assert.equal(scene.getMeshByName('adjustableFieldGrid'), null, 'Grid is off by default');
  assert.equal(interval.disabled, true, 'Spacing is disabled while grid is hidden');

  toggle.checked = true;
  listeners.get('toggle:change')();
  const fiveYardGrid = scene.getMeshByName('adjustableFieldGrid');
  assert.ok(fiveYardGrid, 'Enabling the toggle draws the grid');
  assert.equal(fiveYardGrid.parent, field, 'Grid follows the field transform');
  assert.equal(interval.disabled, false);
  const fiveYardVertexCount = fiveYardGrid.getTotalVertices();
  const firstVertex = fiveYardGrid.getVerticesData('position').slice(0, 3);
  const firstVertexWorld = Vector3.TransformCoordinates(
    new Vector3(...firstVertex), field.computeWorldMatrix(true)
  );
  assert.ok(Math.abs(firstVertexWorld.y + 0.472) < 1e-6, 'Grid sits just above the turf surface');

  interval.value = '2.5';
  listeners.get('interval:change')();
  const finerGrid = scene.getMeshByName('adjustableFieldGrid');
  assert.ok(finerGrid.getTotalVertices() > fiveYardVertexCount, 'Smaller spacing creates more grid lines');

  interval.value = '21';
  listeners.get('interval:change')();
  assert.equal(scene.getMeshByName('adjustableFieldGrid'), null, 'Invalid spacing never leaves a stale grid');
  assert.notEqual(interval.validityMessage, '', 'Invalid spacing is reported to the user');
  interval.value = '5';
  listeners.get('interval:change')();

  toggle.checked = false;
  listeners.get('toggle:change')();
  assert.equal(scene.getMeshByName('adjustableFieldGrid'), null, 'Disabling the toggle removes the overlay');
  console.log('Adjustable field grid checks passed: default hidden, interval updates, field transform, surface height, and invalid input.');
} finally {
  scene.dispose();
  engine.dispose();
}
