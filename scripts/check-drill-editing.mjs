import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const compile = source => stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, '');
const context = vm.createContext({ Math, Number, Vector3 });
vm.runInContext(compile(readFileSync(new URL('../src/interaction/drillEditing.ts', import.meta.url), 'utf8')), context);
const { snapDrillPoint, transformFormationPoint, alignFormationPoints, constrainDrillMovement } = context;
assert.deepEqual({ ...snapDrillPoint({ x: -1.1, y: -0.48, z: 2.7 }, 0.625) },
  { x: -1.25, y: -0.48, z: 2.5 });
assert.throws(() => snapDrillPoint({ x: 0, y: 0, z: 0 }, 0), /positive/);
assert.deepEqual({ ...snapDrillPoint({ x: -1.1, y: 3, z: 2.7 }, 0.25, 2) },
  { x: -1, y: 3, z: 2 });
assert.throws(() => snapDrillPoint({ x: 0, y: 0, z: 0 }, 1, NaN), /finite/);
assert.deepEqual({ ...constrainDrillMovement({ x: 2, y: 3, z: 4 }, true, false) }, { x: 0, y: 3, z: 4 });
assert.deepEqual({ ...constrainDrillMovement({ x: 2, y: 3, z: 4 }, true, true) }, { x: 0, y: 3, z: 0 });
const unordered = [{ x: 10, y: 1, z: 8 }, { x: -2, y: 2, z: 2 }, { x: 1, y: 3, z: 0 }, { x: 3, y: 4, z: 6 }];
const originalPoints = JSON.stringify(unordered);
for (const axis of ['X', 'Z']) {
  const key = axis.toLowerCase();
  const other = axis === 'X' ? 'z' : 'x';
  const aligned = alignFormationPoints(unordered, `align${axis}`);
  const mean = unordered.reduce((sum, point) => sum + point[key], 0) / unordered.length;
  aligned.forEach((point, index) => {
    assert.equal(point[key], mean);
    assert.equal(point[other], unordered[index][other]);
    assert.equal(point.y, unordered[index].y);
  });
  const distributed = alignFormationPoints(unordered, `distribute${axis}`);
  const sorted = distributed.map(point => point[key]).sort((a, b) => a - b);
  const step = (sorted.at(-1) - sorted[0]) / (sorted.length - 1);
  sorted.slice(1).forEach((value, index) => assert.ok(Math.abs(value - sorted[index] - step) < 1e-9));
  assert.equal(sorted[0], Math.min(...unordered.map(point => point[key])));
  assert.equal(sorted.at(-1), Math.max(...unordered.map(point => point[key])));
  distributed.forEach((point, index) => assert.equal(point[other], unordered[index][other]));
}
assert.equal(JSON.stringify(unordered), originalPoints, 'Pure alignment never mutates inputs');
const vectorPoints = unordered.map(point => new Vector3(point.x, point.y, point.z));
assert.equal(JSON.stringify(alignFormationPoints(vectorPoints, 'distributeZ')),
  JSON.stringify(alignFormationPoints(unordered, 'distributeZ')), 'Babylon accessor coordinates match plain points');
assert.throws(() => alignFormationPoints([], 'alignX'), /finite/);
assert.throws(() => alignFormationPoints([{ x: NaN, y: 0, z: 0 }], 'distributeZ'), /finite/);
assert.equal(alignFormationPoints([unordered[0]], 'distributeX')[0].x, 10);
assert.equal(JSON.stringify(alignFormationPoints(unordered.slice(0, 2), 'distributeZ')),
  JSON.stringify(unordered.slice(0, 2)), 'Two marchers retain the axis endpoints');
assert.equal(JSON.stringify(alignFormationPoints([{ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 2 }], 'distributeX')),
  JSON.stringify([{ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 2 }]), 'Tied coordinates remain finite');
const transformed = transformFormationPoint({ x: 0, y: 2, z: 1 }, { x: 0, y: 0, z: 0 },
  { x: 3, z: -2, rotation: Math.PI / 2, scale: 2 });
assert.ok(Math.abs(transformed.x - 5) < 1e-9 && Math.abs(transformed.z + 2) < 1e-9);
assert.equal(transformed.y, 2, 'Group transforms preserve height');
assert.throws(() => transformFormationPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
  { x: 0, z: 0, rotation: NaN, scale: 1 }), /finite/);

const source = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, name);
  return compile(source.slice(start, end + 2));
}
const handleOwners = new Map();
let disposedHandles = 0;
Object.assign(context, {
  segmentPointHandleOwner: handleOwners,
  SEGMENT_POINT_HANDLE_SIZE: 1, SEGMENT_COLORS: { formation: {} },
  createSegmentHandle: () => ({ dispose() { disposedHandles++; } }),
});
vm.runInContext(extract('syncSegmentPointHandles'), context);
const handledSegment = { kind: 'formation', controlPoints: vectorPoints, pointHandles: [] };
context.syncSegmentPointHandles(handledSegment);
assert.equal(handleOwners.size, 4);
handledSegment.controlPoints = vectorPoints.slice(0, 2);
context.syncSegmentPointHandles(handledSegment);
assert.equal(handleOwners.size, 2, 'Shorter aligned guides remove stale pick targets');
assert.equal(disposedHandles, 2, 'Surplus guide handles are disposed');
const robots = [0, 1, 2].map(index => ({
  position: new Vector3(index * 1.25, -0.48, 0), rotation: { y: 0 }, isDisposed: () => false,
}));
const segment = {
  kind: 'formation', spacing: 1.25, robots,
  controlPoints: [robots[0].position.clone(), robots[2].position.clone()],
};
let blocked = false;
let hasRoute = false;
let refreshes = 0;
const messages = [];
Object.assign(context, {
  getEditorFormation: () => segment,
  getRobotCounts: () => hasRoute ? [] : null,
  getSegmentCenter: points => points.reduce((sum, point) => sum.add(point), Vector3.Zero()).scale(1 / points.length),
  gridSnapToggle: { checked: false }, angleSnapToggle: { checked: false },
  gridSnapInterval: { value: '0.625' }, MARCH_STEP_YARDS: 0.625, ANGLE_SNAP_RADIANS: Math.PI / 4,
  gridSnapX: { value: '0.625' }, gridSnapZ: { value: '0.625' },
  formationLockX: { checked: false }, formationLockZ: { checked: false }, bypassDrillSnap: false,
  FORMATION_SPACING_YARDS: 1.25,
  acceptedFormationControls: new WeakMap(),
  publishFormationEdit: message => messages.push(message),
  eraseHistory: { clear() {} },
  tryManualMarcherPoses(poses) {
    if (blocked) return false;
    poses.forEach(pose => {
      pose.robot.position.copyFrom(pose.position);
      pose.robot.rotation.y = pose.rotationY;
    });
    return true;
  },
  rebuildFormationConnections() { refreshes++; },
  refreshSegmentVisuals() { refreshes++; },
  refreshCollisionMarkers() { refreshes++; }, scene: {},
});
vm.runInContext([
  'const ANGLE_SNAP_RADIANS = Math.PI / 4;',
  ...['snapToStepGrid', 'snapAngle', 'constrainFormationMovement', 'getEditableEditorFormation',
    'refreshEditedFormation', 'transformEditorFormation', 'alignEditorFormation'].map(extract),
].join('\n'), context);
const transform = { x: 3, z: 2, rotation: Math.PI / 2, scale: 2 };
assert.equal(context.transformEditorFormation(transform), true);
assert.equal(segment.robots[0], robots[0], 'Group transforms preserve marcher identity and instrument parents');
assert.equal(segment.spacing, 2.5);
assert.equal(refreshes, 3, 'All formation visuals and collision previews refresh');
assert.ok(Math.abs(Vector3.Distance(robots[0].position, robots[1].position) - 2.5) < 1e-9);
assert.equal(robots[0].rotation.y, Math.PI / 2, 'Facing turns with form');
const snapshot = JSON.stringify(segment);
blocked = true;
assert.equal(context.transformEditorFormation(transform), false);
assert.equal(JSON.stringify(segment), snapshot, 'Collision rejection changes neither poses nor controls');
blocked = false;
hasRoute = true;
assert.equal(context.transformEditorFormation(transform), false);
assert.equal(JSON.stringify(segment), snapshot, 'Imported or attached routes are never overwritten');
hasRoute = false;
context.gridSnapToggle.checked = true;
context.angleSnapToggle.checked = true;
assert.equal(context.transformEditorFormation({ x: 0.21, z: 0.11, rotation: 0.5, scale: 1 }), true);
const center = context.getSegmentCenter(segment.controlPoints);
assert.ok(Math.abs(center.x / 0.625 - Math.round(center.x / 0.625)) < 1e-9);
assert.ok(Math.abs(center.z / 0.625 - Math.round(center.z / 0.625)) < 1e-9);
assert.equal(robots[0].rotation.y, Math.PI * 3 / 4, '45-degree snap is shared with group rotation');
assert.ok(messages.some(message => message.includes('blocked')));
context.formationLockX.checked = true;
const lockedX = robots[0].position.x;
assert.equal(context.transformEditorFormation({ x: 5, z: 1, rotation: 0, scale: 1 }), true);
assert.equal(robots[0].position.x, lockedX, 'Grid snap cannot move a locked axis');
context.formationLockX.checked = false;
context.bypassDrillSnap = true;
const freeStart = robots[0].position.clone();
const freeYaw = robots[0].rotation.y;
assert.equal(context.transformEditorFormation({ x: 0.13, z: 0.17, rotation: 0.12, scale: 1 }), true);
assert.ok(Math.abs(robots[0].rotation.y - freeYaw - 0.12) < 1e-9, 'Shift bypasses angle snap');
assert.deepEqual(context.snapToStepGrid(freeStart), freeStart, 'Shift bypasses coordinate rounding');
context.bypassDrillSnap = false;
context.gridSnapToggle.checked = false;
context.angleSnapToggle.checked = false;
robots.forEach((robot, index) => robot.position.set(index === 1 ? 0.8 : index * 2, -0.48, index * 2));
const identities = [...segment.robots];
const facing = robots.map(robot => robot.rotation.y);
assert.equal(context.alignEditorFormation('distributeX'), true);
assert.equal(robots[1].position.x, 2, 'Distribution moves interior marchers to exact intervals');
assert.ok(robots.every((robot, index) => robot.position.y === -0.48 && robot.position.z === index * 2),
  'Distribution preserves height and the unedited Babylon coordinate');
assert.equal(context.alignEditorFormation('alignX'), true);
assert.ok(robots.every(robot => robot.position.x === 2));
assert.deepEqual(segment.robots, identities, 'Alignment retains marcher identities');
assert.deepEqual(robots.map(robot => robot.rotation.y), facing, 'Alignment retains facings');
assert.equal(segment.controlPoints.length, robots.length, 'Edited geometry follows actual marcher targets');
const alignedSnapshot = JSON.stringify(segment);
blocked = true;
assert.equal(context.alignEditorFormation('round'), false);
assert.equal(JSON.stringify(segment), alignedSnapshot, 'Alignment collisions roll back poses and geometry');
blocked = false;
hasRoute = true;
assert.equal(context.alignEditorFormation('alignZ'), false);
assert.equal(JSON.stringify(segment), alignedSnapshot, 'Alignment protects marching routes');
hasRoute = false;
robots[0].position.x = 2.2;
assert.equal(context.alignEditorFormation('round'), true);
assert.equal(robots[0].position.x, 2, 'Whole-yard rounding is explicit regardless of snap toggle');
const generated = [];
const anchor = {
  position: new Vector3(10, -0.48, 20), rotation: { y: 0 }, isDisposed: () => false,
};
Object.assign(context, {
  handInteraction: { marcherGrabs: new Map() }, selectedRobot: null,
  formationSpacingInput: { value: '2.5' },
  createHandFormation(_anchor, points, fitClosedCircle = true) {
    generated.push({ points, fitClosedCircle });
  },
  createSegment(_kind, points) { generated.push({ points }); },
  removeRobotPath() {}, selectRobot() {},
});
vm.runInContext(extract('createFormationPreset'), context);
for (const preset of ['line', 'arc', 'circle', 'block', 'triangle', 'square', 'pentagon', 'hexagon', 'star']) {
  generated.length = 0;
  context.createFormationPreset(preset, anchor);
  assert.equal(generated.length, preset === 'block' ? 3 : 1, `${preset}: correct rank count`);
  assert.ok(generated.every(form => form.points.length >= 2 &&
    form.points.every(point => Number.isFinite(point.x + point.y + point.z))), `${preset}: finite form geometry`);
  if (['circle', 'triangle', 'square', 'pentagon', 'hexagon', 'star'].includes(preset)) {
    const points = generated[0].points;
    assert.ok(Vector3.Distance(points[0], points.at(-1)) < 1e-9, `${preset}: closed form`);
  }
}
console.log('Drill editing checks passed: custom rounding, Shift bypass, axis locks, alignment/distribution, transforms, spacing, identity, collision rollback, and route protection.');
