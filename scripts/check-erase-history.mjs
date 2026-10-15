import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const historySource = stripTypeScriptTypes(read('../src/interaction/editHistory.ts'), { mode: 'transform' })
  .replace(/export /g, '');
const context = vm.createContext({ console });
vm.runInContext(`${historySource}\nglobalThis.EditHistory = EditHistory;`, context);
const { EditHistory } = context;

let value = 0;
let notifications = 0;
const history = new EditHistory(() => notifications++, 2);
const disposed = [];
const add = (amount) => {
  value += amount;
  history.record({
    undo: () => { value -= amount; },
    redo: () => { value += amount; },
    dispose: () => disposed.push(amount),
  });
};
history.undo();
history.redo();
add(1);
add(2);
add(4);
assert.deepEqual(disposed, [1]);
history.undo();
history.undo();
assert.equal(value, 1);
history.redo();
assert.equal(value, 3);
add(8);
assert.deepEqual(disposed, [1, 4]);
assert.equal(history.canRedo, false);
history.clear();
assert.deepEqual(disposed, [1, 4, 2, 8]);
assert.equal(history.canUndo, false);
assert.ok(notifications > 0);
history.record({ undo: () => { throw new Error('expected failure'); }, redo: () => {} });
assert.throws(() => history.undo(), /expected failure/);
assert.equal(history.canUndo, true);
assert.equal(history.isApplying, false);
history.clear();

function extract(source, name, exported = false) {
  const prefix = exported ? `export function ${name}(` : `function ${name}(`;
  const start = source.indexOf(prefix);
  assert.ok(start >= 0, name);
  const end = source.indexOf(exported ? '\n}' : '\n}\n', start);
  assert.ok(end > start, name);
  return stripTypeScriptTypes(source.slice(start, end + 2).replace(/^export /, ''));
}

class Point {
  constructor(x = 0) { this.x = x; }
  clone() { return new Point(this.x); }
  copyFrom(point) { this.x = point.x; }
}
const mesh = () => ({ enabled: true, disposed: false,
  setEnabled(enabled) { this.enabled = enabled; },
  dispose() { this.disposed = true; } });
const robot = () => ({
  position: new Point(), rotation: new Point(), enabled: true, disposed: false,
  isEnabled() { return this.enabled; }, isDisposed() { return this.disposed; },
  setEnabled(enabled) { this.enabled = enabled; }, dispose() { this.disposed = true; },
});
const segments = [];
const robotPaths = new Map();
const pathSegmentByRobot = new Map();
const allRobots = new Set();
const players = new Map();
const createSegment = (kind, controlPoints, robots) => {
  const segment = { kind, controlPoints, robots, line: mesh(), moveHandle: mesh(),
    pointHandles: [], rotationHandles: [], copyHandle: mesh() };
  segments.push(segment);
  if (kind === 'path') {
    pathSegmentByRobot.set(robots[0], segment);
    players.set(robots[0], { rebuilt: true });
  }
  return segment;
};
Object.assign(context, {
  segments, robotPaths, pathSegmentByRobot, allRobots, players,
  pendingLegBakes: new Set(),
  heldRobots: new Set(), sharedScene: {}, scene: {}, selectedRobot: null,
  storedPaths: [], eraseHistoryReferences: new Map(),
  segmentMoveHandleOwner: new Map(), segmentPointHandleOwner: new Map(),
  segmentRotationHandleOwner: new Map(), segmentCopyHandleOwner: new Map(),
  handInteraction: { prepareForErase() {} },
  recalculateCollisionMarkers() {}, applyGlobalCount() {}, rebuildFormationConnections() {},
  updateSegmentHandleVisibility() {}, refreshPathLineAppearance() {}, saveStoredPaths() {},
  updateRobotPathLine() {}, createSegment,
  selectRobot(selected) { context.selectedRobot = selected; },
  removeRobotPath(target) {
    robotPaths.delete(target);
    const segment = pathSegmentByRobot.get(target);
    if (segment) segments.splice(segments.indexOf(segment), 1);
    pathSegmentByRobot.delete(target);
    const index = context.storedPaths.findIndex((path) => path === context.savedPath);
    if (index >= 0) context.storedPaths.splice(index, 1);
    players.delete(target);
  },
});
vm.runInContext(extract(read('../src/robot/robot.ts'), 'invalidateLegBake'), context);
vm.runInContext(extract(read('../src/robot/robot.ts'), 'suspendRobotForErase', true), context);
vm.runInContext(extract(read('../src/interaction/pathInteraction.ts'), 'eraseMarcher'), context);
context.eraseHistory = new EditHistory(() => {}, 2);

const a = robot(), b = robot(), c = robot();
[a, b, c].forEach((entry) => allRobots.add(entry));
const formation = createSegment('formation', [], [a, b, c]);
formation.anchorRobot = a;
const path = [new Point(1), new Point(2)];
context.savedPath = path;
context.storedPaths.push(path);
robotPaths.set(b, path);
createSegment('path', path, [b]);
const schedule = { counts: [{ position: new Point(7), rotationY: 0.7 }] };
players.set(b, schedule);
context.selectedRobot = b;
context.eraseMarcher(b);
assert.deepEqual(formation.robots, [a, c]);
assert.equal(allRobots.has(b), false);
assert.equal(players.has(b), false);
assert.equal(robotPaths.has(b), false);
assert.equal(b.enabled, false);
assert.equal(context.selectedRobot, null);
assert.ok(formation.erasedFormationIndices.has(1));
context.eraseMarcher(a);
assert.deepEqual(formation.robots, [c]);
assert.equal(formation.anchorRobot, undefined);
context.eraseHistory.undo();
assert.deepEqual(formation.robots, [a, c]);
assert.equal(formation.anchorRobot, a);
context.eraseHistory.undo();
assert.deepEqual(formation.robots, [a, b, c]);
assert.equal(b.enabled, true);
assert.equal(allRobots.has(b), true);
assert.equal(players.get(b), schedule);
assert.equal(robotPaths.get(b), path);
assert.equal(context.storedPaths[0], path);
assert.ok(pathSegmentByRobot.has(b));
context.eraseHistory.redo();
context.eraseHistory.redo();
context.eraseMarcher(c);
assert.equal(b.disposed, true);
assert.equal(formation.robots.length, 0);
assert.equal(formation.line.enabled, false);
assert.ok(segments.includes(formation), 'eviction must preserve segments referenced by newer commands');
context.eraseHistory.undo();
assert.deepEqual(formation.robots, [c]);
context.eraseHistory.undo();
assert.deepEqual(formation.robots, [a, c]);
context.eraseHistory.redo();
context.eraseHistory.redo();
context.eraseHistory.clear();
assert.equal(a.disposed, true);
assert.equal(c.disposed, true);
assert.equal(segments.includes(formation), false);
assert.equal(formation.line.disposed, true);
assert.equal(context.eraseHistoryReferences.size, 0);
console.log('Erase history checks passed: undo/redo, branching, limits, failures, marcher identity, paths/counts, rank/anchor restoration, and cleanup.');
