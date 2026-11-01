// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const compile = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const context = vm.createContext({ FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120, END_ZONE_DEPTH_YARDS: 10 });
vm.runInContext(compile('../src/robot/footballPlayGeometry.ts'), context);
vm.runInContext(compile('../src/robot/scrimmageGeometry.ts'), context);
for (const formation of ['shotgun', 'spread', 'i-form']) {
  const geometry = context.generateFootballPlay(formation, 'slants');
  geometry.players.forEach((player, index) => {
    const path = context.scrimmagePlayerRoute(player.positions, index);
    assert.equal(path.length, 113, 'Exit, entry and play share one timeline');
    for (let count = 0; count <= 48; count++) {
      assert.ok(Math.abs(path[count].x) > 53.333 / 2, 'Players wait outside the field during band exit');
      assert.deepEqual(path[count], path[0], 'Players hold still until band exit completes');
    }
    assert.deepEqual(path[50], path[0], 'Players stand before leaving their bench');
    assert.equal(path[0].x, context.scrimmageBenchSeat(index).x);
    assert.equal(path[0].z, context.scrimmageBenchSeat(index).z);
    assert.deepEqual(path[96], player.positions[0], 'Players reach their formation before the snap');
    assert.deepEqual(path[112], player.positions[16], 'The entire football play is preserved');
    for (let count = 1; count <= 96; count++) {
      assert.ok(Math.hypot(path[count].x - path[count - 1].x, path[count].z - path[count - 1].z) < 1.25,
        'Entry is continuous, without teleporting');
    }
  });
}
for (const start of [{ x: -15, z: -20 }, { x: 12, z: 5 }, { x: 0, z: 0 }, { x: 8, z: 59 }]) {
  const end = context.scrimmageBandEndZone(start, 3);
  const exit = context.scrimmageWalk(start, end, 48);
  assert.equal(exit.length, 49);
  assert.equal(end.x, start.x, 'Band walks toward the end zone without sideline travel');
  assert.ok(Math.abs(end.z) >= 50 && Math.abs(end.z) <= 60, 'Band finishes inside an end zone');
  assert.equal(Math.sign(end.z), start.z < 0 ? -1 : 1, 'Band uses the nearest end zone');
  assert.ok(exit.every(point => Math.abs(point.z) >= Math.abs(start.z)),
    'Marchers already in an end zone do not walk back toward midfield');
  assert.equal(exit[0].x, start.x);
  assert.equal(exit[0].z, start.z);
  assert.deepEqual(exit.at(-1), end);
}
assert.equal(context.scrimmageSeatedBlend(0, Infinity), 1, 'Waiting players stay seated independently of the band timeline');
assert.equal(context.scrimmageSeatedBlend(48, 96), 1);
assert.equal(context.scrimmageSeatedBlend(49, 96), .5, 'Stand-up is interpolated over two counts');
assert.equal(context.scrimmageSeatedBlend(50, 96), 0);
assert.equal(context.scrimmageSeatedBlend(0, 0), 0, 'Direct-loaded football plays start standing');
assert.equal(new Set(Array.from({ length: 22 }, (_, index) => JSON.stringify(context.scrimmageBenchSeat(index)))).size,
  22, 'Players have distinct, evenly spaced bench seats');
assert.ok(Math.abs(context.scrimmageBenchSeat(0).x) + .55 / 2 < 53.333 / 2 + 4,
  'Bench remains in the sideline aisle ahead of the bleachers, not inside the audience');
console.log('Scrimmage passed: team benches, nearest-end-zone band exit, sequential player entry, continuous routes and delayed play.');
