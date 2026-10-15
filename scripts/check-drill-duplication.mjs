import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const extract = (file, name) => {
  const source = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8');
  const start = source.indexOf(`export function ${name}(`);
  assert.ok(start >= 0);
  return stripTypeScriptTypes(source.slice(start, source.indexOf('\n}', start) + 2),
    { mode: 'transform' }).replace('export ', '');
};
const scene = {};
const parent = {};
const makeRobot = () => ({
  parent, enabled: true, getScene: () => scene,
  setEnabled(value) { this.enabled = value; },
  isDisposed: () => false, isEnabled() { return this.enabled; },
});
const original = makeRobot();
const state = { points: [new Vector3(-2, 0, 0), new Vector3(4, 0, 3)],
  counts: [{ position: new Vector3(-2, 0, 0), rotationY: 0.4, facingY: 1.2 },
    { position: new Vector3(4, 0, 3), rotationY: 0.7 }],
  stepSizeYards: 0.625, fixedFacingY: 1.2, stepCache: {}, legBake: {} };
const players = new Map([[original, state]]);
const marcherParts = new Map([[original, { gaitIndex: 3, instrument: 'flute', instrumentRestPose: true }]]);
let refreshes = 0;
const context = vm.createContext({
  Vector3, players, marcherParts, scene,
  createLowPolyRobot(_scene, gaitIndex) {
    assert.equal(_scene, scene); assert.equal(gaitIndex, 3);
    const robot = makeRobot(); marcherParts.set(robot, { gaitIndex }); return robot;
  },
  setMarcherInstrument(robot, instrument) { marcherParts.get(robot).instrument = instrument; },
  setMarcherInstrumentRestPose(robot, value) { marcherParts.get(robot).instrumentRestPose = value; },
  applyGlobalCount(robot, schedule) { assert.equal(players.get(robot), schedule); },
  robotPaths: new Map([[original, state.points]]),
  getRobotCounts: robot => players.get(robot)?.counts,
  updateRobotPathLine() {},
  refreshCollisionMarkers() { refreshes++; },
  duplicateDrillStatus: { value: '' },
});
vm.runInContext(extract('robot/robot', 'duplicateMarcherSchedule'), context);
vm.runInContext(extract('interaction/pathInteraction', 'duplicateDrillForPerformance'), context);
assert.equal(context.duplicateDrillForPerformance(), 1);
const copy = [...players.keys()][1];
const copied = players.get(copy);
assert.equal(copy.parent, parent, 'Copies remain in the same AR content root');
assert.equal(copied.counts.length, state.counts.length);
assert.equal(copied.counts[0].position.x, 12, 'Whole-route width plus eight-yard gap');
assert.equal(copied.counts[1].position.x, 18);
assert.equal(copied.counts[0].facingY, 1.2);
assert.equal(copied.counts[1].rotationY, 0.7);
assert.equal(copied.stepSizeYards, state.stepSizeYards);
assert.equal(copied.fixedFacingY, state.fixedFacingY);
assert.equal(copied.stepCache, undefined, 'Per-owner runtime caches are not copied');
assert.equal(copied.legBake, undefined);
assert.equal(marcherParts.get(copy).instrument, 'flute');
assert.equal(marcherParts.get(copy).instrumentRestPose, true);
copied.counts[0].position.z = 99;
assert.equal(state.counts[0].position.z, 0, 'Copies own independent route vectors');
assert.equal(refreshes, 1, 'Collision markers recalculate once per batch');
assert.match(context.duplicateDrillStatus.value, /2 total/);
assert.equal(context.duplicateDrillForPerformance(), 2, 'Repeated clicks double the current load');
assert.equal(players.size, 4);
assert.throws(() => context.duplicateMarcherSchedule(makeRobot(), Vector3.Zero()), /registered drill/);
context.robotPaths.clear();
assert.equal(context.duplicateDrillForPerformance(), 0);
assert.match(context.duplicateDrillStatus.value, /Load or generate/);
console.log('Drill duplication passed: full-route separation, schedule/facing/gait/instrument preservation, independent vectors, repeat doubling, AR parenting, and empty-state feedback.');
