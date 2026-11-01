// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const read = file => readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8');
const compile = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const robot = {}, states = new Map(), parts = new Map([[robot, { gaitIndex: 0 }]]);
let invalidations = 0;
const context = vm.createContext({
  Vector3, players: states, marcherParts: parts,
  invalidateLegBake() { invalidations++; },
});
vm.runInContext(compile(read('footballMovement')), context);
const source = read('robot');
vm.runInContext(compile(source.slice(source.indexOf('export const MARCHING_GAITS ='),
  source.indexOf('let selectedMarchingGait'))), context);
vm.runInContext(compile(source.slice(source.indexOf('const GAIT_INDEX_BY_NAME ='),
  source.indexOf('function wrapAngle(angle:'))), context);
const movement = (team, role, count, dx, dz, playStart = 96) =>
  context.footballMovement({ team, role, playStart }, count, dx, dz);
for (const [role, count, dx, dz, team, expected] of [
  ['WR1', 48, .5, .2, 'offense', 'jog'],
  ['WR1', 0, 0, 0, 'offense', 'ready'],
  ['WR1', 98, 0, 2, 'offense', 'sprint'],
  ['CB-L', 98, 0, 1, 'defense', 'backpedal'],
  ['LB-L', 98, 1, .1, 'defense', 'shuffle'],
  ['LT', 98, 0, -.5, 'offense', 'block'],
  ['DT-L', 98, 0, -.3, 'defense', 'block'],
  ['LS', 98, 0, 0, 'offense', 'block'],
  ['QB', 98, 0, -.3, 'offense', 'backpedal'],
]) {
  const actual = movement(team, role, count, dx, dz);
  assert.equal(actual.gait, expected);
  if (actual.stepsPerCount > 0) assert.ok(Math.hypot(dx, dz) / actual.stepsPerCount <= .6);
  const state = { counts: Array.from({ length: 101 }, (_, index) => ({
    position: new Vector3(index * dx, 0, index * dz), rotationY: 0,
    bakedGait: { label: 'Stale march' }, stepPhase: 99,
  })) };
  states.set(robot, state);
  context.setRobotFootballMotion(robot, { team, role, playStart: 96 });
  const resolved = context.resolveSegmentGait(state, count, 0);
  assert.equal(resolved.label, `Football ${expected}`, 'Actual shared leg resolver selects football gait');
  assert.equal(resolved.stepsPerCount, actual.stepsPerCount);
  assert.ok(Math.abs(resolved.bodyYaw - actual.bodyYaw) < 1e-10);
  assert.equal(state.counts[count].bakedGait, undefined, 'Enabling football clears baked marching poses');
  assert.equal(state.counts[count].stepPhase, undefined);
  assert.equal(context.resolveSegmentGait(state, 100, 0), null, 'Final route count halts');
  context.setRobotFootballMotion(robot, null);
  assert.equal(state.footballMotion, undefined, 'Exit removes the gait override');
}
assert.equal(invalidations, 18);
const rushing = context.footballMovement({ team: 'defense', role: 'DE-R', playStart: 0, rush: true }, 5, -.6, -1);
assert.equal(rushing.gait, 'sprint', 'Explicit rushers run to the pocket instead of retaining a blocking stance');
assert.ok(Math.abs(rushing.bodyYaw - Math.atan2(-.6, -1)) < 1e-10);
assert.equal(movement('offense', 'LT', 96, 0, -.5).lean, 0, 'Neutral snap formation has no premature blocking lean');
assert.equal(movement('offense', 'LT', 97, 0, -.5).blockElbow, -.3500000000000001,
  'Blocking hands extend with visibly bent elbows after snap');
assert.equal(movement('defense', 'CB-L', 100, 0, 1).bodyYaw, Math.PI, 'Backpedaling faces the offense');
assert.equal(movement('offense', 'QB', 100, 0, -.3).bodyYaw, 0, 'Quarterback keeps looking downfield');
console.log('Football movement passed: role/route gaits, entry jog, bounded cadence, actual leg resolver, cache invalidation and exit.');
