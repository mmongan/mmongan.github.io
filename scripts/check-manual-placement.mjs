import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js')) specifier += '.js';
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return {
      format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }),
      shortCircuit: true,
    };
    return next(url, context);
  },
});
const { registerManualPlacementMarcher, tryManualMarcherPose, tryManualMarcherPoses,
  canPlaceManualMarcherPose, onManualPlacementBlocked } = await import('../src/robot/manualPlacement.ts');
const engine = new NullEngine();
const scene = new Scene(engine);
let blocked = 0;
onManualPlacementBlocked.add(() => blocked++);
const root = new TransformNode('fieldRoot', scene);
function marcher(name, position, instrumentSize = null) {
  const robot = new TransformNode(name, scene);
  robot.parent = root;
  robot.position.copyFrom(position);
  const body = MeshBuilder.CreateBox(`${name}-body`, { width: 0.4, height: 1.8, depth: 0.4 }, scene);
  body.position.y = 0.9;
  body.parent = robot;
  const meshes = [body];
  if (instrumentSize) {
    const horn = MeshBuilder.CreateBox(`${name}-horn`,
      { width: 0.01, height: 0.01, depth: instrumentSize }, scene);
    horn.position.set(0, 1.4, 0.2 + instrumentSize / 2);
    horn.parent = robot;
    meshes.push(horn);
  }
  registerManualPlacementMarcher(robot, () => meshes);
  return robot;
}
try {
  const a = marcher('held', new Vector3(-2, 0, 0), 1.5);
  const b = marcher('standing', new Vector3(0, 0, 0));
  const original = a.position.clone();
  const blockedBefore = blocked;
  assert.equal(canPlaceManualMarcherPose(a, new Vector3(-3, 0, 0), 0.4), true);
  assert.ok(a.position.equals(original), 'Successful preview never moves the real marcher');
  assert.equal(a.rotation.y, 0, 'Successful preview restores facing');
  assert.equal(canPlaceManualMarcherPose(a, new Vector3(0, 0, 0), 0, false), false);
  assert.ok(a.position.equals(original), 'Blocked preview restores the real pose');
  assert.equal(blocked, blockedBefore, 'Preview checks do not emit blocked-placement feedback');
  assert.equal(tryManualMarcherPose(a, new Vector3(0, 0, -1.3), 0, false), false,
    'Protruding horn blocks placement even with body centers 1.3 yards apart');
  assert.equal(a.position.x, -2, 'Rejected placement restores position');
  assert.equal(tryManualMarcherPose(a, new Vector3(2, 0, 0)), false,
    'A single-frame drag cannot tunnel through another body');
  assert.equal(tryManualMarcherPose(a, new Vector3(-2, 0, -3)), true, 'Clear movement succeeds');
  a.position.set(-0.8, 0, 0);
  assert.equal(tryManualMarcherPose(a, a.position, Math.PI / 2), false,
    'A wrist twist cannot swing the protruding horn through a neighbor');
  assert.equal(a.rotation.y, 0, 'Rejected wrist twist restores facing');
  assert.equal(tryManualMarcherPose(a, new Vector3(0, 3, 0), 0, false), true,
    'Vertical separation is respected');
  a.position.set(0, 0, 0);
  assert.equal(tryManualMarcherPose(a, new Vector3(-3, 0, 0)), true,
    'Can escape an existing overlap in an imported drill');
  const before = a.position.clone();
  assert.equal(tryManualMarcherPoses([
    { robot: a, position: new Vector3(-1, 0, 0) },
    { robot: b, position: new Vector3(-1, 0, 0) },
  ], false), false, 'Formation members are checked against one another');
  assert.ok(a.position.equals(before), 'Group rejection is atomic');
  b.setEnabled(false);
  assert.equal(tryManualMarcherPose(a, new Vector3(0, 0, 0), 0, false), true,
    'Disabled/erased marchers do not block placement');
  b.setEnabled(true);
  a.position.set(-3, 0, 0);
  for (const scale of [0.03, 1, 4]) {
    root.scaling.setAll(scale);
    root.rotation.y = 0.8;
    assert.equal(tryManualMarcherPose(a, new Vector3(3, 0, 0)), false,
      'Swept contact works on rotated/scaled tabletop and giant fields');
  }
  root.scaling.setAll(1);
  root.rotation.y = 0;
  a.dispose();
  b.dispose();

  // Two thin protrusions crossing between samples, with their bodies clear.
  const thinA = marcher('thinA', new Vector3(-1, 0, 0), 1.5);
  const thinB = marcher('thinB', new Vector3(0, 0, 2), 1.5);
  thinB.rotation.y = Math.PI;
  assert.equal(tryManualMarcherPose(thinA, new Vector3(1, 0, 0)), false,
    'Continuous bounds catch 1cm instruments crossing between frames');
  thinA.dispose();
  thinB.dispose();

  const editA = marcher('editA', new Vector3(-3, 0, 0), 1.5);
  const editB = marcher('editB', new Vector3(5, 0, 5));
  const originalCount = new Vector3(-3, 0, 0);
  const players = new Map([
    [editA, { counts: [{ position: originalCount, rotationY: 0 }] }],
    [editB, { counts: [{ position: Vector3.Zero(), rotationY: 0 }] }],
  ]);
  let applied = 0;
  const context = vm.createContext({
    players, allRobots: new Set([editA, editB]), tryManualMarcherPose,
    getChartPageTimeline: () => ({ authoredCounts: [] }), authorChartPage() {},
    pendingLegBakes: new Set(),
    applyGlobalCount: () => applied++, recalculateCollisionMarkers: () => {},
  });
  const robotSource = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
  vm.runInContext(stripTypeScriptTypes(robotSource.slice(robotSource.indexOf('function clearBakedCountGaits('),
    robotSource.indexOf('function getGaitStepPhaseOffsets('))), context);
  const invalidateStart = robotSource.indexOf('function invalidateLegBake(');
  vm.runInContext(stripTypeScriptTypes(robotSource.slice(invalidateStart,
    robotSource.indexOf('\n}', invalidateStart) + 2)), context);
  const countStart = robotSource.indexOf('export function setRobotCountPosition(');
  const countEdit = robotSource.slice(countStart, robotSource.indexOf('\n}', countStart) + 2);
  vm.runInContext(`${stripTypeScriptTypes(countEdit).replace('export ', '')}
globalThis.edit = setRobotCountPosition;`, context);
  context.edit(editA, 0, new Vector3(0, 0, -1.3), scene);
  assert.ok(originalCount.equals(new Vector3(-3, 0, 0)),
    'Count edit rejects instrument contact at that count, not the current playback positions');
  assert.ok(editB.position.equals(new Vector3(5, 0, 5)), 'Count validation restores other live poses');
  assert.equal(applied, 0, 'Rejected count edit does not update playback');
  let disposedBake = 0;
  players.get(editA).legBake = { table: { dispose() { disposedBake++; } } };
  context.edit(editA, 0, new Vector3(-4, 0, 0), scene);
  assert.equal(applied, 1, 'Clear explicit count edit succeeds');
  assert.equal(disposedBake, 1, 'Successful authored edits discard obsolete baked leg poses');
  const setStart = robotSource.indexOf('export function setRobotSetPoses(');
  Object.assign(context, {
    Vector3, tryManualMarcherPoses, applyGlobalCountToAllRobots: () => applied++,
  });
  vm.runInContext(stripTypeScriptTypes(robotSource.slice(setStart, robotSource.indexOf('\n}', setStart) + 2))
    .replace('export ', ''), context);
  const beforeSet = JSON.stringify([...players.values()].map(state => state.counts));
  assert.equal(context.setRobotSetPoses(0, [
    { robot: editA, position: Vector3.Zero() }, { robot: editB, position: Vector3.Zero() },
  ], 0, 0, scene), false, 'Actual body/instrument bounds reject a colliding destination set atomically');
  assert.equal(JSON.stringify([...players.values()].map(state => state.counts)), beforeSet);
  assert.equal(context.setRobotSetPoses(0, [
    { robot: editA, position: new Vector3(-6, 0, 0) }, { robot: editB, position: new Vector3(6, 0, 0) },
  ], 0, 0, scene), true, 'Clear set transaction succeeds with actual transformed bounds');
  editA.dispose();
  editB.dispose();

  const modules = [
    ['trumpetModel', 'getTrumpetTemplate'], ['mellophoneModel', 'getMellophoneTemplate'],
    ['tromboneModel', 'getTromboneTemplate'], ['euphoniumModel', 'getEuphoniumTemplate'],
    ['sousaphoneModel', 'getSousaphoneTemplate'], ['saxophoneModel', 'getSaxophoneTemplate'],
    ['bariSaxophoneModel', 'getBariSaxophoneTemplate'], ['clarinetModel', 'getClarinetTemplate'],
    ['fluteModel', 'getFluteTemplate'], ['percussionModels', 'getSnareTemplate'],
    ['percussionModels', 'getTenorTemplate'], ['percussionModels', 'getBassDrumTemplate'],
    ['percussionModels', 'getGlockenspielTemplate'],
    ['percussionModels', 'getCymbalTemplate'],
  ];
  for (const [file, template] of modules) {
    const mod = await import(`../src/robot/${file}.ts`);
    const hornRoot = new TransformNode(template, scene);
    const horn = mod[template](scene).clone(`${template}-held`, hornRoot);
    horn.isVisible = true;
    horn.setEnabled(true);
    registerManualPlacementMarcher(hornRoot, () => [horn]);
    horn.computeWorldMatrix(true);
    const center = horn.getBoundingInfo().boundingBox.centerWorld.clone();
    const obstacle = marcher('instrument-obstacle', new Vector3(center.x, center.y - 0.9, center.z));
    hornRoot.position.x = -5;
    assert.equal(tryManualMarcherPose(hornRoot, Vector3.Zero(), 0, false), false,
      `${template}: real model bounds reject body contact`);
    assert.equal(tryManualMarcherPose(hornRoot, new Vector3(5, 0, 0)), false,
      `${template}: real instrument cannot pass through a marcher`);
    hornRoot.dispose();
    obstacle.dispose();
  }
  assert.ok(blocked >= 30, 'Rejected edits emit explicit feedback');
  console.log(`Manual placement checks passed: all ${modules.length} actual instrument models, bodies, thin swept contacts, atomic formation rejection, overlap escape, disabled marchers, and rotated/scaled AR/giant fields.`);
} finally {
  scene.dispose();
  engine.dispose();
  hooks.deregister();
}
