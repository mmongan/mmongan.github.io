import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const transform = text => stripTypeScriptTypes(text, { mode: 'transform' }).replace(/export /g, '');
const robot = { position: new Vector3(1, 0.02, 2), rotation: { y: 0 }, isDisposed: () => false };
const state = {
  points: [new Vector3(1, 0.02, 2), new Vector3(2, 0.02, 2)],
  counts: [
    { position: new Vector3(1, 0.02, 2), rotationY: 0.1 },
    { position: new Vector3(2, 0.02, 2), rotationY: 0.2 },
  ],
};
const originalPath = state.points.map(point => point.clone());
const robotPaths = new Map([[robot, originalPath]]);
const storedPaths = [originalPath];
const segment = { controlPoints: originalPath.map(point => point.clone()) };
const context = vm.createContext({
  Vector3, players: new Map([[robot, state]]), heldRobots: new Set(),
  sharedScene: null, invalidateLegBake() {}, applyGlobalCount() {},
  robotPaths, storedPaths, pathSegmentByRobot: new Map([[robot, segment]]),
  robotPathLines: new Map(), segments: [], selectedRobot: null, scene: {},
  saveStoredPaths() {}, refreshSegmentVisuals() {}, refreshCollisionMarkers() {},
  rebuildFormationConnections() {}, handInteraction: { prepareForErase() {} },
});
vm.runInContext(transform(read('../src/interaction/editHistory.ts')) + '\nthis.history = new EditHistory(() => {}); this.eraseHistory = history;', context);
const robotSource = read('../src/robot/robot.ts');
vm.runInContext(transform(robotSource.slice(robotSource.indexOf('export function captureMarcherMovement('),
  robotSource.indexOf('export function clearRobotPath('))), context);
const pathSource = read('../src/interaction/pathInteraction.ts');
vm.runInContext(transform(pathSource.slice(pathSource.indexOf('function captureMarcherMove('),
  pathSource.indexOf('const handInteraction = createHandInteraction('))), context);
function move(x, facing) {
  const record = context.captureMarcherMove(robot);
  const delta = new Vector3(x - robot.position.x, 0, 0);
  robot.position.addInPlace(delta);
  robot.rotation.y = facing;
  state.fixedFacingY = facing;
  state.points = state.points.map(point => point.add(delta));
  state.counts = state.counts.map(count => ({ ...count, position: count.position.add(delta), facingY: facing }));
  const previous = robotPaths.get(robot);
  const path = previous.map(point => point.add(delta));
  storedPaths[storedPaths.indexOf(previous)] = path;
  robotPaths.set(robot, path);
  segment.controlPoints = segment.controlPoints.map(point => point.add(delta));
  record();
}
move(5, 0.5);
move(9, 1);
assert.equal(context.history.canUndo, true);
context.history.undo();
assert.equal(robot.position.x, 5);
assert.equal(state.fixedFacingY, 0.5);
assert.equal(state.counts[1].position.x, 6);
assert.equal(state.counts[1].facingY, 0.5);
assert.equal(segment.controlPoints[0].x, 5);
assert.equal(storedPaths[0], robotPaths.get(robot));
context.history.undo();
assert.equal(robot.position.x, 1);
assert.equal(state.fixedFacingY, undefined);
assert.equal(state.counts[1].facingY, undefined);
assert.equal(state.counts[1].rotationY, 0.2, 'Undo preserves original per-count travel directions');
assert.equal(state.points[1].x, 2);
assert.equal(segment.controlPoints[0].x, 1);
context.history.redo();
assert.equal(robot.position.x, 5);
context.history.redo();
assert.equal(robot.position.x, 9);
context.history.undo();
move(7, 0.7);
assert.equal(context.history.canRedo, false, 'New movement clears the redo branch');
context.history.clear();
context.captureMarcherMove(robot)();
assert.equal(context.history.canUndo, false, 'Unchanged placements do not consume history');
console.log('Marcher movement history passed: multiple undo/redo, route/count/facing restoration, path metadata, redo branching and no-op suppression.');
