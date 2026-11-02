// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const compile = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const context = vm.createContext({ FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120, END_ZONE_DEPTH_YARDS: 10 });
vm.runInContext(compile('../src/robot/footballPlayGeometry.ts'), context);
vm.runInContext(compile('../src/robot/scrimmageGeometry.ts'), context);
for (let index = 0; index < 40; index++) {
  const start = new Vector3(index - 20, -.48, 64);
  const target = new Vector3((index % 8 - 4) * 3, -.48, (Math.floor(index / 8) - 2) * 4);
  const route = context.scrimmageWalk(start, target, 48);
  assert.equal(route[0].x, start.x);
  assert.equal(route[0].z, start.z);
  assert.equal(route[48].x, target.x, 'Babylon-vector destinations retain each marcher formation X');
  assert.equal(route[48].z, target.z, 'Babylon-vector destinations retain each marcher formation Z');
  assert.ok(route.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)));
}
for (const formation of ['shotgun', 'spread', 'i-form']) {
  const geometry = context.generateFootballPlay(formation, 'slants');
  geometry.players.forEach((player, index) => {
    const path = context.scrimmagePlayerRoute(player.positions, index);
    assert.equal(path.length, 163, 'Concurrent exit/entry, play and returns share one timeline');
    for (let count = 0; count <= 2; count++) {
      assert.ok(Math.abs(path[count].x) > 53.333 / 2, 'Players stand at their sideline bench');
      assert.deepEqual(path[count], path[0], 'Players stand before leaving their bench');
    }
    assert.notDeepEqual(path[3], path[0], 'Players enter while band exit is still underway');
    assert.equal(path[0].x, context.scrimmageBenchSeat(index).x);
    assert.equal(path[0].z, context.scrimmageBenchSeat(index).z);
    assert.deepEqual(path[48], player.positions[0], 'Players reach formation when band exit finishes, before the snap');
    assert.deepEqual(path[64], player.positions[16], 'The entire football play is preserved');
    assert.deepEqual(path[112], path[0], 'Players return to their own original bench seats');
    assert.ok(path.slice(112).every(point => point.x === path[0].x && point.z === path[0].z),
      'Players stay at the bench while the band returns');
    for (let count = 65; count <= 112; count++) {
      assert.ok(Math.hypot(path[count].x - path[count - 1].x, path[count].z - path[count - 1].z) < 1.5,
        'Return to benches is continuous');
    }
    for (let count = 1; count <= 48; count++) {
      assert.ok(Math.hypot(path[count].x - path[count - 1].x, path[count].z - path[count - 1].z) < 1.25,
        'Entry is continuous, without teleporting');
    }
  });
}
for (const start of [{ x: -15, z: -20 }, { x: 12, z: 5 }, { x: 0, z: 0 },
  { x: 8, z: 59 }, { x: -8, z: -59 }, { x: 3, z: 70 }, { x: -3, z: -70 }]) {
  const end = context.scrimmageBandExitPosition(start, 3);
  const exit = context.scrimmageWalk(start, end, 48);
  assert.equal(exit.length, 49);
  assert.equal(end.x, start.x, 'Band exits through the end zone without sideline travel');
  assert.ok(Math.abs(end.z) >= 62.5, 'Band finishes completely beyond the end zone and end line');
  assert.ok(Math.abs(end.z) >= Math.abs(start.z), 'Already off-field marchers never move back onto the field');
  assert.equal(Math.sign(end.z), start.z < 0 ? -1 : 1, 'Band uses the nearest end zone');
  assert.ok(exit.every(point => Math.abs(point.z) >= Math.abs(start.z)),
    'Marchers already in an end zone do not walk back toward midfield');
  assert.equal(exit[0].x, start.x);
  assert.equal(exit[0].z, start.z);
  assert.deepEqual(exit.at(-1), end);
  const route = context.scrimmageBandRoute(start, 3, 16);
  assert.equal(route.length, 163);
  assert.equal(route.at(-1).x, start.x, 'Band returns exactly to its starting formation X');
  assert.equal(route.at(-1).z, start.z, 'Band returns exactly to its starting formation Z');
  assert.ok(route.slice(48, 115).every(point => point.x === end.x && point.z === end.z),
    'Band waits off-field until football players have arrived and sat down');
  assert.deepEqual(route[115], context.scrimmageWalk(end, start, 48)[1],
    'Band re-entry begins after bench seating, without teleporting');
}
assert.equal(context.scrimmageSeatedBlend(0, Infinity), 1, 'Waiting players stay seated independently of the band timeline');
assert.equal(context.scrimmageSeatedBlend(0, 48), 1);
assert.equal(context.scrimmageSeatedBlend(1, 48), .5, 'Stand-up is interpolated over two counts');
assert.equal(context.scrimmageSeatedBlend(2, 48), 0);
assert.equal(context.scrimmageSeatedBlend(0, 0), 0, 'Direct-loaded football plays start standing');
assert.equal(context.scrimmageSeatedBlend(112, 48, 64), 0);
assert.equal(context.scrimmageSeatedBlend(113, 48, 64), .5);
assert.equal(context.scrimmageSeatedBlend(114, 48, 64), 1);
assert.equal(context.scrimmageSeatedBlend(162, 48, 64), 1, 'Teams remain seated during band return');
for (const [index, start] of [[0, { x: -4, z: -12 }], [21, { x: 9, z: 3 }]]) {
  const path = context.scrimmagePlayerReturn(start, index);
  assert.equal(path.length, 99, 'Immediate ending uses a 98-count return handover');
  assert.equal(path[0].x, start.x);
  assert.equal(path[0].z, start.z);
  assert.deepEqual(path[48], context.scrimmageBenchSeat(index));
  assert.ok(path.slice(48).every(point => point.x === path[48].x && point.z === path[48].z));
  const immediate = context.scrimmagePlayerReturn(start, index, false);
  assert.equal(immediate.length, 51, 'Simultaneous ending lasts 48 walking counts plus two seating counts');
  assert.deepEqual(immediate[48], context.scrimmageBenchSeat(index));
}
assert.equal(new Set(Array.from({ length: 22 }, (_, index) => JSON.stringify(context.scrimmageBenchSeat(index)))).size,
  22, 'Players have distinct, evenly spaced bench seats');
assert.ok(Math.abs(context.scrimmageBenchSeat(0).x) + .55 / 2 < 53.333 / 2 + 4,
  'Bench remains in the sideline aisle ahead of the bleachers, not inside the audience');
const interactionSource = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
const resumeSource = interactionSource.slice(interactionSource.indexOf('function resumeBandAfterScrimmage('),
  interactionSource.indexOf('function clearWaitingFootballPlayers('));
const afterRender = new Observable();
let transport = { beat: 0, lastBeat: 458, playing: true, beatsPerSecond: 2, revision: 1 };
let restored = 0, played = 0, sought = [], messages = [], errors = [], restoreFails = false;
let now = 0;
const original = { playback: { beat: 12, lastBeat: 80 }, name: 'Original band' };
const resumeContext = vm.createContext({
  Error,
  performance: { now: () => now },
  scene: { onAfterRenderObservable: afterRender }, disposeScrimmageResume: null,
  getDrillTransportState: () => ({ ...transport }), floorCalibrationToggle: { checked: false },
  marcherGrabs: new Map(), isFloatingPanelGrabbed: () => false, canUseCameraFieldCopies: () => true,
  restoreCameraFieldState: state => {
    assert.equal(state, original, 'Restore uses the complete captured original show');
    if (restoreFails) throw new Error('Restore failed');
    restored++;
    transport = { ...transport, ...state.playback, playing: false, revision: transport.revision + 1 };
  },
  seekToCount: count => { sought.push(count); transport.beat = count; },
  playAll: () => { played++; transport.playing = true; },
  pauseAll: () => { transport.playing = false; },
  publishFormationEdit: message => messages.push(message), console: { error: (...args) => errors.push(args) },
});
vm.runInContext(compile('../src/robot/scrimmagePlayback.ts'), resumeContext);
vm.runInContext(stripTypeScriptTypes(resumeSource, { mode: 'transform' }), resumeContext);
const render = () => afterRender.notifyObservers(null);
resumeContext.resumeBandAfterScrimmage(original);
render(); assert.equal(restored, 0, 'Playing football does not restore the band early');
transport = { ...transport, beat: 458, playing: false };
render();
assert.equal(restored, 1, 'Natural completion restores the band even when transport has just stopped');
assert.equal(played, 0, 'Restored original drill remains paused initially');
assert.equal(transport.beat, 12, 'Resume at the captured formation/count without rewinding');
render(); assert.equal(restored, 1, 'Completion observer unregisters before restoring');
now = 2999; render();
assert.equal(played, 0, 'Band does not restart before three seconds');
assert.equal(transport.playing, false);
assert.equal(transport.beat, 12, 'Band stays at its formation during the pause');
now = 3000; render();
assert.equal(played, 1, 'Band restarts automatically at three seconds');
for (const lastBeat of [50, 458]) {
  transport = { beat: lastBeat - 1, lastBeat, playing: true, beatsPerSecond: 2, revision: 2 };
  resumeContext.resumeBandAfterScrimmage(original);
  render();
  resumeContext.floorCalibrationToggle.checked = true;
  transport = { ...transport, beat: lastBeat, playing: false };
  render(); assert.equal(restored, lastBeat === 50 ? 1 : 2, 'Calibration defers automatic restoration');
  resumeContext.floorCalibrationToggle.checked = false;
  render();
  const playsBefore = played;
  assert.equal(transport.playing, false, 'Both return flows pause before restarting');
  now += 3000; render();
  assert.equal(played, playsBefore + 1, 'Both return flows restart after the pause');
}
assert.equal(restored, 3, 'Natural and button-triggered simultaneous returns both resume the band');
for (const mode of ['paused seek', 'reverse', 'replacement']) {
  transport = { beat: 40, lastBeat: 50, playing: true, beatsPerSecond: 2, revision: 3 };
  resumeContext.resumeBandAfterScrimmage(original);
  render();
  if (mode === 'replacement') {
    resumeContext.disposeScrimmageResume();
    resumeContext.disposeScrimmageResume = null;
  }
  transport = { ...transport, beat: 50, playing: mode === 'reverse', beatsPerSecond: -2, revision: 4 };
  render(); assert.equal(restored, 3, `${mode} does not trigger automatic playback`);
  resumeContext.disposeScrimmageResume?.();
  resumeContext.disposeScrimmageResume = null;
}
original.playback.beat = 80;
transport = { beat: 50, lastBeat: 50, playing: true, beatsPerSecond: 2, revision: 5 };
resumeContext.resumeBandAfterScrimmage(original); render();
assert.deepEqual(sought, [0], 'An already completed original drill restarts at count zero');
transport = { ...transport, revision: transport.revision + 1, beat: 4 };
now += 3000; render();
assert.equal(played, 3, 'Manual timeline edits cancel the pending restart');
transport = { beat: 50, lastBeat: 50, playing: true, beatsPerSecond: 2, revision: 5 };
resumeContext.resumeBandAfterScrimmage(original); render();
resumeContext.disposeScrimmageResume();
resumeContext.disposeScrimmageResume = null;
now += 3000; render();
assert.equal(played, 3, 'Show replacement cancels the pause timer');
restoreFails = true;
transport = { beat: 50, lastBeat: 50, playing: true, beatsPerSecond: 2, revision: 6 };
resumeContext.resumeBandAfterScrimmage(original); render();
assert.equal(errors.length, 1, 'Restore failures are logged explicitly');
assert.equal(messages.at(-1), 'Restore failed', 'Restore failures are surfaced to the user');
assert.equal(transport.playing, false, 'Restore failure stops playback');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(afterRender.observers.length, 0, 'Observers are cleaned up on success, replacement and failure');
assert.match(interactionSource, /resumeBandAfterScrimmage\(previous\);\s+playAll\(\)/,
  'Only staged scrimmages register automatic band playback');
assert.match(interactionSource, /function clearAllRobots\(\) \{\s+setFootballAudioMode\(false\);\s+disposeScrimmageResume\?\.\(\)/,
  'Show replacement removes the automatic restoration callback');
console.log('Scrimmage passed: benches, band exit/return routes, original drill auto-resume, pause/reverse/replacement gating and cleanup.');
