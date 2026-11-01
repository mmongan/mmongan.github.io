// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const context = vm.createContext({
  globalPlayback: { playing: false, speedMultiplier: 1, countIndex: 0, stepAccumulatorSeconds: 0 },
  prebakingLegAnimation: false, transportRevision: 0, repeatElapsed: null,
  notifyDrillTransport() {}, applyGlobalCountToAllRobots() {}, setDrillBeatPosition() {},
  getMaxCountIndex: () => 16, clampToBlankChartPageSpan: beat => beat,
});
vm.runInContext(stripTypeScriptTypes(source.slice(source.indexOf('let playbackStartGuard:'),
  source.indexOf('export function getMarchTempo(')) +
  source.slice(source.indexOf('export function rewindAll('), source.indexOf('// Nudges the shared clock')),
{ mode: 'transform' }).replace(/export /g, ''), context);
let ready = false, requests = 0;
context.setPlaybackStartGuard(() => { requests++; return ready; });
context.playAll();
assert.equal(context.globalPlayback.playing, false, 'Play waits without advancing the opening while samples/audio are unavailable');
assert.equal(context.globalPlayback.countIndex, 0);
context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, false);
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, true, 'Ready samples/browser audio release only an explicit pending Play');
context.pauseAll();
ready = false; context.playAll(); context.toggleAllPlayback();
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, false, 'Second Play/Pause cancels a pending start');
ready = false; context.fastForwardAll();
assert.equal(context.globalPlayback.playing, false);
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.speedMultiplier, 2, 'Pending fast-forward retains its selected speed');
assert.equal(context.globalPlayback.playing, true);
context.pauseAll();
ready = false; context.playAll(); context.seekToCount(0);
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, false, 'Seek cancels pending playback');
ready = false; context.rewindAll();
assert.equal(context.globalPlayback.playing, true, 'Muted rewind does not wait for audio');
context.pauseAll(); context.setPlaybackStartGuard(null); context.playAll();
assert.equal(context.globalPlayback.playing, true, 'No audio guard preserves ordinary drill playback');
assert.ok(requests >= 4);
console.log('MIDI startup passed: explicit Play waits at the opening, readiness releases the request, pause/seek cancel, fast-forward preserves speed, rewind remains muted, and no guard preserves legacy playback.');
