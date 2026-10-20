import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const compile = source => stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, '');
const context = vm.createContext({ Math, Number, Map, Set, Vector3 });
vm.runInContext(compile(readFileSync(new URL('../src/interaction/drillShapes.ts', import.meta.url), 'utf8')), context);
const p = (x, z, y = 0) => ({ x, y, z });
const segment = (kind, end, control = end, control2 = end) => ({ kind, end, control, control2 });
const { shapeStrokes, sampleDrillShape, insideSelection, selectionWasDragged } = context;
const asPlain = result => JSON.parse(JSON.stringify(result));
const line = { start: p(0, 0), segments: [segment('line', p(10, 0))] };
assert.deepEqual(asPlain(sampleDrillShape(line, 5)), [0, 2.5, 5, 7.5, 10].map(x => p(x, 0)));
assert.deepEqual(asPlain(sampleDrillShape(line, 1)), [p(5, 0)]);
for (const kind of ['curve', 'doubleCurve']) {
  const shape = { start: p(0, 0), segments: [segment(kind, p(10, 0), p(2, 6), p(8, -6))] };
  const strokes = shapeStrokes(shape);
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].length, 65);
  assert.deepEqual(asPlain(strokes[0][0]), p(0, 0));
  assert.deepEqual(asPlain(strokes[0].at(-1)), p(10, 0));
  const sampled = sampleDrillShape(shape, 9);
  assert.equal(sampled.length, 9);
  assert.ok(sampled.every(point => Number.isFinite(point.x + point.y + point.z)));
  assert.ok(sampled.some(point => Math.abs(point.z) > .1));
}
const disconnected = {
  start: p(0, 0), segments: [segment('line', p(2, 0)), segment('move', p(100, 0)), segment('line', p(102, 0))],
};
assert.equal(shapeStrokes(disconnected).length, 2);
assert.ok(sampleDrillShape(disconnected, 8).every(point => point.x <= 2 || point.x >= 100),
  'Move segments do not place marchers across disconnected gaps');
const closed = { start: p(0, 0), segments: [segment('line', p(4, 0)), segment('line', p(4, 4)), segment('close', p(9, 9))] };
const closedSamples = sampleDrillShape(closed, 10);
assert.equal(closedSamples.length, 10);
assert.notDeepEqual(asPlain(closedSamples[0]), asPlain(closedSamples.at(-1)), 'Closed shapes do not duplicate the first marcher');
assert.throws(() => sampleDrillShape({ start: p(0, 0), segments: [] }, 3), /nonzero/);
assert.throws(() => sampleDrillShape(line, 0), /Select/);
assert.throws(() => shapeStrokes({ start: p(NaN, 0), segments: [] }), /finite/);
const rectangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
assert.equal(insideSelection({ x: 5, y: 5 }, rectangle), true);
assert.equal(insideSelection({ x: 10, y: 5 }, rectangle), true);
assert.equal(insideSelection({ x: 11, y: 5 }, rectangle), false);
assert.equal(insideSelection({ x: 1, y: 1 }, []), false);
const lasso = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 10 }];
assert.equal(insideSelection({ x: 1, y: 1 }, lasso), true);
assert.equal(insideSelection({ x: 8, y: 8 }, lasso), false, 'Lasso uses polygon, not bounding rectangle');
assert.equal(selectionWasDragged(rectangle[0], rectangle[0], rectangle), true,
  'A lasso returning to its start remains a drag, not an empty-space click');
assert.equal(selectionWasDragged({ x: 1, y: 1 }, { x: 2, y: 2 }, []), false);

const source = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
vm.runInContext(compile(source.slice(source.indexOf('function clearBakedCountGaits('),
  source.indexOf('function getGaitStepPhaseOffsets('))), context);
const start = source.indexOf('export function setRobotSetPoses(');
const end = source.indexOf('\n}', start);
assert.ok(start >= 0 && end > start);
const robot = x => ({
  position: new Vector3(x, 0, 0), rotation: { y: 0 }, computeWorldMatrix() {},
});
const robots = [robot(0), robot(10), robot(20)];
const players = new Map(robots.map((robot, index) => [robot, {
  counts: Array.from({ length: 17 }, (_, count) => ({
    position: new Vector3(index * 10, 0, count), rotationY: 0, facingY: .4, tag: `${index}:${count}`,
  })),
  gaitPhaseCache: new Map([[0, {}]]),
}]));
const snapshots = () => JSON.stringify([...players.values()].map(state => state.counts));
let blocked = false, checks = 0, refreshed = 0;
Object.assign(context, {
  players, allRobots: new Set(robots),
  getChartPageTimeline: () => ({ authoredCounts: [] }), authorChartPage() {},
  invalidateLegBake() {},
  tryManualMarcherPoses(poses, sweep) {
    checks++;
    assert.equal(sweep, false);
    assert.equal(poses.length, 2, 'Set edits validate the whole selected group together');
    assert.equal(robots[2].position.z, 8, 'Obstacles are evaluated at the destination count');
    poses.forEach(pose => pose.robot.position.copyFrom(pose.position));
    return !blocked;
  },
  applyGlobalCountToAllRobots() { refreshed++; },
  recalculateCollisionMarkers() { refreshed++; },
});
vm.runInContext(compile(source.slice(start, end + 2)), context);
const poses = robots.slice(0, 2).map((robot, index) => ({
  robot, position: new Vector3(index * 10 + 2, 0, 9), facingY: .7,
}));
const original = snapshots();
const originalPoses = JSON.stringify(robots);
blocked = true;
assert.equal(context.setRobotSetPoses(8, poses, 4, 12, {}), false);
assert.equal(snapshots(), original, 'Rejected set edits preserve every count');
assert.equal(JSON.stringify(robots), originalPoses, 'Validation restores live poses on rejection');
blocked = false;
assert.equal(context.setRobotSetPoses(8, poses, 4, 12, {}), true);
assert.equal(JSON.stringify(robots), originalPoses, 'Validation restores poses before the shared clock refresh');
const before = JSON.parse(original);
for (let index = 0; index < robots.length; index++) {
  const state = players.get(robots[index]);
  for (let count = 0; count < state.counts.length; count++) {
    if (index === 2 || count < 4 || count > 12) {
      assert.deepEqual(asPlain(state.counts[count]), before[index][count], 'Unselected marchers and distant counts are untouched');
    }
    assert.equal(state.counts[count].tag, `${index}:${count}`, 'Per-count metadata survives set editing');
  }
  if (index < 2) {
    assert.equal(state.counts[8].position.x, index * 10 + 2);
    assert.equal(state.counts[8].position.z, 9);
    assert.equal(state.counts[6].position.x, index * 10 + 1);
    assert.equal(state.counts[10].position.x, index * 10 + 1);
    assert.equal(state.counts[4].position.z, 4);
    assert.equal(state.counts[12].position.z, 12);
    assert.equal(state.gaitPhaseCache.size, 0);
    assert.equal(state.points.length, 17, 'Route representation matches edited counts');
  }
}
assert.equal(checks, 2);
assert.equal(refreshed, 2, 'One playback/collision refresh per accepted batch');
assert.throws(() => context.setRobotSetPoses(8, [poses[0], poses[0]], 4, 12, {}), /unique/);
assert.throws(() => context.setRobotSetPoses(99, poses, 4, 100, {}), /valid/);
console.log('Drill shapes/set checks passed: rectangle/lasso geometry, line/quadratic/cubic/move/close sampling, atomic set edits, adjacent transitions, metadata, and route isolation.');
