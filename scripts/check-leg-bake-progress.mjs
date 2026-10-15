import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/ui/legBakeProgress.ts', import.meta.url), 'utf8');
const panel = { hidden: true };
const label = { textContent: '' };
const progress = { value: 0 };
const details = { textContent: '' };
let update;
let cleared;
let click;
let started = 0;
let cancelled = 0;
const button = { addEventListener(type, listener) { assert.equal(type, 'click'); click = listener; },
  removeEventListener(type, listener) { assert.equal(listener, click); click = undefined; } };
let status = { completedCounts: 0, totalCounts: 0, pending: 0, sharedBytes: 0, memoryLimited: 0 };
const context = vm.createContext({
  legBakePanel: panel, legBakeLabel: label, legBakeProgress: progress, legBakeDetails: details,
  legPrebakeButton: button,
  startLegAnimationPrebake() { started++; status.prebaking = true; },
  cancelLegAnimationPrebake() { cancelled++; status.prebaking = false; },
  getLegAnimationBakeStatus: () => status,
  window: { setInterval(callback, delay) { assert.equal(delay, 500); update = callback; return 42; },
    clearInterval(id) { cleared = id; } },
});
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, ''), context);
const dispose = context.initLegBakeProgress();
assert.equal(panel.hidden, true, 'No show means no progress panel');
status = { completedCounts: 6002, totalCounts: 30720, pending: 40,
  sharedBytes: 11 * 1024 * 1024, memoryLimited: 0 };
update();
assert.equal(panel.hidden, false);
assert.match(label.textContent, /Baking legs - 19.5%/);
assert.equal(progress.value, 19.5);
assert.match(details.textContent, /11.00 MiB shared poses/);
click();
assert.equal(started, 1);
assert.equal(button.textContent, 'Cancel prebake');
assert.match(label.textContent, /Prebaking show/);
click();
assert.equal(cancelled, 1);
assert.equal(button.textContent, 'Prebake show');
status.reusedBakes = 20;
update();
assert.match(details.textContent, /20 marchers reuse baking/);
status.bakedPoseHits = 75;
status.bakedPoseMisses = 25;
status.uniqueCycles = 4;
status.readyCycles = 3;
status.reusedCycles = 12;
status.uniqueBakes = 2;
update();
assert.match(details.textContent, /Baked pose hits: 75 \(75.0%, session\)/);
assert.match(details.textContent, /Live fallbacks: 25/);
assert.match(details.textContent, /Cycles: 3 ready \/ 4 unique/);
assert.match(details.textContent, /12 reused sections/);
status.bakedFallbacks = { pending: 22, accuracy: 2, memory: 1, reverseBoundary: 0 };
update();
assert.match(details.textContent, /Waiting for bake: 22/);
assert.match(details.textContent, /Accuracy fallback: 2/);
assert.match(details.textContent, /Memory: 1/);
status.completedCounts = status.totalCounts;
update();
assert.equal(progress.value, 99.9, 'Finalizing work cannot prematurely display 100%');
status.pending = 0;
update();
assert.equal(progress.value, 100);
assert.equal(label.textContent, 'Leg bake ready');
assert.equal(button.disabled, true);
status.memoryLimited = 1;
status.completedCounts = 100;
update();
assert.equal(label.textContent, 'Leg bake limited by memory');
assert.match(details.textContent, /Remaining intervals use live IK/);
status.pending = 1;
update();
assert.match(label.textContent, /memory limit/);
status.totalCounts = 0;
update();
assert.equal(panel.hidden, true, 'Removing all routes hides the panel');
dispose();
assert.equal(cleared, 42, 'Scene disposal clears periodic updates');
assert.equal(click, undefined, 'Disposal removes the prebake click handler');
const robotSource = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const functionSource = name => {
  const start = robotSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return robotSource.slice(start, robotSource.indexOf('\n}', start) + 2);
};
let timer;
let delay;
let time = 0;
const table = { complete: false, advance() { this.complete = true; } };
const scheduler = vm.createContext({
  pendingLegBakes: new Set(), legBakeTimer: undefined, prebakingLegAnimation: false,
  legAnimationBakingEnabled: true,
  console: { warn(message) { assert.match(message, /baking is disabled/); } },
  repeatElapsed: null,
  getMaxCountIndex: () => 20,
  globalPlayback: { playing: false, speedMultiplier: 1 },
  notifyDrillTransport() {},
  performance: { now() { time += 2; return time; } },
  setTimeout(callback, milliseconds) { timer = callback; delay = milliseconds; return 1; },
  applyGlobalCountToAllRobots() { scheduler.scheduleLegBake(table); },
});
for (const name of ['scheduleLegBake', 'startLegAnimationPrebake', 'cancelLegAnimationPrebake',
  'pauseAll', 'playAll', 'rewindAll', 'fastForwardAll']) {
  vm.runInContext(stripTypeScriptTypes(functionSource(name), { mode: 'transform' }), scheduler);
}
assert.match(robotSource, /let legAnimationBakingEnabled = false;/, 'App defaults to cached live IK');
scheduler.legAnimationBakingEnabled = false;
scheduler.globalPlayback.playing = true;
scheduler.startLegAnimationPrebake();
assert.equal(scheduler.globalPlayback.playing, true, 'Disabled prebake cannot pause marching');
assert.equal(scheduler.pendingLegBakes.size, 0, 'Disabled prebake schedules no work');
assert.equal(timer, undefined);
assert.equal(scheduler.prebakingLegAnimation, false);
scheduler.legAnimationBakingEnabled = true;
scheduler.startLegAnimationPrebake();
assert.equal(scheduler.globalPlayback.playing, false, 'Prebake pauses transport before preparation');
assert.equal(delay, 0, 'Accelerated preparation uses minimal timer delay');
assert.equal(scheduler.prebakingLegAnimation, true);
timer();
assert.equal(scheduler.prebakingLegAnimation, false, 'Finishing the queue exits accelerated mode');
assert.equal(scheduler.globalPlayback.playing, false);
scheduler.cancelLegAnimationPrebake();
assert.equal(scheduler.globalPlayback.playing, false, 'Cancelling inactive prebake leaves transport unchanged');
table.complete = false;
scheduler.startLegAnimationPrebake();
scheduler.cancelLegAnimationPrebake();
assert.equal(scheduler.pendingLegBakes.has(table), true, 'Cancelling preserves unfinished baking work');
assert.equal(scheduler.prebakingLegAnimation, false);
assert.equal(scheduler.globalPlayback.playing, true, 'Cancellation immediately resumes marching without a buffer');
assert.equal(table.complete, false, 'Playback resumes even with unfinished baking');
timer();
assert.equal(scheduler.pendingLegBakes.size, 0, 'Background baking continues after cancellation');
table.complete = false;
scheduler.playAll();
assert.equal(scheduler.globalPlayback.playing, true, 'Play starts immediately with unfinished baking');
assert.equal(scheduler.prebakingLegAnimation, false);
for (const [name, speed] of [['playAll', 1], ['rewindAll', -2], ['fastForwardAll', 2]]) {
  table.complete = false;
  scheduler.startLegAnimationPrebake();
  scheduler.globalPlayback.speedMultiplier = 1;
  scheduler[name]();
  assert.equal(scheduler.prebakingLegAnimation, false);
  assert.equal(scheduler.globalPlayback.playing, true);
  assert.equal(scheduler.globalPlayback.speedMultiplier, speed, `${name} preserves its intended speed`);
}
let frame;
let renderedBeat;
Object.assign(scheduler, {
  sharedScene: null, sharedObserver: null, repeatElapsed: null,
  getDrillTransportState: () => ({
    beat: scheduler.globalPlayback.countIndex + scheduler.globalPlayback.stepAccumulatorSeconds * 2,
  }),
  getMusicTransportState: () => scheduler.getDrillTransportState(),
  getSecondsBetweenBeats: (start, end) => Math.abs(end - start) / 2,
  applyGlobalCountToAllRobots() { renderedBeat = scheduler.getDrillTransportState().beat; },
});
vm.runInContext(stripTypeScriptTypes(functionSource('ensureSharedObserver'), { mode: 'transform' }), scheduler);
scheduler.ensureSharedObserver({
  getEngine: () => ({ getDeltaTime: () => 100 }),
  onBeforeRenderObservable: { add(callback) { frame = callback; return callback; } },
});
Object.assign(scheduler.globalPlayback, { playing: true, speedMultiplier: 1,
  countIndex: 11, stepAccumulatorSeconds: 0.45 });
table.complete = false;
frame();
assert.ok(Math.abs(renderedBeat - 12.1) < 1e-9, 'Playback crosses unprepared counts without rollback');
assert.equal(scheduler.globalPlayback.playing, true, 'No automatic refill pause');
frame();
assert.ok(renderedBeat > 12.1, 'Playback keeps advancing while baking is unfinished');
console.log('Leg bake progress checks passed: hidden, active, finalizing, ready, memory-limited, reset, and cleanup.');
