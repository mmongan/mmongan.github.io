import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
const context = vm.createContext({ Vector3, FIELD_SURFACE_Y: -0.48,
  FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120 });
for (const file of ['draftingGeometry', 'guideMarcherLayout', 'draftingWorkspace']) {
  const source = readFileSync(new URL(`../src/interaction/${file}.ts`, import.meta.url), 'utf8');
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
}
const point = (x, z) => new Vector3(x, -0.455, z);
const line = [point(0, 0), point(5, 0)];
let poses = context.sampleGuideMarchers(line, { spacing: 2 });
assert.deepEqual(Array.from(poses, pose => pose.position.x), [0, 2, 4], 'Spacing is exact, not redistributed to fit endpoints');
assert.ok(poses.every(pose => Math.abs(pose.rotationY - Math.PI / 2) < 1e-8));
poses = context.sampleGuideMarchers(line, { spacing: 2, facing: 'reverse' });
assert.ok(poses.every(pose => Math.abs(pose.rotationY + Math.PI / 2) < 1e-8));
poses = context.sampleGuideMarchers(line, { spacing: 2, facing: 'fixed', facingAngle: 30 });
assert.ok(poses.every(pose => Math.abs(pose.rotationY - Math.PI / 6) < 1e-8));
poses = context.sampleGuideMarchers([point(0, 0), point(2, 0), point(2, 2)], { spacing: 1 });
assert.ok(Math.abs(poses[2].rotationY) < 1e-8, 'Corner uses outgoing guide tangent');
assert.equal(poses.length, 5);
poses = context.sampleGuideMarchers([point(0, 0), point(2, 0), point(2, 2), point(0, 2), point(0, 0)], { spacing: 1 });
assert.equal(poses.length, 8, 'Closed guide never duplicates its start slot');
assert.throws(() => context.sampleGuideMarchers(line, { spacing: 0 }));
const workspace = {
  version: 1, guides: [{ points: line, options: { spacing: 2, facing: 'fixed', facingAngle: 75 } }],
  settings: { spacing: 1.25, angle: 45, text: '', offsetSide: 1,
    parallelReference: false, gridVisible: false, gridInterval: 5 },
};
let parsed = context.parseDraftingWorkspace(context.serializeDraftingWorkspace(workspace));
assert.equal(parsed.guides[0].options.spacing, 2);
assert.equal(parsed.guides[0].options.facingAngle, 75);
delete workspace.guides[0].options.spacing;
delete workspace.guides[0].options.facing;
delete workspace.guides[0].options.facingAngle;
parsed = context.parseDraftingWorkspace(context.serializeDraftingWorkspace(workspace));
assert.equal(context.getGuideMarcherSettings(parsed.guides[0].options).spacing, 1.25, 'Older saves have stable default settings');
for (const options of [{ spacing: 0 }, { facing: 'invalid' }, { facingAngle: Infinity }]) {
  workspace.guides[0].options = options;
  assert.throws(() => context.serializeDraftingWorkspace(workspace), 'Malformed guide configuration is rejected');
}
const path = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
const start = path.indexOf('function rebuildSegmentContent(');
const end = path.indexOf('// Records a newly-drawn/extended curve', start);
assert.ok(start >= 0 && end > start);
Object.assign(context, {
  eraseHistory: { clear() {} }, acceptedFormationControls: new Map(), pathRoot: {},
  createLowPolyRobot: () => ({ position: Vector3.Zero(), rotation: { y: 0 }, setEnabled() {}, dispose() {} }),
  isClosedFormation: points => points.length > 2 && points[0].equals(points[points.length - 1]),
  snapAngle: value => value,
  tryManualMarcherPoses: poses => {
    poses.forEach(pose => {
      pose.robot.position.copyFrom(pose.position);
      pose.robot.rotation.y = pose.rotationY;
    });
    return true;
  },
  scene: {}, rebuildFormationConnections() {}, refreshFormationEditor() {},
});
vm.runInContext(stripTypeScriptTypes(path.slice(start, end), { mode: 'transform' }), context);
const segment = { kind: 'formation', robots: [], controlPoints: line, spacing: 2,
  guideLayout: { spacing: 2, facing: 'fixed', facingAngle: 75 } };
context.rebuildSegmentContent(segment);
assert.deepEqual(Array.from(segment.robots, robot => robot.position.x), [0, 2, 4], 'Real formation builder uses the guide slots without resampling');
assert.ok(segment.robots.every(robot => Math.abs(robot.rotation.y - 75 * Math.PI / 180) < 1e-8),
  'Real formation builder applies configured facing to every marcher');
console.log('Guide marcher layout passed: exact slots, endpoints, corners, loops, all facing modes, persistence, old saves, and validation.');
