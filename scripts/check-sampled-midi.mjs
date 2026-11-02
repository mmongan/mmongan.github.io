// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { getSoundfontNames } from 'smplr';
import { instrumentByPatchID } from '@tonejs/midi/dist/InstrumentMaps.js';

const instruments = [];
const workers = [];
let fail = false;
let defer = false;
let failConstruction = false;
const releases = [];
class MockWorker {
  constructor() {
    this.requests = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    workers.push(this);
  }
  postMessage(request) {
    this.requests.push(request);
    queueMicrotask(() => {
      if (this.terminated) return;
      if (fail) this.onmessage?.({ data: { id: request.id, error: 'network failed' } });
      else this.onmessage?.({ data: { id: request.id,
        // reversed: the synth must re-sort samples into ascending pitch order
        samples: request.pitches.slice().reverse().map(pitch => ({ pitch, data: { url: request.url, pitch } })) } });
    });
  }
  terminate() { this.terminated = true; }
}
const context = vm.createContext({
  Sampler: (_, options) => {
    if (failConstruction && Object.values(options.buffers).some(buffer => /alto_sax/.test(buffer.url))) {
      throw new Error('instrument construction failed');
    }
    const instance = {
      options, ready: defer ? new Promise(resolve => releases.push(resolve)) : Promise.resolve(),
      events: [], stopped: 0, cancelled: 0, disposed: 0,
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
  createSoundfontWorker: () => new MockWorker(),
  requestIdleCallback: (callback) => callback(),
  setTimeout,
  console,
});
const drain = () => new Promise(resolve => setImmediate(resolve));
const source = readFileSync(new URL('../src/audio/sampledMidiSynth.ts', import.meta.url), 'utf8');
vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/import .*?from 'smplr';/s, '')
  .replace(/import .*?from '@tonejs\/midi\/dist\/InstrumentMaps';/s, '')
  .replace(/const createSoundfontWorker =[^;]*;/, '').replace(/export /g, '')}
globalThis.SampledMidiSynth = SampledMidiSynth;
globalThis.instrumentKey = instrumentKey;`, context);
const masterDestination = {};
const audioContext = {
  currentTime: 5,
  createGain: () => ({ gain: { value: 1 }, connect(target) { this.connectedTo = target; }, disconnect() {} }),
  decodeAudioData: async (data) => data,
};
const messages = [];
const synth = new context.SampledMidiSynth(audioContext, masterDestination, m => messages.push(m));
const note = { beat: 0, duration: 2, pitch: 60, velocity: 0.8, program: 56, percussion: false };
await synth.load([note, { ...note, pitch: 64 }, { ...note, pitch: 38, percussion: true }]);
assert.equal(instruments.length, 2);
assert.match(workers[0].requests[0].url, /trumpet-mp3.js$/);
assert.match(workers[0].requests[1].url, /percussion-mp3.js$/);
assert.deepEqual([...workers[0].requests[0].pitches], [60, 64]);
assert.deepEqual(Object.keys(instruments[0].options.buffers), ['C4', 'E4'],
  'Buffer keys are MIDI note names in ascending pitch order — smplr zips sorted key ranges by insertion order');
assert.equal(instruments[0].options.destination.gain.value, 5,
  'Sampler output keeps the gain boost MIDI.js samples are mastered for');
assert.equal(instruments[0].options.destination.connectedTo, masterDestination);
assert.equal(instruments[1].options.destination, instruments[0].options.destination,
  'All instruments share one boost gain node');
assert.equal(workers[0].terminated, true, 'The soundfont worker is terminated after loading');
assert.ok([instruments[0].options.detune, instruments[0].options.decayTime, instruments[0].options.lpfCutoffHz]
  .every(Number.isFinite),
  'Sampler playback defaults are pinned to finite values so voice detune never becomes a NaN AudioParam');
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
const progressCalls = [];
const preload = new context.SampledMidiSynth(audioContext, masterDestination, () => {},
  (loaded, total, name) => progressCalls.push(`${loaded}/${total}${name ? ':' + name : ''}`));
const priorCount = instruments.length;
const loading = preload.load([note, { ...note, program: 65 }, { ...note, percussion: true }]);
assert.equal(workers.at(-1).requests.length, 3,
  'All soundfont requests reach the worker up front so downloads overlap off the main thread');
await drain();
assert.equal(instruments.length - priorCount, 1,
  'Instruments assemble sequentially between idle periods so decoding cannot stall rendering');
while (instruments.length - priorCount < 3) {
  releases.shift()();
  await drain();
}
assert.equal(instruments.slice(priorCount).every(instrument => instrument.events.length === 0), true,
  'Preloading never starts notes or needs audio-context resume');
releases.splice(0).forEach(resolve => resolve()); await loading;
assert.deepEqual(progressCalls, ['0/3', '0/3:trumpet', '1/3:alto_sax', '2/3:percussion', '3/3'],
  'Preloading reports numeric per-instrument progress and names for the startup displays');
preload.start(event);
assert.equal(instruments[priorCount].events.length, 1, 'Preloaded instrument starts without another download');
preload.dispose();
releases.length = 0;
const cancelled = new context.SampledMidiSynth(audioContext, masterDestination, () => {});
const cancelledStart = instruments.length;
const cancelledLoading = cancelled.load([note, { ...note, program: 65 }]);
await drain();
assert.equal(instruments.length - cancelledStart, 1);
cancelled.dispose();
await assert.rejects(cancelledLoading, /cancelled/);
assert.ok(instruments.slice(cancelledStart).every(instrument => instrument.disposed === 1),
  'Cancelling mid-preload disposes every started instrument exactly once');
assert.equal(workers.at(-1).terminated, true, 'Cancelling terminates the soundfont worker');
defer = false;
fail = true;
const failed = new context.SampledMidiSynth(audioContext, masterDestination, () => {});
const failedStart = instruments.length;
await assert.rejects(() => failed.load([note]), /network failed/);
assert.equal(instruments.length, failedStart, 'Download failures reject before any instrument is constructed');
fail = false;
failConstruction = true;
const constructionFailed = new context.SampledMidiSynth(audioContext, masterDestination, () => {});
await assert.rejects(constructionFailed.load([note, { ...note, program: 65 }]), /construction failed/);
assert.equal(instruments.at(-1).disposed, 1,
  'Construction failure disposes instruments that already loaded');
failConstruction = false;
for (let program = 0; program < 128; program++) {
  assert.ok(getSoundfontNames().includes(context.instrumentKey({ ...note, program })));
}
assert.equal(context.instrumentKey({ ...note, program: 0 }), 'acoustic_grand_piano');
assert.equal(context.instrumentKey({ ...note, program: 65 }), 'alto_sax');

// --- soundfontWorker.ts: MidiJS parsing, pitch selection, and binary transfer ---
const workerPosts = [];
const workerSelf = {};
const soundfonts = new Map();
const workerContext = vm.createContext({
  self: workerSelf,
  fetch: async (url) => soundfonts.has(url)
    ? { ok: true, status: 200, text: async () => soundfonts.get(url) }
    : { ok: false, status: 404 },
  atob: (base64) => Buffer.from(base64, 'base64').toString('binary'),
});
const workerSource = readFileSync(new URL('../src/audio/soundfontWorker.ts', import.meta.url), 'utf8');
vm.runInContext(stripTypeScriptTypes(workerSource, { mode: 'transform' }).replace(/export /g, ''), workerContext);
workerSelf.postMessage = (message, options) => workerPosts.push({ message, options });
soundfonts.set('https://example.test/piano-mp3.js',
  'if (typeof(MIDI) === \'undefined\') var MIDI = {};\n'
  + 'MIDI.Soundfont.piano = {\n'
  + '"C4": "data:audio/mp3;base64,AQID",\n'
  + '"Db4": "data:audio/mp3;base64,BAU=",\n'
  + '}\n');
workerSelf.onmessage({ data: { id: 7, url: 'https://example.test/piano-mp3.js', pitches: [60, 61, 61, 120] } });
await drain();
const reply = workerPosts.at(-1);
assert.equal(reply.message.id, 7);
assert.deepEqual([...reply.message.samples.map(sample => sample.pitch)], [60, 61],
  'Exact samples are selected once; out-of-range pitches reuse the nearest available sample');
assert.deepEqual([...new Uint8Array(reply.message.samples[0].data)], [1, 2, 3]);
assert.deepEqual([...new Uint8Array(reply.message.samples[1].data)], [4, 5]);
assert.deepEqual(reply.options.transfer, reply.message.samples.map(sample => sample.data),
  'Sample bytes are transferred to the main thread, not copied');
workerSelf.onmessage({ data: { id: 8, url: 'https://example.test/missing-mp3.js', pitches: [60] } });
await drain();
assert.equal(workerPosts.at(-1).message.id, 8);
assert.match(workerPosts.at(-1).message.error, /HTTP 404/);
soundfonts.set('https://example.test/bad-mp3.js', 'not a soundfont');
workerSelf.onmessage({ data: { id: 9, url: 'https://example.test/bad-mp3.js', pitches: [60] } });
await drain();
assert.match(workerPosts.at(-1).message.error, /Invalid MIDI\.js soundfont/);
console.log('Sampled MIDI checks passed: worker-side download/parse/base64 with transfer, sequential idle-time assembly, shared gain boost, cancellation/network/construction errors, GM programs/percussion, required pitches, audio-clock scheduling, velocity, unique voices, queued-note cancellation, polyphony, disposal and load errors.');
