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
let paused = false;
let timer;
let delay;
let time = 0;
const table = { complete: false, advance() { this.complete = true; } };
let preparedThrough = 0;
const checkedCounts = [];
const scheduler = vm.createContext({
  pendingLegBakes: new Set(), legBakeTimer: undefined, prebakingLegAnimation: false,
  waitingForLegBake: false,
  heldRobots: new Set(),
  players: new Map([[1, { counts: Array(21), legBake: { table: {
    isCountPrepared(count) { checkedCounts.push(count); return count < preparedThrough; },
  } } }]]),
  getDrillTransportState: () => ({ beat: 2 }),
  getMusicTransportState: () => ({ beat: 2 }),
  getMaxCountIndex: () => 20,
  advanceBeatBySeconds: (start, end, seconds) => Math.min(end, start + seconds * 2),
  globalPlayback: { playing: false, speedMultiplier: 1 },
  notifyDrillTransport() {},
  performance: { now() { time += 2; return time; } },
  setTimeout(callback, milliseconds) { timer = callback; delay = milliseconds; return 1; },
  pauseAll() { paused = true; scheduler.globalPlayback.playing = false; },
  applyGlobalCountToAllRobots() { scheduler.scheduleLegBake(table); },
});
for (const name of ['scheduleLegBake', 'startLegAnimationPrebake', 'cancelLegAnimationPrebake',
  'resumeAfterLegBakeBuffer', 'playAll', 'rewindAll', 'fastForwardAll']) {
  vm.runInContext(stripTypeScriptTypes(functionSource(name), { mode: 'transform' }), scheduler);
}
scheduler.startLegAnimationPrebake();
assert.equal(paused, true, 'Prebake pauses transport before preparation');
assert.equal(delay, 0, 'Accelerated preparation uses minimal timer delay');
assert.equal(scheduler.prebakingLegAnimation, true);
timer();
assert.equal(scheduler.prebakingLegAnimation, false, 'Finishing the queue exits accelerated mode');
assert.equal(paused, true, 'Completion never automatically resumes marching');
assert.equal(scheduler.globalPlayback.playing, false);
scheduler.cancelLegAnimationPrebake();
assert.equal(scheduler.globalPlayback.playing, false, 'Cancelling inactive prebake leaves transport unchanged');
table.complete = false;
scheduler.startLegAnimationPrebake();
scheduler.cancelLegAnimationPrebake();
assert.equal(scheduler.pendingLegBakes.has(table), true, 'Cancelling preserves unfinished baking work');
assert.equal(scheduler.waitingForLegBake, true);
assert.equal(scheduler.globalPlayback.playing, false, 'Cancellation waits for the buffer');
preparedThrough = 11;
scheduler.resumeAfterLegBakeBuffer();
assert.equal(scheduler.globalPlayback.playing, false, 'Less than five seconds stays paused');
preparedThrough = 12;
scheduler.resumeAfterLegBakeBuffer();
assert.equal(scheduler.prebakingLegAnimation, false);
assert.equal(scheduler.globalPlayback.playing, true, 'Five seconds of preparation resumes playback');
assert.equal(checkedCounts.at(-1), 11, 'At two counts per second, ten upcoming counts must be prepared');
table.complete = false;
scheduler.startLegAnimationPrebake();
scheduler.globalPlayback.speedMultiplier = 2;
scheduler.cancelLegAnimationPrebake();
assert.equal(scheduler.globalPlayback.playing, false, 'Double speed requires more prepared counts');
preparedThrough = 20;
scheduler.resumeAfterLegBakeBuffer();
assert.equal(scheduler.globalPlayback.playing, true, 'Near the end, all remaining counts suffice');
timer();
assert.equal(scheduler.pendingLegBakes.size, 0, 'Background baking continues after cancellation');
for (const [name, speed] of [['playAll', 1], ['rewindAll', -2], ['fastForwardAll', 2]]) {
  table.complete = false;
  scheduler.startLegAnimationPrebake();
  scheduler.globalPlayback.speedMultiplier = 1;
  scheduler[name]();
  assert.equal(scheduler.prebakingLegAnimation, false);
  assert.equal(scheduler.globalPlayback.playing, true);
  assert.equal(scheduler.globalPlayback.speedMultiplier, speed, `${name} preserves its intended speed`);
}
console.log('Leg bake progress checks passed: hidden, active, finalizing, ready, memory-limited, reset, and cleanup.');
