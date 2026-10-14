import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/robot/playbackRepeat.ts', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, '')}
globalThis.resolve = resolveRepeatPlayback;`, context);
const resolve = context.resolve;
let options = { drill: false, song: false, songLength: 636 };
assert.equal(resolve(256, 256, options).ended, true);
options.drill = true;
let frame = resolve(256.25, 256, options);
assert.equal(frame.drillBeat, 0.25);
assert.equal(frame.songBeat, 256.25, 'Music continues across drill restart');
assert.equal(frame.ended, false);
frame = resolve(700, 256, options);
assert.equal(frame.elapsed, 636);
assert.equal(frame.ended, true, 'Stop precisely at song end, even after large frame delta');
options.song = true;
frame = resolve(636.5, 256, options);
assert.equal(frame.songBeat, 0.5);
assert.equal(frame.songCycle, 1);
assert.equal(frame.drillBeat, 124.5, 'Song repeat does not restart drill');
assert.equal(frame.ended, false);
options.drill = false;
frame = resolve(200, 256, { ...options, songLength: 64 });
assert.equal(frame.songBeat, 8);
assert.equal(frame.songCycle, 3);
assert.equal(resolve(256, 256, options).ended, true, 'Song repeat alone retains drill endpoint');
assert.equal(resolve(1000, 256, { drill: true, song: false, songLength: 0 }).ended, false,
  'No music: repeat drill indefinitely');
assert.equal(resolve(-1, 256, options).elapsed, 0);
assert.equal(resolve(512, 256, { drill: true, song: false, songLength: 512 }).drillBeat, 256,
  'When song and drill end together, hold ending set rather than jumping to opening');

const timelineSource = readFileSync(new URL('../src/audio/midiTimeline.ts', import.meta.url), 'utf8');
vm.runInContext(`${stripTypeScriptTypes(timelineSource, { mode: 'transform' }).replace(/export /g, '')}
globalThis.Timeline = MidiTimeline;`, context);
const timeline = new context.Timeline([
  { beat: 255, duration: 4, pitch: 60, velocity: 0.8, program: 0, percussion: false },
  { beat: 256, duration: 1, pitch: 64, velocity: 0.8, program: 0, percussion: false },
]);
const musicState = time => {
  const f = resolve(time, 256, { drill: true, song: false, songLength: 636 });
  return { beat: f.songBeat, lastBeat: f.songEnd, beatsPerSecond: 2, playing: !f.ended, revision: 0 };
};
const openingPlan = timeline.update(musicState(255), 0);
assert.equal(openingPlan.scheduled[0].durationSeconds, 2, 'Held note extends through drill restart');
const acrossRestart = timeline.update(musicState(256), 0.5);
assert.equal(acrossRestart.reset, false, 'Drill loop must not reset sounding MIDI voices');
assert.equal(acrossRestart.scheduled[0].note.pitch, 64);

const robotSource = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const observerSource = robotSource.slice(robotSource.indexOf('function ensureSharedObserver'),
  robotSource.indexOf('// Registers (or re-registers'));
const playback = { countIndex: 255, stepAccumulatorSeconds: 0, tempoMultiplier: 1, speedMultiplier: 1, playing: true };
let callback;
let updates = 0;
const scene = {
  getEngine: () => ({ getDeltaTime: () => 750 }),
  onBeforeRenderObservable: { add: fn => { callback = fn; return {}; }, remove() {} },
};
const observerContext = vm.createContext({
  globalPlayback: playback, sharedScene: null, sharedObserver: null,
  repeatElapsed: 255, repeatOptions: { drill: true, song: false, songLength: 636 },
  resolveRepeatPlayback: resolve, getMaxCountIndex: () => 256,
  playbackTempoMap: null, getCountInterval: () => 0.5,
  getSecondsBetweenBeats: (start, end) => Math.abs(end - start) * 0.5,
  advanceBeatBySeconds: (start, end, seconds) => start + Math.sign(end - start) *
    Math.min(Math.abs(end - start), seconds / 0.5),
  selectedMarchingGait: 0,
  MARCHING_GAITS: [{ tempoFactor: 1 }],
  applyGlobalCountToAllRobots: () => { updates++; },
});
vm.runInContext(`${stripTypeScriptTypes(observerSource, { mode: 'transform' })}
globalThis.ensure = ensureSharedObserver;`, observerContext);
observerContext.ensure(scene);
callback();
assert.equal(playback.countIndex, 0);
assert.equal(playback.stepAccumulatorSeconds, 0.25, 'Drill restart preserves sub-count timing');
assert.equal(observerContext.repeatElapsed, 256.5);
assert.equal(playback.playing, true);
playback.playing = false;
callback();
assert.equal(observerContext.repeatElapsed, 256.5, 'Pause holds continuous music clock');
playback.playing = true;
observerContext.repeatElapsed = 635;
callback();
assert.equal(observerContext.repeatElapsed, 636);
assert.equal(playback.playing, false);
assert.equal(updates, 3);
console.log('Repeat playback checks passed: independent song/drill loops, continuous music, fractional timing, exact song end, pause, large deltas, and no-MIDI drill looping.');
