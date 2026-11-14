// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Loading music with a different pulse structure must invalidate baked
// footfall phases and cadences (stepPhase/bakedGait): they encode the pulses
// of the music the show was baked with, and keeping them leaves the band
// marching to the old music's step clock instead of the new beat. Identical
// structures and the startup example load preserve the baked performance.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
let invalidated = 0, notified = 0;
const makeState = () => ({
  counts: Array.from({ length: 8 }, (_, index) => ({
    position: { x: 0, y: 0, z: index }, rotationY: 0,
    stepPhase: index * 1.5,
    bakedGait: { gaitIndex: 0, stepsPerCount: 2 / 3, bodyYaw: 0, legYawOffset: 0,
      inPlace: false, sideways: false, label: 'Baked' },
  })),
  gaitPhaseCache: new Map([[0, { counts: [], offsets: [] }]]),
  stepCache: { counts: [], key: 'cached' },
});
const players = new Map([['a', makeState()], ['b', makeState()]]);
const context = vm.createContext({
  Map, players,
  playbackBeatUnits: [],
  invalidateLegBake: () => { invalidated++; },
  notifyDrillTransport: () => { notified++; },
});
const run = text => vm.runInContext(stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
run(slice('function clearBakedCountGaits(', 'function getGaitStepPhaseOffsets('));
run(slice('function setPlaybackBeatUnits(', 'export function setPlaybackRepeat('));

const setUnits = (units, preserve) => vm.runInContext(
  `setPlaybackBeatUnits(${JSON.stringify(units)}${preserve === undefined ? '' : `, ${preserve}`})`, context);
const baked = () => [...players.values()].every(state =>
  state.counts.every(count => count.stepPhase !== undefined && count.bakedGait !== undefined));
const cleared = () => [...players.values()].every(state =>
  state.counts.every(count => count.stepPhase === undefined && count.bakedGait === undefined) &&
  state.gaitPhaseCache.size === 0 && state.stepCache === undefined);
const rebake = () => { players.clear(); players.set('a', makeState()); players.set('b', makeState()); };

// The automatic startup example load keeps the demo show's baked performance
// even though the pulse structure changes from "no music".
setUnits([{ beat: 0, quarterNotesPerPulse: 1.5 }], true);
assert.ok(baked(), 'Startup example music preserves the baked step clock');
assert.ok(invalidated === 2 && notified === 1, 'Leg bakes still refresh and the transport is notified');

// Loading music with the identical pulse structure keeps intentional phases.
setUnits([{ beat: 0, quarterNotesPerPulse: 1.5 }]);
assert.ok(baked(), 'Identical pulse structures preserve authored baked phases');

// A different pulse structure re-derives the step clock from the new music.
setUnits([{ beat: 0, quarterNotesPerPulse: 1 }]);
assert.ok(cleared(), 'A new meter clears baked phases, cadences, and gait caches for every marcher');

rebake();
// Clearing the music (click track) also resynchronizes.
setUnits([]);
assert.ok(cleared(), 'Removing music clears baked phases so footfalls follow the click track');

rebake();
vm.runInContext('playbackBeatUnits = [{ beat: 0, quarterNotesPerPulse: 1 }, { beat: 8, quarterNotesPerPulse: 1.5 }]', context);
// A moved meter-change boundary alone is a different structure.
setUnits([{ beat: 0, quarterNotesPerPulse: 1 }, { beat: 12, quarterNotesPerPulse: 1.5 }]);
assert.ok(cleared(), 'A moved meter boundary also re-derives the step clock');

console.log('Music gait resync checks passed: startup preservation, identical-structure preservation, ' +
  'and baked phase/cadence/cache invalidation on meter changes, music removal, and moved boundaries.');
