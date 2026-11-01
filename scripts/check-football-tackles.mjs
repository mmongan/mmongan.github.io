// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const controls = {};
class Control {
  value = '';
  options = [];
  handlers = new Map();
  addEventListener(type, callback) { this.handlers.set(type, callback); }
  removeEventListener(type, callback) { if (this.handlers.get(type) === callback) this.handlers.delete(type); }
  replaceChildren(...options) { this.options = options; this.value = options[0]?.value ?? ''; }
  click() { this.handlers.get('click')?.(); }
  dispatchEvent(event) { this.handlers.get(event.type)?.(); }
  get selectedIndex() { return this.options.findIndex(option => option.value === this.value); }
  set selectedIndex(index) { this.value = this.options[index]?.value ?? ''; }
}
for (const name of ['Defender', 'Carrier', 'Count', 'Now', 'Add', 'Events', 'Remove', 'Status']) {
  controls[`footballTackle${name}`] = new Control();
}
let beat = 16.5, changes = 0, errors = 0;
const calibration = { checked: false };
const context = vm.createContext({
  ...controls, floorCalibrationToggle: calibration,
  Option: class { constructor(text, value) { this.text = text; this.value = value; } },
  Event: class { constructor(type) { this.type = type; } },
  getDrillTransportState: () => ({ beat }),
  console: { error() { errors++; } },
});
for (const file of ['footballPlayGeometry', 'footballPlaySequence', 'footballTackles', 'footballTackleEditor']) {
  vm.runInContext(stripTypeScriptTypes(readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8'),
    { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
}
const data = context.generateFootballPlaySequence();
const event = data.tackles[0];
const position = (id, count) => data.players.find(player => player.id === id)?.positions[count] ?? null;
const validate = (candidate, others = [], read = position) =>
  context.validateFootballTackle(candidate, data.players, read, 264, others, data.ballEvents);
validate(event);
for (const count of [NaN, Infinity, -1, 16.2, 257]) {
  assert.throws(() => validate({ ...event, count }), /whole count/);
}
assert.throws(() => validate({ ...event, defenderId: event.carrierId }), /defensive tackler/);
assert.throws(() => validate({ ...event, carrierId: 'offense-QB' }), /does not have the ball/);
assert.throws(() => validate({ ...event, count: 5 }), /pass or handoff/);
assert.throws(() => validate(event, [event]), /overlap/);
assert.throws(() => validate(event, [], (id, count) => {
  const point = position(id, count);
  return id === event.defenderId ? { ...point, x: position(event.carrierId, count).x + 1.001 } : point;
}), /within one yard/);
assert.throws(() => validate(event, [], (id, count) => {
  const point = position(id, count);
  return id === event.carrierId && count === 24 ? { ...point, x: point.x + .002 } : point;
}), /hold/);
assert.throws(() => validate(event, [], () => ({ x: NaN, z: 0 })), /valid field coordinates/);
assert.throws(() => validate(event, [], () => null), /valid field coordinates/);
const pose = count => context.footballTacklePose(event, count);
assert.equal(pose(15.99), null);
assert.equal(pose(16).fall, 0);
assert.equal(pose(17).fall, .5);
assert.equal(pose(18).fall, 1);
assert.equal(pose(19.99).fall, 1);
assert.equal(pose(22).fall, .5);
assert.equal(pose(24), null);
assert.deepEqual(pose(17.25), pose(17.25));

const events = [];
const dispose = context.initFootballTackleEditor(data.players, events, validate, () => { changes++; });
const { footballTackleDefender: defender, footballTackleCarrier: carrier, footballTackleCount: count,
  footballTackleAdd: save, footballTackleRemove: remove, footballTackleEvents: list,
  footballTackleStatus: status } = controls;
assert.equal(defender.options.length, 11);
assert.equal(carrier.options.length, 11);
defender.value = event.defenderId; carrier.value = event.carrierId;
context.executeFootballTackleCommand('tackleCount');
assert.equal(count.value, '16');
context.executeFootballTackleCommand('tackleAdd');
assert.equal(events.length, 1);
assert.equal(changes, 1);
list.value = '0'; list.dispatchEvent({ type: 'change' });
assert.equal(count.value, '16');
save.click();
assert.equal(events.length, 1, 'Saving selected event updates rather than duplicates');
assert.equal(changes, 2);
count.value = '17';
save.click();
assert.equal(events[0].count, 16, 'Invalid update preserves original event');
assert.match(status.value, /hold/);
assert.equal(changes, 2);
count.value = '16'; list.value = '-1'; save.click();
assert.equal(events.length, 1, 'Overlapping add rejected');
assert.match(status.value, /overlap/);
list.value = '0'; calibration.checked = true; remove.click();
assert.equal(events.length, 1, 'Calibration blocks edits');
calibration.checked = false;
remove.click();
assert.equal(events.length, 0);
assert.equal(changes, 3);
remove.click();
assert.match(status.value, /valid tackle/);
assert.ok(errors >= 4, 'Failures are logged and shown');
dispose();
assert.equal(save.handlers.size, 0);
assert.equal(remove.handlers.size, 0);
assert.equal(list.handlers.size, 0);
assert.equal(defender.options.length, 0);
assert.equal(list.options.length, 0);
console.log('Football tackles passed: contact/possession/hold/overlap validation, deterministic fall/recovery, shared editor add/update/delete, calibration, errors and cleanup.');
