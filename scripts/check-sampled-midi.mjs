// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { getSoundfontNames } from 'smplr';
import { instrumentByPatchID } from '@tonejs/midi/dist/InstrumentMaps.js';

const instruments = [];
const fetched = [];
let fail = false;
let defer = false;
let failConstruction = false;
const releases = [];
const context = vm.createContext({
  Soundfont: (_, options) => {
    if (failConstruction && /alto_sax/.test(options.instrumentUrl)) throw new Error('instrument construction failed');
    const instance = {
      options, ready: fail ? Promise.reject(new Error('network failed'))
        : defer ? new Promise(resolve => releases.push(resolve)) : Promise.resolve(),
      loadProgress: { total: 2 }, events: [], stopped: 0, cancelled: 0, disposed: 0,
      start(event) {
        this.events.push(event);
        return () => { this.cancelled++; };
      },
      stop() { this.stopped++; },
      dispose() { this.disposed++; },
    };
    instruments.push(instance);
    return instance;
  },
  getSoundfontNames, instrumentByPatchID,
  fetch: (url) => {
    fetched.push(url);
    return Promise.resolve({ ok: true, status: 200, text: async () => `soundfont ${url}` });
  },
  AbortController,
  requestIdleCallback: (callback) => callback(),
  setTimeout,
});
const drain = () => new Promise(resolve => setImmediate(resolve));
const source = readFileSync(new URL('../src/audio/sampledMidiSynth.ts', import.meta.url), 'utf8');
vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/import .*?from 'smplr';/s, '')
  .replace(/import .*?from '@tonejs\/midi\/dist\/InstrumentMaps';/s, '').replace(/export /g, '')}
globalThis.SampledMidiSynth = SampledMidiSynth;
globalThis.instrumentKey = instrumentKey;`, context);
const audioContext = { currentTime: 5 };
const messages = [];
const synth = new context.SampledMidiSynth(audioContext, {}, m => messages.push(m));
const note = { beat: 0, duration: 2, pitch: 60, velocity: 0.8, program: 56, percussion: false };
await synth.load([note, { ...note, pitch: 64 }, { ...note, pitch: 38, percussion: true }]);
assert.equal(instruments.length, 2);
assert.match(instruments[0].options.instrumentUrl, /trumpet-mp3.js$/);
assert.match(instruments[1].options.instrumentUrl, /percussion-mp3.js$/);
assert.deepEqual([...instruments[0].options.notesToLoad.notes], [60, 64]);
const event = { note, delaySeconds: 0.05, durationSeconds: 0.5 };
synth.start(event);
synth.start(event);
assert.equal(instruments[0].events[0].time, 5.05);
assert.equal(instruments[0].events[0].duration, 0.5);
assert.equal(instruments[0].events[0].velocity, 102);
assert.notEqual(instruments[0].events[0].stopId, instruments[0].events[1].stopId);
synth.stop();
assert.equal(instruments[0].cancelled, 2);
synth.start({ ...event, startTimeSeconds: 5.75 });
assert.equal(instruments[0].events.at(-1).time, 5.75,
  'All notes in a scheduler batch retain their absolute audio-clock start, not per-voice construction time');
synth.stop();
for (let i = 0; i < 65; i++) synth.start(event);
assert.match(messages.at(-1), /64-voice limit/);
synth.dispose();
assert.equal(instruments[0].disposed, 1);
defer = true;
const preload = new context.SampledMidiSynth(audioContext, {}, () => {});
const priorCount = instruments.length;
const priorFetches = fetched.length;
const loading = preload.load([note, { ...note, program: 65 }, { ...note, percussion: true }]);
assert.equal(fetched.length - priorFetches, 3,
  'All required soundfont downloads start in parallel before any parsing');
await drain();
assert.equal(instruments.length - priorCount, 1,
  'Soundfonts parse sequentially so main-thread JSON.parse bursts cannot stall startup rendering');
while (instruments.length - priorCount < 3) {
  releases.shift()();
  await drain();
}
assert.equal(instruments.slice(priorCount).every(instrument => instrument.events.length === 0), true,
  'Preloading never starts notes or needs audio-context resume');
releases.splice(0).forEach(resolve => resolve()); await loading;
const preloadedOptions = instruments[priorCount].options;
const fetchesBeforeReuse = fetched.length;
const served = await preloadedOptions.storage.fetch(preloadedOptions.instrumentUrl);
assert.equal(await served.text(), `soundfont ${preloadedOptions.instrumentUrl}`,
  'smplr storage serves the prefetched soundfont text');
assert.equal(fetched.length, fetchesBeforeReuse, 'Serving prefetched text performs no extra network fetch');
preload.start(event);
assert.equal(instruments[priorCount].events.length, 1, 'Preloaded instrument starts without another download');
preload.dispose();
releases.length = 0;
const cancelled = new context.SampledMidiSynth(audioContext, {}, () => {});
const cancelledStart = instruments.length;
const cancelledLoading = cancelled.load([note, { ...note, program: 65 }]);
await drain();
assert.equal(instruments.length - cancelledStart, 1);
cancelled.dispose();
const cancellation = assert.rejects(cancelledLoading, /cancelled/);
releases.splice(0).forEach(resolve => resolve()); await cancellation;
assert.ok(instruments.slice(cancelledStart).every(instrument => instrument.disposed === 1),
  'Cancelling a staged preload disposes every started instrument exactly once');
defer = false;
fail = true;
const failed = new context.SampledMidiSynth(audioContext, {}, () => {});
await assert.rejects(() => failed.load([note]), /network failed/);
assert.equal(instruments.at(-1).disposed, 1);
fail = false;
failConstruction = true;
const constructionFailed = new context.SampledMidiSynth(audioContext, {}, () => {});
await assert.rejects(constructionFailed.load([note, { ...note, program: 65 }]), /construction failed/);
assert.equal(instruments.at(-1).disposed, 1,
  'Construction failure disposes instruments that already loaded');
failConstruction = false;
for (let program = 0; program < 128; program++) {
  assert.ok(getSoundfontNames().includes(context.instrumentKey({ ...note, program })));
}
assert.equal(context.instrumentKey({ ...note, program: 0 }), 'acoustic_grand_piano');
assert.equal(context.instrumentKey({ ...note, program: 65 }), 'alto_sax');
console.log('Sampled MIDI checks passed: parallel downloads with sequential idle-time parsing, prefetched-text reuse, cancellation/construction errors, GM programs/percussion, required pitches, audio-clock scheduling, velocity, unique voices, queued-note cancellation, polyphony, disposal and load errors.');
