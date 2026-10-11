import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction/thumbJogGesture.ts', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, ''), context);
const state = { neutral: null, settlingSeconds: 0 };
context.state = state;
const update = (active, position, delta = 0.02) =>
  vm.runInContext(`updateThumbJog(state, ${active}, ${position}, ${delta})`, context);
for (let i = 0; i < 16; i++) assert.equal(update(true, 0.4), 0);
assert.ok(Math.abs(update(true, 0.575) - 0.5) < 1e-9);
assert.ok(Math.abs(update(true, 0.225) + 0.5) < 1e-9);
assert.equal(update(true, 1), 1);
assert.equal(update(false, 1), 0);
assert.equal(state.neutral, null);
assert.equal(update(true, -0.2), 0);
assert.equal(update(true, 0.3), 0, 'Movement during arming restarts neutral calibration');
assert.equal(state.settlingSeconds, 0.02);
assert.equal(update(true, 0.3, 0.5), 0);
assert.equal(state.neutral, null);
assert.equal(update(true, 'NaN'), 0);
console.log('Thumb jogging checks passed: neutral settling, both directions, clamping, gesture release, and tracking gaps.');
