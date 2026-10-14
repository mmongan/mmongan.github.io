import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { getSoundfontNames } from 'smplr';
import { instrumentByPatchID } from '@tonejs/midi/dist/InstrumentMaps.js';

const instruments = [];
let fail = false;
const context = vm.createContext({
  Soundfont: (_, options) => {
    const instance = {
      options, ready: fail ? Promise.reject(new Error('network failed')) : Promise.resolve(),
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
});
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
for (let i = 0; i < 65; i++) synth.start(event);
assert.match(messages.at(-1), /64-voice limit/);
synth.dispose();
assert.equal(instruments[0].disposed, 1);
fail = true;
const failed = new context.SampledMidiSynth(audioContext, {}, () => {});
await assert.rejects(() => failed.load([note]), /network failed/);
assert.equal(instruments.at(-1).disposed, 1);
for (let program = 0; program < 128; program++) {
  assert.ok(getSoundfontNames().includes(context.instrumentKey({ ...note, program })));
}
assert.equal(context.instrumentKey({ ...note, program: 0 }), 'acoustic_grand_piano');
assert.equal(context.instrumentKey({ ...note, program: 65 }), 'alto_sax');
console.log('Sampled MIDI checks passed: GM program/percussion selection, required pitches, audio-clock scheduling, velocity, unique voice IDs, queued-note cancellation, polyphony limit, disposal, and load errors.');
