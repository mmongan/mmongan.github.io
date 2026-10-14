import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const compile = source => stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, '');
const context = vm.createContext({ Math, Number, Vector3 });
vm.runInContext(compile(readFileSync(new URL('../src/interaction/drillEditing.ts', import.meta.url), 'utf8')), context);
const { snapDrillPoint, transformFormationPoint } = context;
assert.deepEqual({ ...snapDrillPoint({ x: -1.1, y: -0.48, z: 2.7 }, 0.625) },
  { x: -1.25, y: -0.48, z: 2.5 });
assert.throws(() => snapDrillPoint({ x: 0, y: 0, z: 0 }, 0), /positive/);
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
vm.runInContext([extract('snapToStepGrid'), extract('snapAngle'), extract('transformEditorFormation')].join('\n'), context);
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
context.gridSnapToggle.checked = false;
context.angleSnapToggle.checked = false;
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
console.log('Drill editing checks passed: grid, transforms, spacing, identity, facing, collision rollback, and route protection.');
