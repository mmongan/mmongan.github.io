// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const read = name => readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
const context = vm.createContext({ Quaternion, Vector3, console });
const run = source => vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
run(read('robot/footballAnimationCache'));
const Cache = vm.runInContext('FootballAnimationCache', context);
let samples = 0;
const cache = new Cache(2, 3, beat => { samples++; return [beat, Math.sin(beat), 1]; }, [.35, .8]);
assert.equal(cache.frameAt(0), null, 'Incomplete caches never expose a live fallback or partial frame');
cache.advance(1);
assert.equal(cache.frameAt(0), null);
while (!cache.ready) cache.advance();
const preparedSamples = samples;
for (let beat = 0; beat <= 2; beat += .00073) {
  const frame = cache.frameAt(beat), time = cache.sampledBeat(beat);
  assert.equal(frame[0], time);
  assert.ok(time <= beat && beat - time < 1 / 32 + 1e-12, 'Explicit maximum temporal error is 1/32 count');
}
assert.equal(cache.frameAt(.35)[0], .35, 'Throw release/event knots are retained exactly');
assert.equal(cache.frameAt(.8)[0], .8);
assert.equal(cache.frameAt(2)[0], 2, 'The final count is a prepared pose, not extrapolation');
assert.equal(cache.frameAt(-1)[0], 0);
assert.equal(cache.frameAt(NaN), null);
assert.equal(samples, preparedSamples, 'Playback and reverse/scrub never invoke a solver');
cache.dispose(); cache.dispose();
assert.equal(cache.frameAt(0), null);
assert.throws(() => new Cache(Infinity, 1, () => [0]), /whole-count/);
assert.throws(() => new Cache(1e8, 100, () => Array(100).fill(0)), /limit/);
const invalid = new Cache(1, 1, () => [NaN]);
assert.throws(() => invalid.advance(), /invalid pose at count 0/);
invalid.dispose();

const node = () => ({ position: Vector3.Zero(), rotation: Vector3.Zero() });
const robot = node();
const parts = { gaitIndex: 0, instrumentRestPose: false, body: node(), instrumentRoot: node(), legRoot: node(),
  leftLeg: node(), rightLeg: node(), leftKnee: node(), rightKnee: node(), leftAnkle: node(), rightAnkle: node(),
  leftThigh: node(), rightThigh: node(), leftShoe: node(), rightShoe: node() };
const state = { footballMotion: { team: 'offense', role: 'WR', playStart: 0 },
  points: [], stepSizeYards: .625,
  counts: Array.from({ length: 12 }, (_, count) => ({ position: new Vector3(0, -.48, count * .2), rotationY: 0 })) };
let beat = 2.5, solves = 0;
Object.assign(context, {
  heldRobots: new Set(), marcherParts: new Map([[robot, parts]]), players: new Map([[robot, state]]),
  globalPlayback: { playing: false, speedMultiplier: 1 }, ghostBandPreview: null,
  limitedStrideCounts: new WeakMap(), onMarcherStrideLimited: { notifyObservers() {} },
  playbackTempoMap: null, repeatOptions: { songLength: 0, drill: false }, playbackBeatUnits: [],
  playbackPpq: 480, playbackCountTicks: [], transportRevision: 0,
  getDrillTransportState: () => ({ beat }), getMusicTransportState: () => ({ beat: 0 }),
  resolveSegmentGait: (_state, segment) => segment < 0 || segment >= 11 ? null : ({
    gaitIndex: 0, stepsPerCount: 1, bodyYaw: 0, legYawOffset: 0, inPlace: false, sideways: false,
  }),
  getGaitStepPhaseOffsets: () => Array.from({ length: 12 }, (_, count) => count),
  orientMarcherShoes() {}, attachMarcherThigh() {}, alignMarcherKnee() {}, applyInstrumentPose() {},
  MARCHER_BODY_SCALE: 1.8 / .9144 / 1.372, MARCHER_BUILD_SCALE: .64,
  getFootballPlaybackPosition() { throw new Error('A live clearance sampler must not run for prepared playback.'); },
});
for (const name of ['robot/gaitSelection', 'audio/drillMidiTiming', 'audio/midiBeatPulse',
  'robot/marcherLegPose', 'robot/marcherFootTargets', 'robot/bakedLegAnimation']) run(read(name));
const source = read('robot/robot');
run(source.slice(source.indexOf('export const MARCHING_GAITS ='), source.indexOf('let selectedMarchingGait')));
run(source.slice(source.indexOf('function wrapAngle(angle:'), source.indexOf('function applyGlobalCountToAllRobots')));
vm.runInContext('sharedStepCyclesEnabled = false', context);
const solver = context.solvePlantedMarcherLeg;
context.solvePlantedMarcherLeg = (...args) => { solves++; return solver(...args); };
const snapshot = () => JSON.stringify([robot, parts, state]);
const before = snapshot();
const sampler = context.createRobotAnimationSampler(robot);
const frames = [0, .25, 2.5, 5.75, 11].map(sampler);
assert.equal(snapshot(), before, 'Full route/leg sampling never mutates scene transforms, transport or live caches');
assert.ok(solves > 0 && frames.every(frame => frame.pose.legs.length === 2));
assert.deepEqual(frames.at(-1).pose.legs[0].legRotation.asArray(), [0, 0, 0, 1], 'Halt has a complete neutral pose');
const expected = frames[2];
context.setRobotPreparedAnimation(robot, () => expected);
solves = 0;
context.applyGlobalCount(robot, state);
assert.equal(solves, 0, 'Prepared shared-transport playback does not solve IK');
assert.ok(Vector3.Distance(robot.position, expected.position) < 1e-12);
for (const direction of [-1, 1]) {
  context.globalPlayback.speedMultiplier = direction;
  context.applyGlobalCount(robot, state);
  assert.ok(Math.abs(Quaternion.Dot(parts.leftLeg.rotationQuaternion, expected.pose.legs[0].legRotation)) > 1 - 1e-12);
}
context.setRobotPreparedAnimation(robot, () => null);
const frozen = robot.position.clone(); beat = 8;
context.applyGlobalCount(robot, state);
assert.ok(Vector3.Distance(robot.position, frozen) < 1e-12, 'Rebuilding freezes prepared players; no silent live fallback');
context.setRobotPreparedAnimation(robot, null);
assert.equal(parts.leftLeg.rotationQuaternion, null, 'Exit restores the original Euler-based leg solver');

let notifications = 0;
Object.assign(context, { notifyDrillTransport() { notifications++; } });
run(source.slice(source.indexOf('let playbackStartGuard:'), source.indexOf('export function isAnyPlaying')));
run(source.slice(source.indexOf('export function rewindAll()'), source.indexOf('export function fastForwardAll')));
let ready = false, audioReady = false;
const release = context.addPlaybackPreparationGuard(() => ready);
context.setPlaybackStartGuard(() => audioReady);
context.playAll();
assert.equal(context.globalPlayback.playing, false);
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, false, 'Animation preparation does not bypass MIDI readiness');
audioReady = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, true);
context.pauseAll(); ready = false; context.rewindAll();
assert.equal(context.globalPlayback.playing, false, 'Reverse also waits for complete preparation');
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.speedMultiplier, -2, 'Deferred reverse retains its direction');
context.pauseAll(); ready = false; context.playAll(); context.pauseAll();
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, false, 'Pause cancels a pending preparation restart');
release();
assert.ok(notifications > 0);
console.log('Football animation cache passed: full preparation, exact event knots, bounded sample-and-hold, isolated real IK, cached forward/reverse, errors, cancellation and composable MIDI guard.');
