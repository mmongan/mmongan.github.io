import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
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
  limitedStrideCounts: new WeakMap(), onMarcherStrideLimited: { notifyObservers(message) { warnings.push(message); } },
  playbackTempoMap: [{ beat: 0, bpm: 120 }],
  repeatOptions: { songLength: 32 },
  playbackBeatUnits: [],
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
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, ''), context);
run(gaitSource);
run(readFileSync(new URL('../src/audio/midiBeatPulse.ts', import.meta.url), 'utf8'));
run(readFileSync(new URL('../src/robot/marcherLegPose.ts', import.meta.url), 'utf8'));
const { calfLength, shoeForwardOffset, shoeHalfHeight } = vm.runInContext(
  '({ calfLength: MARCHER_CALF_LENGTH, shoeForwardOffset: MARCHER_SHOE_FORWARD_OFFSET, shoeHalfHeight: MARCHER_SHOE_HALF_HEIGHT })', context);
run(readFileSync(new URL('../src/robot/marcherFootTargets.ts', import.meta.url), 'utf8'));
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
const pose = () => {
  context.applyGlobalCount(robot, state);
  return [parts.leftKnee.rotation.x, parts.rightKnee.rotation.x, ...robot.position.asArray()];
};

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
  center.y -= context.marcherShoeGroundDepth(Math.atan2(-footForward.y, footUp.y));
  center.scaleInPlace(bodyScale);
  center.y += parts.body.position.y;
  return Vector3.TransformCoordinates(center, Matrix.RotationY(robot.rotation.y)).add(robot.position);
};
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
    const pitches = sampleSwingPitches();
    const maxAcceleration = peakAngularAcceleration(pitches);
    assert.ok(maxAcceleration < 15,
      `Swing ankle eases without springing flat or toe-up: stride=${stride}, yaw=${direction}, acceleration=${maxAcceleration}`);
    assert.ok(Math.abs(pitches[1000]) < 1e-6, 'Swing foot passes level without an extra toe flick');
    const maxContactPitch = Math.max(Math.abs(pitches[0]), Math.abs(pitches.at(-1)));
    assert.ok(pitches.every(pitch => Math.abs(pitch) <= maxContactPitch + 1e-6),
      'Swing never over-rotates beyond its takeoff or landing contact pitch');
    const easedSolver = context.solvePlantedMarcherLeg;
    let reachOnlyAcceleration;
    context.solvePlantedMarcherLeg = (hip, sole, yaw) => easedSolver(hip, sole, yaw);
    try {
      reachOnlyAcceleration = peakAngularAcceleration(sampleSwingPitches());
    } finally {
      context.solvePlantedMarcherLeg = easedSolver;
    }
    assert.ok(maxAcceleration < reachOnlyAcceleration / 4,
      'Eased swing removes at least three quarters of the reach-only toe spring acceleration');
    console.log(`Swing ankle stride=${stride}, yaw=${direction}: peak angular acceleration ${reachOnlyAcceleration.toFixed(1)} -> ${maxAcceleration.toFixed(1)} radians/pulse²`);
  }
}
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
        pose();
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
const SQL = await initSqlJs();
const example = context.readOpenMarchDatabase(SQL,
  readFileSync(new URL('../src/assets/openmarch/example-show.dots', import.meta.url)), 53.333);
const exampleWarnings = [];
context.onMarcherStrideLimited.notifyObservers = message => exampleWarnings.push(
  `${message} beat=${drillBeat}, gait=${context.resolveSegmentGait(state, Math.floor(drillBeat), 0)?.label}`);
context.repeatOptions = { songLength: 10000, drill: false };
context.playbackBeatUnits = [{ beat: 0, quarterNotesPerPulse: 1.5 }];
playback.speedMultiplier = 1;
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
console.log('MIDI footfall position checks passed: all cadences, left/right phase, pause/resume, drill/song loops, reverse, and fractional drill position.');
