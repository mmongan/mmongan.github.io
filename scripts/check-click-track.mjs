// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const context = vm.createContext({});
const load = (path) => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/import[^;]*;/g, '').replace(/export /g, '');
vm.runInContext(`${load('../src/audio/midiTimeline.ts')}\n${load('../src/audio/clickTrack.ts')}
globalThis.ClickTrack = ClickTrack;
globalThis.buildClickNotes = buildClickNotes;`, context);

const notes = context.buildClickNotes(32.5);
assert.equal(notes.length, 33, 'One click per count up to the last count before the drill end');
assert.ok(notes.every((note, beat) => note.beat === beat && note.percussion && note.duration > 0));
assert.ok(notes.every(note => note.velocity === (note.beat % 4 === 0 ? 1 : 0.7)),
  'Every fourth count is accented');

const clicks = [];
const audioContext = {
  currentTime: 10,
  createOscillator() {
    const osc = { type: '', frequency: { setValueAtTime(value, time) { osc.hz = value; osc.at = time; } },
      connect() {}, disconnect() {}, start(time) { osc.started = time; }, stop(time) { osc.stopped = time; } };
    clicks.push(osc);
    return osc;
  },
  createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() {}, disconnect() {} }),
};
const destination = {};
const track = new context.ClickTrack(audioContext, destination);
const state = { beat: 0, beatsPerSecond: 2, playing: true, lastBeat: 8, revision: 1 };

track.synchronize(state, 10);
assert.equal(clicks.length, 1, 'Only counts inside the lookahead window are scheduled');
assert.equal(clicks[0].hz, 2093, 'Count 0 is accented');
assert.ok(Math.abs(clicks[0].started - 10.03) < 1e-9, 'Click is scheduled with the standard lead');

track.tick(10.4); // extrapolates to beat 0.8; count 1 enters the lookahead window
assert.equal(clicks.length, 2);
assert.equal(clicks[1].hz, 1568, 'Off counts use the unaccented click');
assert.ok(Math.abs(clicks[1].started - 10.53) < 1e-9, 'Click lands exactly on the extrapolated count');

track.tick(10.4);
assert.equal(clicks.length, 2, 'Repeated ticks never duplicate clicks');

// Pausing stops scheduling; seeking re-anchors without duplicates.
track.synchronize({ ...state, playing: false, beat: 1 }, 11);
assert.equal(clicks.length, 2, 'No clicks while paused');

// Drill length changes rebuild the click timeline and keep scheduling.
track.synchronize({ ...state, beat: 14.9, lastBeat: 16, revision: 2 }, 20);
assert.equal(clicks.at(-1).hz, 1568, 'Count 15 of the longer drill is scheduled after rebuild');
assert.ok(Math.abs(clicks.at(-1).started - 20.08) < 1e-9, 'Rebuilt clicks stay aligned to the transport clock');
assert.ok(clicks.length > 2);

// Clicks never start in the past even if scheduling runs late.
const late = clicks.length;
track.synchronize({ ...state, beat: 4.001, lastBeat: 16, revision: 3 }, 30);
assert.ok(clicks.length === late || clicks.slice(late).every(click => click.started >= 30),
  'Late-scheduled clicks clamp to the current audio time');

console.log('Click track checks passed: per-count notes with accents, lookahead scheduling, no duplicates, pause, drill-length rebuild, and past-time clamping.');
