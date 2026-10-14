import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const robotSource = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const gaitSource = readFileSync(new URL('../src/robot/gaitSelection.ts', import.meta.url), 'utf8');
const node = () => ({ position: Vector3.Zero(), rotation: Vector3.Zero() });
const parts = {
  gaitIndex: 0, instrumentRestPose: false, body: node(),
  leftLeg: node(), rightLeg: node(), leftKnee: node(), rightKnee: node(),
  leftAnkle: node(), rightAnkle: node(), leftThigh: node(), rightThigh: node(),
  leftShoe: node(), rightShoe: node(),
};
const robot = node();
const state = {
  counts: Array.from({ length: 12 }, (_, i) => ({ position: new Vector3(0, 0, i * 0.625), rotationY: 0 })),
};
let drillBeat = 1.25;
let musicBeat = 4.25;
let cadence = 1;
const playback = { playing: true, speedMultiplier: 1, countIndex: 1, stepAccumulatorSeconds: 0 };
const context = vm.createContext({
  Vector3, Math, Number, Map, Set,
  heldRobots: new Set(), marcherParts: new Map([[robot, parts]]), globalPlayback: playback,
  playbackTempoMap: [{ beat: 0, bpm: 120 }],
  repeatOptions: { songLength: 32 },
  getDrillTransportState: () => ({ beat: drillBeat }),
  getMusicTransportState: () => ({ beat: musicBeat }),
  resolveSegmentGait: () => ({
    gaitIndex: 0, stepsPerCount: cadence, bodyYaw: 0, legYawOffset: 0, inPlace: false, sideways: false,
  }),
  getGaitStepPhaseOffsets: () => Array(12).fill(0),
  orientMarcherShoes() {}, attachMarcherThigh() {}, applyInstrumentPose() {},
  MARCHER_BODY_SCALE: 1, MARCHER_BUILD_SCALE: 1, MAX_KNEE_BEND_RADIANS: 1.35,
});
const run = source => vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, ''), context);
run(gaitSource);
run(robotSource.slice(robotSource.indexOf('export const MARCHING_GAITS ='),
  robotSource.indexOf('let selectedMarchingGait')));
run(robotSource.slice(robotSource.indexOf('const MARCHING_GAIT_POSES ='),
  robotSource.indexOf('// A single shared transport')));
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
musicBeat = 5.25;
drillBeat = 1.25;
const beforeLoop = pose();
drillBeat = 0.25;
assert.deepEqual(pose().slice(0, 2), beforeLoop.slice(0, 2), 'Drill loop does not reset continuous MIDI phase');
musicBeat = 0.25;
assert.ok(pose()[0] < pose()[1], 'Song loop resets feet to the MIDI opening beat');
context.playbackTempoMap = null;
assert.ok(pose()[0] < pose()[1], 'Manual tempo override still follows the loaded MIDI beat position');
playback.speedMultiplier = -2;
assert.ok(pose()[0] < pose()[1], 'Reverse playback uses the same pose at the same MIDI position');
assert.equal(robot.position.z, 0.15625, 'Drill interpolation follows the shared fractional beat');
console.log('MIDI footfall position checks passed: all cadences, left/right phase, pause/resume, drill/song loops, reverse, and fractional drill position.');
