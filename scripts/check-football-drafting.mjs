// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const states = new Map(), robots = new Set();
let beat = 0, playing = true, collisionsAllowed = true, invalidations = 0;
const context = vm.createContext({
  Vector3, Observable, scene: {}, sharedScene: {}, players: states, allRobots: robots, heldRobots: new Set(),
  FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120, FIELD_SURFACE_Y: -.48,
  footballDraftFrom: { value: '4' }, footballDraftTo: { value: '8' }, footballDraftStatus: { value: '' },
  blankChartPage: null, getBlankChartPageState: () => context.blankChartPage,
  getRobotCounts: robot => states.get(robot)?.counts ?? null,
  getMaxCountIndex: () => 20,
  tryManualMarcherPoses: () => collisionsAllowed,
  invalidateLegBake() { invalidations++; },
  clearBakedCountGaits: state => state.counts.forEach(count => { delete count.bakedGait; delete count.stepPhase; }),
  setBlankPageGhostWaiting(ghost, robot, waiting) { robot.waiting = waiting; },
  notifyBlankChartPage() {},
  applyGlobalCount: (robot, state) => robot.position.copyFrom(state.counts[beat].position),
  applyGlobalCountToAllRobots: () => states.forEach((state, robot) => robot.position.copyFrom(state.counts[beat].position)),
  recalculateCollisionMarkers() {},
  pauseAll() { playing = false; },
  seekToCount(value) {
    beat = value;
    states.forEach((state, robot) => robot.position.copyFrom(state.counts[beat].position));
  },
});
for (const module of ['robot/chartPageTimeline', 'interaction/guideMarcherLayout',
  'interaction/fieldDrawingGeometry', 'interaction/editingMode']) {
  vm.runInContext(compile(read(`../src/${module}.ts`)), context);
}
const robotSource = read('../src/robot/robot.ts');
for (const [start, end] of [
  ['export function captureMarcherMovement(', '\nexport function clearRobotPath('],
  ['export function setRobotSetPoses(', '\n// Transition library:'],
]) {
  vm.runInContext(compile(robotSource.slice(robotSource.indexOf(start), robotSource.indexOf(end))), context);
}
vm.runInContext(compile(read('../src/interaction/footballDrafting.ts')), context);
context.setChartPageTimeline({ beatsPerPage: 4, authoredCounts: [0, 4, 8, 12, 16, 20] });
for (let index = 0; index < 22; index++) {
  const robot = {
    position: new Vector3(index - 11, -.48, -8), rotation: { y: 0 },
    _enabled: true, isDisposed: () => false,
    isEnabled() { return this._enabled; }, setEnabled(value) { this._enabled = value; }, computeWorldMatrix() {},
  };
  const counts = Array.from({ length: 21 }, (_, count) => ({
    position: new Vector3(index - 11, -.48, -12 + count),
    rotationY: 0, styleIndex: 2, facingY: 0,
  }));
  states.set(robot, { counts, points: counts.map(count => count.position.clone()),
    footballMotion: { team: index < 11 ? 'offense' : 'defense' }, gaitPhaseCache: new Map(), stepCache: {} });
  robots.add(robot);
}
const lineup = [...robots], player = lineup[0], originals = context.captureMarcherMovement(player);
const start = states.get(player).counts[4].position.clone();
const end = states.get(player).counts[8].position.clone();
const guide = [start, new Vector3(start.x + 2, -.48, -6), end];
context.draftFootballGuide([player], guide, 'path');
assert.equal(robots.size, 22, 'Path creates no extra players');
assert.equal(playing, false, 'Drafting pauses shared transport');
assert.equal(beat, 8, 'Shows destination chart');
assert.ok(states.get(player).counts[6].position.x > start.x + 1, 'Route follows drawn corner instead of straight line');
for (let count = 0; count < 21; count++) {
  if (count < 4 || count > 8) assert.deepEqual(states.get(player).counts[count], originals.counts[count],
    'Counts outside drafted span retain positions/facing/style');
}
assert.equal(states.get(player).footballMotion.team, 'offense');
assert.ok(invalidations > 0, 'Actual movement restore invalidates leg caches');
const captured = context.captureMarcherMovement(player);
assert.throws(() => context.draftFootballGuide([player], [new Vector3(100, -.48, 0), end], 'path'), /inside the field/);
assert.throws(() => context.draftFootballGuide([player], [start.add(new Vector3(1, 0, 0)), end], 'path'), /existing start/);
assert.deepEqual(context.captureMarcherMovement(player), captured, 'Rejected path edits are atomic');
assert.throws(() => context.draftFootballGuide([], guide, 'formation'), /existing football/);
assert.throws(() => context.draftFootballGuide(lineup, guide, 'path'), /one football/);
for (const value of ['', 'NaN', '-1', '8.5', '21']) {
  context.footballDraftTo.value = value;
  assert.throws(() => context.draftFootballGuide([player], guide, 'path'));
}
context.footballDraftTo.value = '8';
const offense = lineup.slice(0, 11);
const formation = [new Vector3(-10, -.48, 0), new Vector3(10, -.48, 0)];
collisionsAllowed = false;
assert.throws(() => context.draftFootballGuide(offense, formation, 'formation'), /Nothing was changed/);
assert.deepEqual(context.captureMarcherMovement(player), captured);
collisionsAllowed = true;
const defenseBefore = lineup.slice(11).map(robot => context.captureMarcherMovement(robot));
context.draftFootballGuide(offense, formation, 'formation', { spacing: 2, facing: 'fixed', facingAngle: 90 });
assert.equal(robots.size, 22);
offense.forEach((robot, index) => {
  assert.equal(states.get(robot).counts[8].position.x, -10 + index * 2);
  assert.equal(states.get(robot).counts[8].position.z, 0);
  assert.equal(states.get(robot).counts[8].facingY, Math.PI / 2);
});
lineup.slice(11).forEach((robot, index) => assert.deepEqual(context.captureMarcherMovement(robot), defenseBefore[index],
  'Formation preserves opposing team'));
context.draftFootballGuide(offense, [new Vector3(-10, -.48, 4), new Vector3(10, -.48, 4)], 'routes');
offense.forEach(robot => assert.equal(states.get(robot).counts[8].position.z, 4));
assert.equal(robots.size, 22, 'Grouped routes retain roster');
const pending = new Map(offense.slice(0, 2).map(robot => [robot, { waiting: true }]));
offense.slice(0, 2).forEach(robot => robot.setEnabled(false));
context.blankChartPage = { count: 8, pending, claimed: new Set(), leftBehind: new Map() };
context.draftFootballGuide(offense, formation, 'formation');
assert.equal(pending.size, 0, 'Bulk formation places waiting football ghosts');
assert.equal(context.blankChartPage.leftBehind.size, 2, 'Prior-set references retained until page closes');
assert.ok(offense.every(robot => robot.isEnabled()), 'Placed football players become visible');
context.blankChartPage = null;
assert.equal(context.isDrillEditingEnabled(), false);
context.setFootballEditingEnabled(true); assert.equal(context.isDrillEditingEnabled(), true);
context.setFootballEditingEnabled(false); assert.equal(context.isDrillEditingEnabled(), false);
context.setDrillEditingEnabled(true); context.setFootballEditingEnabled(true); context.setFootballEditingEnabled(false);
assert.equal(context.isDrillEditingEnabled(), true, 'Exiting football preserves immersive editing');
console.log('Football drafting passed: actual route/set updates, retained 22-player identity, selected routes, team formation/facing, grouped routes, rejection atomicity, count limits, shared transport/cache and editing lifecycle.');
