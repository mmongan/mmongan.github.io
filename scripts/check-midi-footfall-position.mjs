import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import initSqlJs from 'sql.js';

const robotSource = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const gaitSource = readFileSync(new URL('../src/robot/gaitSelection.ts', import.meta.url), 'utf8');
const node = () => ({ position: Vector3.Zero(), rotation: Vector3.Zero() });
const parts = {
  gaitIndex: 0, instrumentRestPose: false, body: node(), instrumentRoot: node(), legRoot: node(),
  leftLeg: node(), rightLeg: node(), leftKnee: node(), rightKnee: node(),
  leftAnkle: node(), rightAnkle: node(), leftThigh: node(), rightThigh: node(),
  leftShoe: node(), rightShoe: node(),
};
const robot = node();
const state = {
  counts: Array.from({ length: 40 }, (_, i) => ({ position: new Vector3(0, 0, i * 0.2), rotationY: 0 })),
};
let drillBeat = 1.25;
let musicBeat = 4.25;
let cadence = 1;
let facingYaw = 0;
const playback = { playing: true, speedMultiplier: 1, countIndex: 1, stepAccumulatorSeconds: 0 };
const bodyScale = 1.8 / 0.9144 / 1.372;
const context = vm.createContext({
  Matrix, Quaternion, Vector3, Math, Number, Map, Set,
  heldRobots: new Set(), marcherParts: new Map([[robot, parts]]), globalPlayback: playback,
  players: new Map([[robot, state]]), ghostBandPreview: null,
  limitedStrideCounts: new WeakMap(), onMarcherStrideLimited: { notifyObservers(message) { warnings.push(message); } },
  playbackTempoMap: [{ beat: 0, bpm: 120 }],
  repeatOptions: { songLength: 32 },
  playbackBeatUnits: [],
  playbackPpq: 480, playbackCountTicks: [],
  transportRevision: 0,
  getDrillTransportState: () => ({ beat: drillBeat }),
  getMusicTransportState: () => ({ beat: musicBeat }),
  resolveSegmentGait: () => ({
    gaitIndex: 0, stepsPerCount: cadence, bodyYaw: facingYaw,
    legYawOffset: Math.abs(facingYaw) === Math.PI / 2 ? -facingYaw : 0,
    inPlace: false, sideways: Math.abs(facingYaw) === Math.PI / 2,
  }),
  getGaitStepPhaseOffsets: () => Array(12).fill(0),
  orientMarcherShoes() {}, attachMarcherThigh() {}, alignMarcherKnee() {}, applyInstrumentPose() {},
  MARCHER_BODY_SCALE: bodyScale, MARCHER_BUILD_SCALE: 0.64, MAX_KNEE_BEND_RADIANS: 1.35,
});
const warnings = [];
const run = source => vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?from .*?;\r?$/gm, '').replace(/export /g, ''), context);
run(gaitSource);
run(readFileSync(new URL('../src/audio/drillMidiTiming.ts', import.meta.url), 'utf8'));
run(readFileSync(new URL('../src/audio/midiBeatPulse.ts', import.meta.url), 'utf8'));
run(readFileSync(new URL('../src/robot/marcherLegPose.ts', import.meta.url), 'utf8'));
run(readFileSync(new URL('../src/robot/marcherStepCycleModel.ts', import.meta.url), 'utf8'));
const cycleSource = readFileSync(new URL('../src/robot/marcherStepCycles.ts', import.meta.url), 'utf8');
run(cycleSource.slice(0, cycleSource.indexOf('fetch(cycleUrl)')) +
  cycleSource.slice(cycleSource.indexOf('export function sharedMarcherStepPose')));
const cycleFile = readFileSync(new URL('../src/robot/marcherStepCycles.bin', import.meta.url));
context.loadMarcherStepCycles(new Float32Array(cycleFile.buffer.slice(
  cycleFile.byteOffset, cycleFile.byteOffset + cycleFile.byteLength)));
run(readFileSync(new URL('../src/robot/bakedLegAnimation.ts', import.meta.url), 'utf8'));
const { calfLength, shoeForwardOffset, shoeHalfHeight } = vm.runInContext(
  '({ calfLength: MARCHER_CALF_LENGTH, shoeForwardOffset: MARCHER_SHOE_FORWARD_OFFSET, shoeHalfHeight: MARCHER_SHOE_HALF_HEIGHT })', context);
run(readFileSync(new URL('../src/robot/marcherFootTargets.ts', import.meta.url), 'utf8'));
run(readFileSync(new URL('../src/robot/marcherFootContacts.ts', import.meta.url), 'utf8'));
const fieldLift = progress => context.marcherSwingLift(progress, 0.16) * bodyScale;
assert.equal(fieldLift(0), 0, 'Swing starts on the field');
assert.ok(fieldLift(1) < 1e-12, 'Swing lands exactly on the beat');
assert.ok(fieldLift(0.5) * 0.9144 > 0.15 && fieldLift(0.5) * 0.9144 < 0.2,
  'Field march has visible, anatomically reachable 15-20 cm swing clearance');
const epsilon = 1e-5;
assert.ok(fieldLift(epsilon) / epsilon < 1e-4 &&
  fieldLift(1 - epsilon) / epsilon < 1e-4, 'Vertical foot speed eases to zero at lift-off and landing');
for (let progress = 0.01; progress < 0.5; progress += 0.01) {
  assert.ok(fieldLift(progress) > fieldLift(progress - 0.01), 'Swing rises smoothly without a clipped plateau');
  assert.ok(Math.abs(fieldLift(progress) - fieldLift(1 - progress)) < 1e-9, 'Swing lift and landing are symmetric');
}
run(robotSource.slice(robotSource.indexOf('export const MARCHING_GAITS ='),
  robotSource.indexOf('let selectedMarchingGait')));
run(robotSource.slice(robotSource.indexOf('function wrapAngle(angle:'),
  robotSource.indexOf('function applyGlobalCountToAllRobots')));
vm.runInContext('legAnimationBakingEnabled = false; sharedStepCyclesEnabled = false', context);
const pose = () => {
  context.applyGlobalCount(robot, state);
  return [parts.leftKnee.rotation.x, parts.rightKnee.rotation.x, ...robot.position.asArray()];
};

const groundPitch = context.marcherGroundFootPitch;
const exactLegSolver = context.solvePlantedMarcherLeg;
let legSolves = 0;
context.solvePlantedMarcherLeg = (...args) => {
  legSolves++;
  return exactLegSolver(...args);
};
let contactSolves = 0;
context.marcherGroundFootPitch = (...args) => {
  contactSolves++;
  return groundPitch(...args);
};
if (process.argv.includes('--benchmark') || process.argv.includes('--benchmark-baked')) {
  const marchers = Array.from({ length: 100 }, (_, index) => {
    const root = node();
    const rig = Object.fromEntries(Object.entries(parts).map(([key, value]) =>
      [key, value && typeof value === 'object' ? node() : value]));
    context.marcherParts.set(root, rig);
    return { root, state: { counts: [] }, index };
  });
  const modes = [
    { name: 'Uncached', step: false, leg: false },
    { name: 'Step cache', step: true, leg: false },
    { name: 'Step + leg cache', step: true, leg: true },
    { name: 'Shared step cycles', step: true, leg: true, cycles: true },
  ];
  if (process.argv.includes('--benchmark-baked')) {
    modes.push({ name: 'Baked show', step: true, leg: true, baked: true });
  }
  const cachedLegSolver = context.precalculateMarcherLegPose;
  const results = [];
  for (const varied of [false, true]) {
    for (const marcher of marchers) {
      const stride = varied ? 0.15 + marcher.index * 0.003 : 0.2;
      marcher.state.counts = Array.from({ length: 40 }, (_, count) => ({
        position: new Vector3(marcher.index * 2, 0, count * stride), rotationY: 0,
      }));
    }
    const tables = [];
    if (process.argv.includes('--benchmark-baked')) {
      const Bake = vm.runInContext('BakedLegAnimation', context);
      for (const marcher of marchers) {
        let table = !varied ? tables[0] : undefined;
        if (!table) {
          const sampleState = { ...marcher.state, stepCache: undefined };
          table = new Bake(39, beat => context.applyGlobalCount(marcher.root, sampleState,
            { drillBeat: beat, musicBeat: beat }), 4);
          while (table.completedCounts < 5 && !table.complete) table.advance();
          tables.push(table);
        }
        marcher.state.legBake = { counts: marcher.state.counts, beatUnits: context.playbackBeatUnits,
          key: '0:0:32:', table };
      }
    }
    const measurements = modes.map(() => ({ times: [], legs: 0, contacts: 0 }));
    for (let trial = 0; trial < 3; trial++) {
      for (let order = 0; order < modes.length; order++) {
        const modeIndex = (order + trial) % modes.length;
        const mode = modes[modeIndex];
        vm.runInContext(`legAnimationBakingEnabled = ${!!mode.baked}`, context);
        vm.runInContext(`sharedStepCyclesEnabled = ${!!mode.cycles}`, context);
        const measurement = measurements[modeIndex];
        context.precalculateMarcherLegPose = mode.leg ? cachedLegSolver : context.solvePlantedMarcherLeg;
        vm.runInContext('precalculatedLegPoses.clear()', context);
        marchers.forEach(marcher => { marcher.state.stepCache = undefined; });
        for (let frame = -30; frame < 180; frame++) {
          musicBeat = drillBeat = 4 + (frame + 30) / 45;
          const beforeLegs = legSolves;
          const beforeContacts = contactSolves;
          const start = performance.now();
          for (const marcher of marchers) {
            if (!mode.step) marcher.state.stepCache = undefined;
            context.applyGlobalCount(marcher.root, marcher.state);
          }
          const elapsed = performance.now() - start;
          if (frame >= 0) {
            measurement.times.push(elapsed);
            measurement.legs += legSolves - beforeLegs;
            measurement.contacts += contactSolves - beforeContacts;
          }
        }
      }
    }
    const baseline = measurements[0].times.reduce((sum, time) => sum + time, 0) /
      measurements[0].times.length;
    measurements.forEach((measurement, index) => {
      const times = measurement.times.sort((a, b) => a - b);
      const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
      results.push({
        routes: varied ? '100 different strides' : '100 equivalent strides',
        mode: modes[index].name,
        meanMs: +mean.toFixed(3),
        p95Ms: +times[Math.ceil(times.length * 0.95) - 1].toFixed(3),
        cpuReductionPercent: +(100 * (1 - mean / baseline)).toFixed(1),
        legSolvesPerFrame: +(measurement.legs / times.length).toFixed(2),
        contactSolvesPerFrame: +(measurement.contacts / times.length).toFixed(2),
      });
    });
    tables.forEach(table => table.dispose());
  }
  console.log('CPU animation benchmark: 100 marchers, 120 BPM, 90 updates/second.');
  console.log('Three interleaved trials; 30 warmup + 180 measured frames per trial.');
  console.log('Real applyGlobalCount/IK in the regression VM; rendering, matrix attachment, gait resolution, and instrument updates are excluded.');
  console.table(results);
  process.exit(0);
}
const renderedPose = () => {
  pose();
  return [
    ...robot.position.asArray(), ...robot.rotation.asArray(),
    ...[parts.leftLeg, parts.rightLeg].flatMap(leg => leg.rotation.asArray()),
    ...[parts.leftKnee, parts.rightKnee, parts.leftAnkle, parts.rightAnkle]
      .flatMap(joint => joint.rotationQuaternion.asArray()),
  ];
};
if (process.argv.includes('--step-cycles-only')) {
  vm.runInContext('sharedStepCyclesEnabled = true', context);
  const soleFrom = (leg, knee, ankle) => {
    const calf = leg.multiply(knee);
    const foot = calf.multiply(ankle);
    const pitch = foot.toEulerAngles().x;
    return new Vector3(0, 0.69, 0)
      .add(new Vector3(0, -0.315, 0).rotateByQuaternionToRef(leg, Vector3.Zero()))
      .add(new Vector3(0, -0.315, 0).rotateByQuaternionToRef(calf, Vector3.Zero()))
      .add(new Vector3(0, -0.03, 0.055).rotateByQuaternionToRef(foot, Vector3.Zero()))
      .subtract(new Vector3(0, context.marcherShoeGroundDepth(pitch), context.marcherShoeRollOffset(pitch)));
  };
  let maxError = 0;
  for (const rate of [0.5, 1, 2]) {
    cadence = rate;
    for (const yaw of [0, 0.7, Math.PI / 2, Math.PI]) {
      facingYaw = yaw;
      state.counts = Array.from({ length: 80 }, (_, index) => ({
        position: new Vector3(7 + Math.sin(yaw) * index * 0.2, 0,
          -3 + Math.cos(yaw) * index * 0.2), rotationY: yaw,
      }));
      state.stepCache = undefined;
      for (let frame = 0; frame < 180; frame++) {
        musicBeat = drillBeat = (12 + frame / 90) / rate;
        const exact = context.applyGlobalCount(robot, state, { drillBeat, musicBeat });
        pose();
        assert.ok(Vector3.Distance(robot.position, new Vector3(7 + Math.sin(yaw) * drillBeat * 0.2,
          0, -3 + Math.cos(yaw) * drillBeat * 0.2)) < 1e-8, 'Root travel stays exact');
        for (const [i, leg, knee, ankle] of [
          [0, parts.leftLeg, parts.leftKnee, parts.leftAnkle],
          [1, parts.rightLeg, parts.rightKnee, parts.rightAnkle],
        ]) {
          const actual = soleFrom(Quaternion.FromEulerAngles(...leg.rotation.asArray()),
            knee.rotationQuaternion, ankle.rotationQuaternion);
          const expected = soleFrom(exact.legs[i].legRotation, exact.legs[i].kneeRotation, exact.legs[i].ankleRotation);
          const error = Vector3.Distance(actual, expected);
          maxError = Math.max(maxError, error);
          assert.ok(error < 0.000101, `Shared cycles preserve beat/parity/contact, error ${error}`);
        }
      }
    }
  }
  const hitsBefore = context.getMarcherStepCycleStatus().hits;
  state.counts[14].position.x += 0.1;
  state.stepCache = undefined;
  cadence = 1; facingYaw = 0;
  musicBeat = drillBeat = 12.2;
  pose();
  assert.equal(context.getMarcherStepCycleStatus().hits, hitsBefore, 'Irregular paths retain live IK');
  console.log(`Shared-cycle integration: ${hitsBefore} leg hits; max sole error ${maxError}; exact root motion, beat parity, cadence, translation, turns fallback.`);
  assert.ok(hitsBefore > 2000, 'Actual marcher playback uses shared cycles substantially');
  process.exit(0);
}
for (const rate of [0.5, 1, 2]) {
  cadence = rate;
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    facingYaw = yaw;
    state.stepCache = undefined;
    for (let sample = 1; sample < 90; sample++) {
      musicBeat = drillBeat = (4 + sample / 100) / rate;
      const cached = renderedPose();
      const saved = state.stepCache;
      state.stepCache = undefined;
      const uncached = renderedPose();
      state.stepCache = saved;
      cached.forEach((value, index) => assert.ok(Math.abs(value - uncached[index]) < 1e-6,
        'Cached steps preserve the complete rendered leg pose'));
    }
  }
}
cadence = 1;
facingYaw = 0;
musicBeat = drillBeat = 4.1;
state.stepCache = undefined;
renderedPose();
contactSolves = 0;
for (let sample = 11; sample < 49; sample++) {
  musicBeat = drillBeat = 4 + sample / 100;
  renderedPose();
}
assert.equal(contactSolves, 0, 'Steady frames reuse precalculated contact roll without ground-pitch solves');
context.transportRevision++;
renderedPose();
assert.ok(contactSolves > 0, 'Transport discontinuities invalidate step contacts');
const cacheBeforeMeterChange = state.stepCache;
context.playbackBeatUnits = [{ beat: 0, quarterNotesPerPulse: 1.5 }];
renderedPose();
assert.notEqual(state.stepCache, cacheBeforeMeterChange, 'MIDI meter changes invalidate step contacts');
context.playbackBeatUnits = [];
const cacheBeforeRouteChange = state.stepCache;
state.counts = state.counts.map(count => ({ ...count, position: count.position.clone() }));
renderedPose();
assert.notEqual(state.stepCache, cacheBeforeRouteChange, 'Rebuilt routes invalidate step contacts');
context.marcherGroundFootPitch = groundPitch;
state.stepCache = undefined;
musicBeat = drillBeat = 4.25;
const sharedLegPose = renderedPose();
legSolves = 0;
renderedPose();
assert.equal(legSolves, 0, 'Repeated rig-local leg animation reuses solved poses');
const precalculatedSolver = context.precalculateMarcherLegPose;
context.precalculateMarcherLegPose = exactLegSolver;
try {
  const exactPose = renderedPose();
  sharedLegPose.forEach((value, index) => assert.ok(Math.abs(value - exactPose[index]) < 1e-6,
    'Precalculated leg animation matches the exact solver'));
} finally {
  context.precalculateMarcherLegPose = precalculatedSolver;
}
const hip = new Vector3(-0.0576, 0.69, 0);
const sole = new Vector3(-0.0576, 0.05, 0.08);
const firstLegPose = context.precalculateMarcherLegPose(hip, sole, 0);
const expectedKnee = firstLegPose.kneeRotation.asArray();
firstLegPose.kneeRotation.x = 99;
assert.deepEqual(context.precalculateMarcherLegPose(hip, sole, 0).kneeRotation.asArray(), expectedKnee,
  'Marcher joint updates cannot mutate shared cached animations');
legSolves = 0;
const sharedSole = new Vector3(-0.0576, 0.05, 0.081234);
for (let marcher = 0; marcher < 100; marcher++) {
  context.precalculateMarcherLegPose(hip, sharedSole, 0);
}
assert.equal(legSolves, 1, 'One hundred equivalent marcher leg poses need only one exact solve');
context.solvePlantedMarcherLeg = exactLegSolver;
console.log('Step precalculation checks passed: identical cached/uncached poses, zero repeat contact solves, timing and route invalidation.');
const normalGaitResolver = context.resolveSegmentGait;
const normalCounts = state.counts;
context.resolveSegmentGait = (...args) => ({ ...normalGaitResolver(...args), inPlace: true });
state.counts = Array.from({ length: 40 }, (_, index) =>
  ({ position: new Vector3(0, 0, index * 0.02), rotationY: 0 }));
for (const direction of [1, -1]) {
  playback.speedMultiplier = direction;
  for (let sample = 0; sample <= 200; sample++) {
    musicBeat = drillBeat = 4 + sample / 100;
    pose();
    assert.ok(Math.abs(robot.position.z - drillBeat * 0.02) < 1e-9,
      'Auto mark-time feet do not freeze short authored moves or snap at counts');
  }
}
parts.gaitIndex = 6;
musicBeat = drillBeat = 4.25;
pose();
assert.equal(robot.position.z, 0, 'Explicit Mark Time still holds the route origin');
parts.gaitIndex = 0;
playback.speedMultiplier = 1;
context.resolveSegmentGait = normalGaitResolver;
state.counts = normalCounts;
state.stepCache = undefined;
console.log('Short-move regression passed: continuous auto travel, forward/reverse counts, explicit mark-time preserved.');
if (process.argv.includes('--shared-bake-only')) {
  context.setTimeout = () => 1;
  const makeMarcher = (offset, stride = 0.25) => {
    const root = node();
    const rig = Object.fromEntries(Object.entries(parts).map(([key, value]) =>
      [key, value && typeof value === 'object' ? node() : value]));
    rig.gaitIndex = 0;
    context.marcherParts.set(root, rig);
    return { root, rig, state: { counts: Array.from({ length: 5 }, (_, index) =>
      ({ position: new Vector3(offset, 0, offset + index * stride), rotationY: 0 })) } };
  };
  const a = makeMarcher(0);
  const b = makeMarcher(12);
  const c = makeMarcher(24, 0.3);
  musicBeat = drillBeat = 1.25;
  vm.runInContext('legAnimationBakingEnabled = true', context);
  for (const marcher of [a, b, c]) context.applyGlobalCount(marcher.root, marcher.state);
  const shared = a.state.legBake.table;
  assert.equal(shared, b.state.legBake.table, 'Translated identical routes share the producer');
  assert.notEqual(shared, c.state.legBake.table, 'Different strides require separate preparation');
  shared.advance();
  context.invalidateLegBake(a.state);
  context.heldRobots.add(a.root);
  context.marcherParts.delete(a.root);
  while (!shared.complete) shared.advance();
  assert.ok(shared.poseAt(1.25), 'Deleting/holding the original marcher cannot break shared preparation');
  const expected = context.applyGlobalCount(b.root, b.state, { drillBeat, musicBeat });
  legSolves = contactSolves = 0;
  context.applyGlobalCount(b.root, b.state);
  assert.equal(legSolves, 0);
  assert.equal(contactSolves, 0);
  assert.ok(Quaternion.Dot(b.rig.leftKnee.rotationQuaternion, expected.legs[0].kneeRotation) > 1 - 1e-10);
  assert.equal(b.root.position.z, 12 + drillBeat * 0.25, 'Shared leg data never changes authored root travel');
  const d = makeMarcher(32);
  d.state.counts[2].facingY = 0.5;
  context.applyGlobalCount(d.root, d.state);
  assert.notEqual(shared, d.state.legBake.table, 'Facing changes do not share the route bake');
  const e = makeMarcher(40);
  musicBeat -= 0.25;
  context.applyGlobalCount(e.root, e.state);
  assert.notEqual(shared, e.state.legBake.table, 'Different music offsets do not share the route bake');
  for (const marcher of [b, c, d, e]) context.invalidateLegBake(marcher.state);
  assert.equal(shared.byteLength, 0, 'Last equivalent marcher releases the producer buffers');
  assert.equal(context.getBakedLegAnimationBytes(), 0);
  assert.equal(vm.runInContext('pendingLegBakes.size', context), 0);
  const long = makeMarcher(0);
  long.state.counts = Array.from({ length: 48 }, (_, index) =>
    ({ position: new Vector3(0, 0, index * 0.25), rotationY: 0 }));
  musicBeat = drillBeat;
  context.applyGlobalCount(long.root, long.state);
  const cycleTable = long.state.legBake.table;
  while (!cycleTable.complete) cycleTable.advance();
  assert.ok(cycleTable.reusedCycles > 0, 'Repeated straight steps within one route reuse cycle preparation');
  for (const beat of [20.125, 21.337, 24.75]) {
    musicBeat = drillBeat = beat;
    const expected = context.applyGlobalCount(long.root, long.state, { drillBeat, musicBeat });
    legSolves = contactSolves = 0;
    context.applyGlobalCount(long.root, long.state);
    assert.equal(legSolves, 0);
    assert.equal(contactSolves, 0);
    for (const [index, leg, knee, ankle] of [
      [0, long.rig.leftLeg, long.rig.leftKnee, long.rig.leftAnkle],
      [1, long.rig.rightLeg, long.rig.rightKnee, long.rig.rightAnkle],
    ]) {
      const upper = Quaternion.FromEulerAngles(leg.rotation.x, leg.rotation.y, leg.rotation.z);
      for (const [actual, exact] of [[upper, expected.legs[index].legRotation],
        [knee.rotationQuaternion, expected.legs[index].kneeRotation],
        [ankle.rotationQuaternion, expected.legs[index].ankleRotation]]) {
        assert.ok(Math.abs(Quaternion.Dot(actual, exact)) > 1 - 1e-10,
          'Shared cycles preserve both feet, ankles and knees at the correct musical phase');
      }
    }
  }
  console.log(`Steady route reused ${cycleTable.reusedCycles} count-sized step-cycle sections.`);
  context.invalidateLegBake(long.state);
  assert.equal(context.getBakedLegAnimationBytes(), 0, 'Cycle and route caches release together');
  console.log('Shared bake integration passed: translated routes, unique inputs, root travel, donor removal, solve elimination, and cleanup.');
  process.exit(0);
}
if (process.argv.includes('--step-cache-only')) process.exit(0);

for (const rate of [0.5, 1, 2]) {
  cadence = rate;
  for (let step = 0; step < 8; step++) {
    musicBeat = (step + 0.25) / rate;
    const sample = pose();
    assert.equal(sample[0] < sample[1], step % 2 === 0, 'Left/right phase follows MIDI, not route count');
    playback.playing = false;
    assert.deepEqual(pose(), sample, 'Pause freezes the exact pose and drill position');
    playback.playing = true;
    assert.deepEqual(pose(), sample, 'Resume preserves the exact footfall phase');
  }
}
cadence = 1;
const footMatrix = (leg, knee, ankle) => {
  const legMatrix = Matrix.Compose(Vector3.One(),
    Quaternion.FromEulerAngles(leg.rotation.x, leg.rotation.y, leg.rotation.z), leg.position);
  const kneeMatrix = Matrix.Compose(Vector3.One(), knee.rotationQuaternion, knee.position);
  const ankleMatrix = Matrix.Compose(Vector3.One(), ankle.rotationQuaternion,
    new Vector3(0, -calfLength, 0));
  return ankleMatrix.multiply(kneeMatrix).multiply(legMatrix);
};
const footPitch = (leg, knee, ankle) => {
  const matrix = footMatrix(leg, knee, ankle);
  const forward = Vector3.TransformNormal(Vector3.Forward(), matrix);
  const up = Vector3.TransformNormal(Vector3.Up(), matrix);
  return Math.atan2(-forward.y, up.y);
};
const solePosition = (leg, knee, ankle) => {
  const matrix = footMatrix(leg, knee, ankle);
  const center = Vector3.TransformCoordinates(new Vector3(0, -shoeHalfHeight, shoeForwardOffset), matrix);
  const footUp = Vector3.TransformNormal(Vector3.Up(), matrix);
  const footForward = Vector3.TransformNormal(Vector3.Forward(), matrix);
  assert.ok(Math.abs(footForward.x) < 1e-6 && footForward.z > 0,
    'Feet yaw stays aligned with the torso, even during sideways marching');
  const pitch = Math.atan2(-footForward.y, footUp.y);
  center.y -= context.marcherShoeGroundDepth(pitch);
  center.z -= context.marcherShoeRollOffset(pitch);
  center.scaleInPlace(bodyScale);
  center.y += parts.body.position.y;
  return Vector3.TransformCoordinates(center, Matrix.RotationY(robot.rotation.y)).add(robot.position);
};
const contactSlipAt = (beat, leg, knee, ankle) => {
  const worldPoint = local => {
    const point = Vector3.TransformCoordinates(local, footMatrix(leg, knee, ankle)).scale(bodyScale);
    return Vector3.TransformCoordinates(point, Matrix.RotationY(robot.rotation.y)).add(robot.position);
  };
  musicBeat = drillBeat = beat;
  pose();
  const vertices = [[0, -0.085], [-0.03, -0.075], [-0.03, 0.055],
    [-0.0225, 0.095], [0, 0.105]]
    .map(([y, z]) => new Vector3(0, y - shoeHalfHeight, z + shoeForwardOffset));
  const contact = vertices.reduce((lowest, vertex) => worldPoint(vertex).y < worldPoint(lowest).y ? vertex : lowest);
  assert.ok(Math.abs(worldPoint(contact).y) < 1e-6, 'Actual sole surface contacts the field');
  const epsilon = 0.0001;
  musicBeat = drillBeat = beat - epsilon;
  pose();
  const before = worldPoint(contact);
  musicBeat = drillBeat = beat + epsilon;
  pose();
  const after = worldPoint(contact);
  return Math.hypot(after.x - before.x, after.z - before.z) / (2 * epsilon);
};
if (process.argv.includes('--bake-only')) {
  const Bake = vm.runInContext('BakedLegAnimation', context);
  let maxPoseError = 0;
  let maxSoleError = 0;
  let hits = 0;
  let misses = 0;
  let maxSlip = 0;
  for (const [rate, yaw, unit, stride] of [
    [1, 0, 1, 0.2], [1, 0, 1, 0.625], [1, Math.PI / 2, 1, 0.2],
    [1, Math.PI, 1, 0.2], [2, 0, 1.5, 0.625], [0.5, 0, 1, 0.2],
  ].slice(0, process.argv.includes('--bake-smoke') ? 1 : undefined)) {
    cadence = rate;
    facingYaw = yaw;
    context.playbackBeatUnits = [{ beat: 0, quarterNotesPerPulse: unit }];
    state.counts = Array.from({ length: 12 }, (_, index) =>
      ({ position: new Vector3(0, 0, index * stride), rotationY: 0 }));
    state.stepCache = undefined;
    const sampleState = { ...state, stepCache: undefined };
    const before = renderedPose();
    const started = performance.now();
    const table = new Bake(6, beat =>
      context.applyGlobalCount(robot, sampleState, { drillBeat: beat, musicBeat: beat }));
    while (!table.complete) table.advance();
    assert.deepEqual(renderedPose(), before, 'Baking does not change the rendered pose or transport');
    console.log(`Baked stride=${stride} yd/count, cadence=${rate}, yaw=${yaw}, pulse=${unit}: ${table.byteLength} bytes, ` +
      `${table.fallbackIntervals} fallback intervals, ${(performance.now() - started).toFixed(0)}ms`);
    state.legBake = { counts: state.counts, beatUnits: context.playbackBeatUnits,
      key: '0:0:32:', table };
    for (let sample = 0; sample < 1000; sample++) {
      musicBeat = drillBeat = 1 + sample * 4 / 1000;
      vm.runInContext('legAnimationBakingEnabled = false', context);
      const exact = renderedPose();
      const exactSole = solePosition(parts.leftLeg, parts.leftKnee, parts.leftAnkle);
      const available = table.poseAt(drillBeat);
      available ? hits++ : misses++;
      vm.runInContext('legAnimationBakingEnabled = true', context);
      legSolves = contactSolves = 0;
      const baked = renderedPose();
      if (available) {
        assert.equal(legSolves, 0, 'Baked playback does not solve IK');
        assert.equal(contactSolves, 0, 'Baked playback does not calculate contact pitches');
      }
      const error = Math.max(...baked.map((value, index) => Math.abs(value - exact[index])));
      maxPoseError = Math.max(error, maxPoseError);
      maxSoleError = Math.max(maxSoleError,
        Vector3.Distance(exactSole, solePosition(parts.leftLeg, parts.leftKnee, parts.leftAnkle)));
      assert.ok(error < 3e-6, `Baked rendered pose remains equivalent: error=${error}, beat=${drillBeat}, ` +
        `component=${baked.findIndex((value, index) => Math.abs(value - exact[index]) === error)}`);
    }
    for (let sample = 1; sample < 100; sample++) {
      const beat = (2 + sample / 100) * unit / rate;
      const slip = contactSlipAt(beat, parts.leftLeg, parts.leftKnee, parts.leftAnkle) * unit / rate;
      maxSlip = Math.max(maxSlip, slip);
      assert.ok(slip < 0.001, `Baked actual sole surface does not skate: ${slip} yards/pulse`);
    }
    for (const direction of [-1, 1]) {
      playback.speedMultiplier = direction;
      for (const playing of [false, true]) {
        playback.playing = playing;
        for (const beat of [2, 2.125, 2.5, 2.999]) {
          musicBeat = drillBeat = beat;
          vm.runInContext('legAnimationBakingEnabled = false', context);
          const exact = renderedPose();
          vm.runInContext('legAnimationBakingEnabled = true', context);
          const baked = renderedPose();
          assert.ok(baked.every((value, index) => Math.abs(value - exact[index]) < 3e-6),
            'Baked playback preserves pause, reverse, seeks and exact count boundaries');
        }
      }
    }
    playback.speedMultiplier = 1;
    playback.playing = true;
    const revisionTable = state.legBake;
    context.transportRevision++;
    renderedPose();
    assert.equal(state.legBake, revisionTable, 'Ordinary seeks retain musical-count bake data');
    vm.runInContext('legAnimationBakingEnabled = false', context);
    table.dispose();
    assert.equal(table.byteLength, 0, 'Disposing a show releases packed pose buffers');
    state.legBake = undefined;
  }
  assert.ok(hits > 0.98 * (hits + misses), 'Ordinary marching uses baked poses for at least 98% of samples');
  assert.ok(maxSoleError < 2e-6, 'Baked foot contact stays within two millionths of a yard of exact IK');
  const baselineUnits = context.playbackBeatUnits;
  const originalCounts = state.counts;
  const changes = [
    () => { state.counts = state.counts.slice(); },
    () => { context.playbackBeatUnits = [...baselineUnits]; },
    () => { parts.gaitIndex = 6; },
    () => { musicBeat = drillBeat + 0.25; },
    () => { context.repeatOptions.drill = true; },
    () => { context.repeatOptions.songLength = 64; },
  ];
  for (const change of changes) {
    parts.gaitIndex = 0;
    state.counts = originalCounts;
    context.playbackBeatUnits = baselineUnits;
    context.repeatOptions = { songLength: 32 };
    musicBeat = drillBeat = 4.25;
    const table = new Bake(1, beat => context.applyGlobalCount(robot, state,
      { drillBeat: beat, musicBeat: beat }));
    while (!table.complete) table.advance();
    state.legBake = { counts: state.counts, beatUnits: context.playbackBeatUnits, key: '0:0:32:', table };
    change();
    renderedPose();
    assert.equal(state.legBake, undefined, 'Route, meter, gait, phase-offset, and loop edits invalidate baking');
    assert.equal(table.byteLength, 0, 'Invalidation frees obsolete pose data');
  }
  console.log(`Baked playback passed: ${hits} hits, ${misses} exact fallbacks; ` +
    `max pose error=${maxPoseError}, max sole error=${maxSoleError} yards, max contact slip=${maxSlip} yards/pulse.`);
  process.exit(0);
}
const plantedPositions = new Map();
let marchingBodyHeight;
for (let beat = 0; beat < 8; beat += 0.125) {
  musicBeat = beat;
  drillBeat = beat;
  pose();
  marchingBodyHeight ??= parts.body.position.y;
  assert.equal(parts.body.position.y, marchingBodyHeight, 'Marching torso does not bounce between steps');
  assert.equal(parts.body.position.y, 0, 'Marchers maintain an upright, uncrouched torso');
  const progress = beat % 1;
  const plantedLeft = Math.floor(beat) % 2 === 0;
  const left = solePosition(parts.leftLeg, parts.leftKnee, parts.leftAnkle);
  const right = solePosition(parts.rightLeg, parts.rightKnee, parts.rightAnkle);
  const leftY = left.y;
  const rightY = right.y;
  assert.ok(Math.abs(plantedLeft ? leftY : rightY) < 1e-6,
    `Stance sole remains on the ground: beat=${beat}, left=${leftY}, right=${rightY}`);
  assert.ok((plantedLeft ? parts.leftKnee : parts.rightKnee).rotation.x < 1e-4,
    'Supporting knee remains straight during field marching');
  const supportKnee = plantedLeft ? parts.leftKnee : parts.rightKnee;
  const calfDirection = Vector3.TransformNormal(Vector3.Down(),
    Matrix.Compose(Vector3.One(), supportKnee.rotationQuaternion, Vector3.Zero()));
  assert.ok(Vector3.Dot(Vector3.Down(), calfDirection) > 1 - 1e-6,
    'Rendered support calf and thigh are collinear, not just the diagnostic knee angle');
  const planted = plantedLeft ? left : right;
  const supportPitch = plantedLeft
    ? footPitch(parts.leftLeg, parts.leftKnee, parts.leftAnkle)
    : footPitch(parts.rightLeg, parts.rightKnee, parts.rightAnkle);
  if (progress < 0.5) assert.ok(supportPitch < -1e-6, 'Toe is up at forward heel strike, not at push-off');
  if (progress > 0.5) assert.ok(supportPitch > 1e-6, 'Heel rises and toe lowers behind the body at push-off');
  const key = Math.floor(beat);
  if (!plantedPositions.has(key)) plantedPositions.set(key, planted);
  assert.ok(Vector3.Distance(plantedPositions.get(key), planted) < 1e-6,
    'Stance sole stays fixed on the field while the body advances');
  if (progress === 0) {
    assert.ok(Math.abs(leftY) < 1e-6 && Math.abs(rightY) < 1e-6, 'Swing sole lands exactly at MIDI beat');
  } else {
    assert.ok((plantedLeft ? rightY : leftY) > 0.01, 'Swing sole is airborne between MIDI beats');
  }
}
for (let sample = 0; sample <= 200; sample++) {
  const progress = sample / 200;
  musicBeat = drillBeat = 2 + progress;
  pose();
  const swingSole = solePosition(parts.rightLeg, parts.rightKnee, parts.rightAnkle);
  assert.ok(Math.abs(swingSole.y - fieldLift(progress)) < 1e-6,
    `Rendered swing follows the smooth arc without reach clipping: progress=${progress}`);
}
const sampleSwingPitches = () => {
  const pitches = [];
  for (let sample = 0; sample <= 2000; sample++) {
    musicBeat = drillBeat = 3 + sample / 2000;
    pose();
    pitches.push(footPitch(parts.leftLeg, parts.leftKnee, parts.leftAnkle));
  }
  return pitches;
};
const peakAngularAcceleration = pitches => {
  let peak = 0;
  for (let sample = 1; sample + 1 < pitches.length; sample++) {
    const acceleration = Math.abs(pitches[sample + 1] - 2 * pitches[sample] + pitches[sample - 1]) * 2000 ** 2;
    peak = Math.max(peak, acceleration);
  }
  return peak;
};
for (const stride of [0.2, 0.625]) {
  state.counts.forEach((count, index) => { count.position.z = index * stride; });
  for (const direction of [0, Math.PI]) {
    facingYaw = direction;
    const cyclePitches = [];
    for (let sample = 0; sample <= 4000; sample++) {
      musicBeat = drillBeat = 2.5 + sample / 2000;
      pose();
      cyclePitches.push(footPitch(parts.leftLeg, parts.leftKnee, parts.leftAnkle));
    }
    assert.ok(peakAngularAcceleration(cyclePitches) < 1200,
      `Complete cycle stays continuous through polygonal sole corners: stride=${stride}, yaw=${direction}, acceleration=${peakAngularAcceleration(cyclePitches)}`);
    const interval = 0.0005;
    for (const boundary of [3, 4]) {
      const pitches = [];
      for (const offset of [-interval, 0, interval]) {
        musicBeat = drillBeat = boundary + offset;
        pose();
        pitches.push(footPitch(parts.leftLeg, parts.leftKnee, parts.leftAnkle));
      }
      const before = (pitches[1] - pitches[0]) / interval;
      const after = (pitches[2] - pitches[1]) / interval;
      assert.ok(Math.abs(after - before) < 0.3,
        `Contact handoff preserves ankle velocity: stride=${stride}, yaw=${direction}, beat=${boundary}, before=${before}, after=${after}`);
    }
    const pitches = sampleSwingPitches();
    const maxAcceleration = peakAngularAcceleration(pitches);
    assert.ok(maxAcceleration < 150,
      `Swing ankle eases without springing flat or toe-up: stride=${stride}, yaw=${direction}, acceleration=${maxAcceleration}`);
    assert.ok(Math.abs(pitches[1000]) < 1e-6, 'Swing foot passes level without an extra toe flick');
    const maxContactPitch = Math.max(Math.abs(pitches[0]), Math.abs(pitches.at(-1)));
    assert.ok(pitches.every(pitch => Math.abs(pitch) <= maxContactPitch + 5 * Math.PI / 180),
      'Matching contact velocity adds no more than five degrees of recovery roll');
    const easedSolver = context.precalculateMarcherLegPose;
    let reachOnlyAcceleration;
    context.precalculateMarcherLegPose = (hip, sole, yaw) => exactLegSolver(hip, sole, yaw);
    try {
      reachOnlyAcceleration = peakAngularAcceleration(sampleSwingPitches());
    } finally {
      context.precalculateMarcherLegPose = easedSolver;
    }
    assert.ok(maxAcceleration < reachOnlyAcceleration / 4,
      'Eased swing removes at least three quarters of the reach-only toe spring acceleration');
    console.log(`Swing ankle stride=${stride}, yaw=${direction}: peak angular acceleration ${reachOnlyAcceleration.toFixed(1)} -> ${maxAcceleration.toFixed(1)} radians/pulse²`);
  }
}
state.counts.forEach((count, index) => { count.position.z = index * 0.2; });
let maximumContactSlipSpeed = 0;
for (const stride of [0.2, 0.625]) {
  state.counts.forEach((count, index) => { count.position.z = index * stride; });
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    facingYaw = yaw;
    for (const step of [2, 3]) {
      const [leg, knee, ankle] = step % 2 === 0
        ? [parts.leftLeg, parts.leftKnee, parts.leftAnkle]
        : [parts.rightLeg, parts.rightKnee, parts.rightAnkle];
      for (let sample = 1; sample < 100; sample++) {
        const beat = step + sample / 100;
        const speed = contactSlipAt(beat, leg, knee, ankle);
        maximumContactSlipSpeed = Math.max(maximumContactSlipSpeed, speed);
        assert.ok(speed < 0.001,
          `Actual contacting shoe surface does not skate: stride=${stride}, yaw=${yaw}, beat=${beat}, speed=${speed}`);
      }
    }
  }
}
console.log(`Actual sole contact: maximum horizontal slip ${maximumContactSlipSpeed.toFixed(6)} yards/pulse.`);
state.counts.forEach((count, index) => { count.position.z = index * 0.2; });
facingYaw = 0;
for (const yaw of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
  facingYaw = yaw;
  let planted;
  for (let beat = 2; beat < 3; beat += 0.125) {
    musicBeat = drillBeat = beat;
    pose();
    const foot = solePosition(parts.leftLeg, parts.leftKnee, parts.leftAnkle);
    planted ??= foot;
    assert.ok(Vector3.Distance(planted, foot) < 1e-6, 'No skating during sideways or backward marching');
  }
}
facingYaw = 0;
for (const direction of [1, -1]) {
  facingYaw = direction === 1 ? 0 : Math.PI;
  let previousPitch;
  for (let sample = 0; sample <= 200; sample++) {
    musicBeat = drillBeat = 4 + sample / 201;
    pose();
    const pitch = footPitch(parts.leftLeg, parts.leftKnee, parts.leftAnkle);
    const expectedSign = direction * (sample / 201 < 0.5 ? -1 : 1);
    if (Math.abs(sample / 201 - 0.5) > .02) {
      assert.ok(pitch * expectedSign > 0, 'Foot roll follows body-relative placement for forward and backward travel');
    }
    if (previousPitch !== undefined) assert.ok(Math.abs(pitch - previousPitch) < .02,
      `Heel-to-toe roll remains continuous: direction=${direction}, sample=${sample}, previous=${previousPitch}, pitch=${pitch}`);
    previousPitch = pitch;
  }
}
facingYaw = 0;
for (const yaw of [0, Math.PI / 2, Math.PI]) {
  facingYaw = yaw;
  for (const step of [2, 3]) {
    let previousRecovery;
    let previousBody;
    for (let sample = 0; sample <= 200; sample++) {
      musicBeat = drillBeat = step + sample / 200;
      pose();
      const swing = step % 2 === 0
        ? solePosition(parts.rightLeg, parts.rightKnee, parts.rightAnkle)
        : solePosition(parts.leftLeg, parts.leftKnee, parts.leftAnkle);
      const recovery = swing.z - robot.position.z;
      if (previousRecovery !== undefined) {
        assert.ok(recovery >= previousRecovery - 1e-6,
          `Swing never doubles back relative to advancing hips: yaw=${yaw}, step=${step}, sample=${sample}`);
        assert.ok(robot.position.z >= previousBody - 1e-9, 'Body never rocks backward along a straight forward route');
      }
      previousRecovery = recovery;
      previousBody = robot.position.z;
    }
  }
}
facingYaw = 0;
musicBeat = 5.25;
drillBeat = 1.25;
const beforeLoop = pose();
drillBeat = 0.25;
const afterLoop = pose();
assert.equal(afterLoop[0] < afterLoop[1], beforeLoop[0] < beforeLoop[1],
  'Drill loop does not reset continuous MIDI left/right phase; knee angles adapt to foot reach');
musicBeat = 0.25;
assert.ok(pose()[0] < pose()[1], 'Song loop resets feet to the MIDI opening beat');
context.playbackTempoMap = null;
assert.ok(pose()[0] < pose()[1], 'Manual tempo override still follows the loaded MIDI beat position');
context.playbackBeatUnits = [{ beat: 0, quarterNotesPerPulse: 1.5 }];
for (let pulse = 0; pulse < 8; pulse++) {
  musicBeat = (pulse + 0.25) * 1.5;
  assert.equal(pose()[0] < pose()[1], pulse % 2 === 0,
    '6/8 alternates feet on dotted-quarter pulses, not quarter notes');
}
context.playbackBeatUnits = [];
musicBeat = 0.25;
playback.speedMultiplier = -2;
assert.ok(pose()[0] < pose()[1], 'Reverse playback uses the same pose at the same MIDI position');
assert.equal(robot.position.z, 0.05, 'Drill interpolation follows the shared fractional beat');
for (const unit of [1, 1.5]) {
  context.playbackBeatUnits = [{ beat: 0, quarterNotesPerPulse: unit }];
  for (const rate of [0.5, 1, 2]) {
    cadence = rate;
    state.counts.forEach((count, index) => { count.position.z = index * 0.625 * rate / unit; });
    for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      facingYaw = yaw;
      const warningCount = warnings.length;
      let planted;
      for (let progress = 0; progress < 1; progress += 0.125) {
        musicBeat = drillBeat = (4 + progress) * unit / rate;
        pose();
        const sole = solePosition(parts.leftLeg, parts.leftKnee, parts.leftAnkle);
        planted ??= sole;
        assert.ok(Vector3.Distance(planted, sole) < 1e-6,
          'Standard 8-to-5 strides keep a fixed stance sole at every cadence, meter, and facing');
        assert.ok(Math.abs(sole.y) < 1e-6);
      }
      assert.equal(warnings.length, warningCount,
        `Ordinary 8-to-5 marching is not flagged as unmarchable: unit=${unit}, cadence=${rate}, yaw=${yaw}`);
    }
  }
}
context.playbackBeatUnits = [];
for (const distance of [0.2, 0.625, 2, 10]) {
  for (const rate of [0.5, 1, 2]) {
    cadence = rate;
    state.counts.forEach((count, index) => { count.position.z = index * distance; });
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      facingYaw = yaw;
      for (let beat = 2; beat < 4; beat += 0.125) {
        musicBeat = drillBeat = beat;
        assert.doesNotThrow(pose, `Extreme route distance=${distance}, rate=${rate}, yaw=${yaw}, beat=${beat}`);
        for (const [leg, knee, ankle] of [
          [parts.leftLeg, parts.leftKnee, parts.leftAnkle],
          [parts.rightLeg, parts.rightKnee, parts.rightAnkle],
        ]) {
          assert.equal(knee.position.y, -0.315, 'Thigh length never stretches, even on impossible routes');
          assert.ok(knee.rotation.x >= 0 && knee.rotation.x <= 1.35 + 1e-6, 'Knees stay within anatomical limits');
          const sole = solePosition(leg, knee, ankle);
          assert.ok(sole.y >= -1e-6, 'Bounded steps do not penetrate the field');
          assert.ok(Number.isFinite(sole.x + sole.y + sole.z), 'Extreme routes produce finite poses');
        }
      }
    }
  }
}
assert.ok(warnings.some(message => message.includes('Unmarchable')), 'Impossible routes are explicitly flagged');
run(readFileSync(new URL('../src/robot/openMarchFormat.ts', import.meta.url), 'utf8'));
run(robotSource.slice(robotSource.indexOf('const GAIT_INDEX_BY_NAME ='),
  robotSource.indexOf('// The gait a marcher uses leaving')));
const gaitIndex = name => vm.runInContext('MARCHING_GAITS', context).findIndex(gait => gait.name === name);
const transformSnapshot = () => JSON.stringify([robot, parts]);
let verifiedContacts = 0;
for (const songLength of [0, 32]) {
  context.repeatOptions = { songLength, drill: false };
  for (const offset of [0, 0.12345678, -2.37]) {
    for (const unit of [1, 1.5, 1.3]) {
      context.playbackBeatUnits = [{ beat: 0, quarterNotesPerPulse: unit },
        { beat: 7.3, quarterNotesPerPulse: 0.7 }];
      for (const [stride, yaw, style] of [
        [0.08, 0, 'Field March'], [0.2, Math.PI / 2, 'Field March'],
        [0.625, Math.PI, 'Field March'], [2, 0, 'Field March'], [0, 0, 'Mark Time'],
      ]) {
        state.counts = Array.from({ length: 14 }, (_, index) => ({
          position: new Vector3(index > 6 ? (index - 6) * stride : 0, 0, Math.min(index, 6) * stride),
          rotationY: index > 6 ? Math.PI / 2 : 0, facingY: yaw,
        }));
        state.stepCache = undefined; state.gaitPhaseCache = undefined; state.legBake = undefined;
        parts.gaitIndex = gaitIndex(style);
        musicBeat = 3; drillBeat = musicBeat + offset;
        playback.speedMultiplier = 1;
        const before = transformSnapshot(), route = JSON.stringify(state.counts), transport = [drillBeat, musicBeat];
        const source = context.getRobotFootprintSource(robot);
        const contacts = source.build();
        assert.ok(contacts.length > 0, 'Animated routes produce solver contacts');
        assert.equal(transformSnapshot(), before, 'Sampling never changes rendered marcher transforms');
        assert.equal(JSON.stringify(state.counts), route, 'Sampling never edits route data');
        assert.equal(state.stepCache, undefined, 'Sampling has isolated step caches');
        assert.equal(state.gaitPhaseCache, undefined, 'Sampling has isolated gait caches');
        assert.deepEqual([drillBeat, musicBeat], transport, 'Sampling never seeks either transport');
        assert.equal(context.getRobotFootprintSource(robot).key, source.key, 'Unchanged source key is stable');
        for (const contact of contacts) {
          drillBeat = contact.beat; musicBeat = drillBeat - offset;
          pose();
          const expected = contact.left
            ? solePosition(parts.leftLeg, parts.leftKnee, parts.leftAnkle)
            : solePosition(parts.rightLeg, parts.rightKnee, parts.rightAnkle);
          assert.ok(Vector3.Distance(expected, contact.position) < 1e-6,
            `Solver footprint matches rendered sole: song=${songLength} offset=${offset} unit=${unit} beat=${contact.beat}`);
          assert.ok(Math.abs(Math.sin(contact.yaw - robot.rotation.y)) < 1e-6,
            'Footprint yaw matches rendered shoe yaw');
          assert.ok(contact.beat >= 0 && contact.beat < state.counts.length - 1);
          verifiedContacts++;
        }
        musicBeat = 3; drillBeat = musicBeat + offset;
        const key = context.getRobotFootprintSource(robot).key;
        state.counts[0].position.x += .01;
        assert.notEqual(context.getRobotFootprintSource(robot).key, key, 'Route edits invalidate source');
      }
    }
  }
}
console.log(`Exact footprint sampling checks passed: ${verifiedContacts} contacts agree with rendered sole transforms within 1e-6 yards; no transport, route, pose, or cache mutation.`);
const SQL = await initSqlJs();
const example = context.readOpenMarchDatabase(SQL,
  readFileSync(new URL('../src/assets/openmarch/example-show.dots', import.meta.url)), 53.333);
const exampleWarnings = [];
context.onMarcherStrideLimited.notifyObservers = message => exampleWarnings.push(
  `${message} beat=${drillBeat}, gait=${context.resolveSegmentGait(state, Math.floor(drillBeat), 0)?.label}`);
context.repeatOptions = { songLength: 10000, drill: false };
context.playbackBeatUnits = [{ beat: 0, quarterNotesPerPulse: 1.5 }];
playback.speedMultiplier = 1;
if (process.argv.includes('--measure-segment-sharing')) {
  const Bake = vm.runInContext('BakedLegAnimation', context);
  const routes = example.tracks.map(track => ({ counts: track.map((point, index) => {
    const next = track[Math.min(index + 1, track.length - 1)];
    return { position: new Vector3(point.x, 0, point.z),
      rotationY: Math.atan2(next.x - point.x, next.z - point.z) };
  }) }));
  const groups = new Map();
  const signature = (route, count) => {
    const last = route.counts.length - 1;
    const start = Math.max(0, count - 12);
    const end = Math.min(last, count + 13);
    const origin = route.counts[count].position;
    // Six quarter notes preserve foot parity for half/normal/double cadence in constant 6/8.
    return JSON.stringify([count % 6, start - count, end - count,
      route.counts.slice(start, end + 1).map(item => [
        item.position.x - origin.x, item.position.y, item.position.z - origin.z,
        item.rotationY, item.facingY,
      ])]);
  };
  let total = 0;
  for (const route of routes) {
    for (let count = 0; count < route.counts.length - 1; count++) {
      const key = signature(route, count);
      const group = groups.get(key) ?? [];
      group.push({ route, count });
      groups.set(key, group);
      total++;
    }
  }
  let checked = 0;
  let maxError = 0;
  const values = pose => pose ? [
    ...pose.legs.flatMap(leg => [leg.legRotation, leg.kneeRotation, leg.ankleRotation]
      .flatMap(rotation => rotation.asArray())),
    ...pose.legs.map(leg => leg.kneeAngle), pose.hipHalfSpacing, +pose.limited,
  ] : undefined;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const reference = group[0];
    for (const progress of [0.13, 0.51, 0.87]) {
      const beat = reference.count + progress;
      const expected = values(context.applyGlobalCount(robot, reference.route, { drillBeat: beat, musicBeat: beat }));
      for (const member of group.slice(1)) {
        const beat = member.count + progress;
        const actual = values(context.applyGlobalCount(robot, member.route, { drillBeat: beat, musicBeat: beat }));
        assert.equal(!!actual, !!expected, 'Shared contexts agree on attention versus moving');
        if (actual) {
          const error = Math.max(...actual.map((value, index) => Math.abs(value - expected[index])));
          maxError = Math.max(maxError, error);
          assert.ok(error < 3e-6, `Candidate segments preserve poses: ${error}`);
        }
        checked++;
      }
    }
  }
  const subset = routes.flatMap(route => Array.from({ length: 8 }, (_, index) => ({ route, count: 24 + index })));
  const runWorkload = reuse => {
    const cache = new Map();
    let producers = 0, advances = 0, buffers = 0;
    const start = performance.now();
    for (const { route, count } of subset) {
      const key = signature(route, count);
      if (reuse && cache.has(key)) continue;
      const sampleState = { ...route, stepCache: undefined };
      const table = new Bake(route.counts.length - 1, beat =>
        context.applyGlobalCount(robot, sampleState, { drillBeat: beat, musicBeat: beat }), count);
      while (table.completedCounts < 1 && !table.complete) { table.advance(); advances++; }
      producers++;
      buffers += table.byteLength;
      table.dispose();
      cache.set(key, true);
    }
    return { ms: +(performance.now() - start).toFixed(1), producers, advances, attributedBytes: buffers };
  };
  // Warm up both the VM and the adaptive curve builder before timing.
  const warmup = new Bake(1, beat => context.applyGlobalCount(robot, routes[0],
    { drillBeat: beat, musicBeat: beat }));
  while (!warmup.complete) warmup.advance();
  warmup.dispose();
  const independent = runWorkload(false);
  const shared = runWorkload(true);
  console.log(JSON.stringify({
    scope: 'Example show, 40 routes, constant 6/8, auto gait, no drill loop; exact translated 12-count context',
    totalCountSegments: total, uniqueContexts: groups.size,
    duplicateSegments: total - groups.size,
    duplicatePercent: +(100 * (1 - groups.size / total)).toFixed(2),
    verifiedPoseComparisons: checked, maxPoseError: maxError,
    benchmarkScope: 'Counts 24 through 31 on all 40 routes; 320 count segments; preparation only',
    independent, shared,
    measuredPreparationReductionPercent: +(100 * (1 - shared.ms / independent.ms)).toFixed(1),
    note: 'Offline prototype measurement, not production segment sharing or per-frame/FPS improvement.',
  }, null, 2));
  process.exit(0);
}
if (process.argv.includes('--bake-show')) {
  const Bake = vm.runInContext('BakedLegAnimation', context);
  let hits = 0;
  let exactFrames = 0;
  let maxError = 0;
  for (const trackIndex of [0, 10, 20, 30]) {
    const track = example.tracks[trackIndex];
    state.counts = track.map((point, index) => {
      const next = track[Math.min(index + 1, track.length - 1)];
      return { position: new Vector3(point.x, 0, point.z),
        rotationY: Math.atan2(next.x - point.x, next.z - point.z) };
    });
    parts.gaitIndex = 0;
    for (const firstCount of [44, 94, 526]) {
      const sampleState = { ...state, stepCache: undefined, legBake: undefined };
      const table = new Bake(track.length - 1, beat => context.applyGlobalCount(robot, sampleState,
        { drillBeat: beat, musicBeat: beat }), firstCount);
      while (table.completedCounts < 3 && !table.complete) table.advance();
      state.legBake = { counts: state.counts, beatUnits: context.playbackBeatUnits,
        key: '0:0:10000:false', table };
      for (let sample = 0; sample < 300; sample++) {
        musicBeat = drillBeat = firstCount + sample / 100;
        vm.runInContext('legAnimationBakingEnabled = false', context);
        const exact = renderedPose();
        vm.runInContext('legAnimationBakingEnabled = true', context);
        const baked = renderedPose();
        table.poseAt(drillBeat) ? hits++ : exactFrames++;
        const error = Math.max(...baked.map((value, index) => Math.abs(value - exact[index])));
        maxError = Math.max(maxError, error);
        assert.ok(error < 3e-6, `Imported show bake: track=${trackIndex}, beat=${drillBeat}, error=${error}`);
      }
      vm.runInContext('legAnimationBakingEnabled = false', context);
      context.invalidateLegBake(state);
    }
  }
  assert.ok(hits > 0, 'Imported routes actually use baked animation');
  console.log(`Imported-show bake checks passed: ${hits} baked samples, ${exactFrames} exact/attention samples, max pose error=${maxError}.`);
  process.exit(0);
}
for (const track of example.tracks) {
  state.counts = track.map((point, index) => {
    assert.ok(Number.isFinite(point.x + point.z), 'Example coordinates must be finite');
    const next = track[Math.min(index + 1, track.length - 1)];
    return { position: new Vector3(point.x, 0, point.z),
      rotationY: Math.atan2(next.x - point.x, next.z - point.z) };
  });
  parts.gaitIndex = 0;
  for (let beat = 0; beat < track.length - 1; beat += 0.25) {
    musicBeat = drillBeat = beat;
    pose();
  }
}
assert.equal(exampleWarnings.length, 0,
  `Standard example must be fully marchable: ${exampleWarnings.slice(0, 5).join('; ')}`);
context.repeatOptions = { songLength: 0, drill: false };
context.playbackBeatUnits = [];
for (const facing of [0, Math.PI / 2, Math.PI]) {
  parts.gaitIndex = gaitIndex('Field March');
  const authored = Array.from({ length: 9 }, (_, count) => ({
    position: new Vector3(0, 0, count * 0.25), rotationY: 0, facingY: facing,
    ...(count === 4 ? { styleIndex: gaitIndex('Mark Time') } : {}),
  }));
  state.counts = authored;
  const baked = authored.map((count, index) => ({
    ...count, bakedGait: context.resolveSegmentGait(state, index, parts.gaitIndex),
  }));
  for (const direction of [1, -1]) {
    playback.speedMultiplier = direction;
    for (let beat = 0; beat <= 8; beat += 0.125) {
      musicBeat = drillBeat = beat;
      state.counts = authored;
      state.stepCache = undefined; state.gaitPhaseCache = undefined;
      pose();
      const expected = transformSnapshot();
      state.counts = baked;
      state.stepCache = undefined; state.gaitPhaseCache = undefined;
      pose();
      assert.equal(transformSnapshot(), expected,
        `Named baked steps preserve limb/root transforms: facing=${facing}, direction=${direction}, beat=${beat}`);
    }
  }
}
state.counts = Array.from({ length: 9 }, (_, count) => ({
  position: new Vector3(0, 0, count * 0.25), rotationY: 0, facingY: 0,
}));
parts.gaitIndex = gaitIndex('Field March');
const phaseOffsets = context.getGaitStepPhaseOffsets(state, parts.gaitIndex);
state.counts = state.counts.map((count, index) => ({
  ...count, stepPhase: phaseOffsets[index] + 1.25,
  bakedGait: context.resolveSegmentGait(state, index, parts.gaitIndex),
}));
state.stepCache = undefined; state.gaitPhaseCache = undefined;
musicBeat = drillBeat = 3.375;
pose();
const savedPhasePose = transformSnapshot();
context.repeatOptions = { songLength: 1000, drill: false };
musicBeat = 70.125;
state.stepCache = undefined; state.gaitPhaseCache = undefined;
pose();
assert.equal(transformSnapshot(), savedPhasePose,
  'Saved fractional phase and foot parity do not change with the music clock');
Object.assign(context, { Float64Array, Uint8Array, DataView, TextEncoder, TextDecoder,
  Blob, Response, CompressionStream, DecompressionStream });
run(readFileSync(new URL('../src/robot/openChartFormat.ts', import.meta.url), 'utf8'));
run(readFileSync(new URL('../src/robot/openChartPerformance.ts', import.meta.url), 'utf8'));
const sampledContacts = context.getRobotFootprintSource(robot).build();
assert.ok(sampledContacts.length > 0 && sampledContacts.some(contact => !Number.isInteger(contact.beat)),
  'Footfall events include sub-count contacts');
const savedPerformance = context.packOpenChartPerformance({
  counts: state.counts, gaitIndex: parts.gaitIndex,
  instrumentRestPose: false, color: { r: 0.2, g: 0.4, b: 0.6 }, stepSizeYards: 0.625,
}, vm.runInContext('MARCHING_GAITS.map(gait => gait.name)', context));
const savedShow = {
  name: 'Footfalls', tempoBpm: 120, widthYards: 53.333,
  pages: [{ name: 'Opening', count: 0, notes: '' }],
  marchers: [{ label: 'T1', name: '', section: 'Trumpet', notes: '', instrument: 'trumpet',
    positions: Float64Array.from(state.counts.flatMap(count => [count.position.x, count.position.z])),
    performance: savedPerformance }],
};
const restoredSchedule = context.unpackOpenChartPerformance(
  (await context.decodeOpenChart(await context.encodeOpenChart(savedShow))).marchers[0].performance,
  vm.runInContext('MARCHING_GAITS.map(gait => gait.name)', context));
assert.equal('footfalls' in savedPerformance, false);
assert.equal('footfalls' in restoredSchedule, false);
state.counts = restoredSchedule.counts.map(({ height, ...count }, index) => ({
  ...count, position: new Vector3(savedShow.marchers[0].positions[index * 2], height,
    savedShow.marchers[0].positions[index * 2 + 1]),
}));
musicBeat = 200;
const loadedContacts = context.getRobotFootprintSource(robot).build();
assert.equal(JSON.stringify(loadedContacts), JSON.stringify(sampledContacts),
  'Footprint display regenerates identical contacts from restored schedules, independent of the music clock');
console.log(`Footprint regeneration passed: ${sampledContacts.length} exact contacts from restored schedules without serialized footprints.`);
console.log('Named baked gait playback matches inferred limb/root poses: forward, sideways, backward, explicit mark-time, reverse and final halt.');
console.log('MIDI footfall position checks passed: all cadences, left/right phase, pause/resume, drill/song loops, reverse, and fractional drill position.');
