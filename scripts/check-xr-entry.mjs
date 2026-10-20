import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/xr/webXR.ts', import.meta.url), 'utf8');
const slice = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
};
const button = () => ({ disabled: false, handlers: {},
  addEventListener(type, handler) { this.handlers[type] = handler; } });
const enterVRButton = button(), enterARButton = button(), fullScaleVRButton = button();
const launches = [], builds = [], errors = [], scales = [];
const supported = new Set(['immersive-vr', 'immersive-ar']);
let disposed = 0;
let prepareHook = async () => {};
let failEntry = false;
const timers = new Map();
let timerId = 0;
let disposeTimer;
const state = { NOT_IN_XR: 0, IN_XR: 2 };
const context = vm.createContext({
  Error,
  setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
  clearTimeout: id => timers.delete(id),
  scene: { onDisposeObservable: { addOnce: callback => { disposeTimer = callback; } } },
  enterVRButton, enterARButton, fullScaleVRButton, WebXRState: state,
  xrEntryStatus: { hidden: true, textContent: '' },
  xrModeInputs: [{ value: 'immersive-vr' }, { value: 'immersive-ar' }],
  console: { error: message => errors.push(message) },
  makeExperience(mode) {
    if (!supported.has(mode)) return undefined;
    return { dispose() { disposed++; }, baseExperience: {
      state: state.NOT_IN_XR,
      async enterXRAsync(enteredMode, referenceSpace) {
        if (failEntry) throw new Error('Permission denied');
        launches.push([enteredMode, referenceSpace]);
        this.state = state.IN_XR;
      },
      async exitXRAsync() { this.state = state.NOT_IN_XR; },
    } };
  },
  prepare: async mode => { builds.push(mode); await prepareHook(); },
  isMarcherPOVActive: () => false, setMarcherPOVEnabled() {},
  setARScale: scale => scales.push(scale), getARScaleRange: () => ({ max: 1 }),
  setFieldHeightMode: mode => assert.equal(mode, 'floor'),
  setDrillEditingEnabled: enabled => assert.equal(enabled, false),
  setImmersiveFieldScaling: enabled => assert.equal(enabled, false),
  updateScaleControls: enabled => assert.equal(enabled, false),
  applyPostureHeight() {},
});
const code = `
let xrExperience, preparingXR = null, preferredMode = 'immersive-vr';
let switchingToFullScaleVR = false, giantModeActive = false;
const sessionSupport = new Map();
${slice('  let entryHideTimeout:', '  function getCameraSittingPosture(')}
${slice('  async function setupDefaultXRExperience(', '  async function createXRExperience(')}
async function createXRExperience() {
  await prepare(preferredMode);
  xrExperience = makeExperience(preferredMode);
}
${slice('  async function enterXRMode(', '  tabletopScaleButton?.addEventListener(')}
globalThis.experience = () => xrExperience;
globalThis.busy = () => switchingToFullScaleVR;
`;
vm.runInContext(stripTypeScriptTypes(code, { mode: 'transform' }), context);
const flush = () => new Promise(resolve => setImmediate(resolve));
assert.deepEqual(launches, [], 'Wiring entry buttons never launches XR or starts playback');
await context.setupDefaultXRExperience();
assert.deepEqual(builds, ['immersive-vr']);
enterVRButton.handlers.click();
await flush();
assert.deepEqual(launches, [['immersive-vr', 'local-floor']], 'VR button enters immersive VR');
assert.equal(builds.length, 1, 'VR launch reuses the preloaded experience');
assert.equal(enterARButton.disabled, true, 'Entry buttons are disabled during an immersive session');
await context.experience().baseExperience.exitXRAsync();
context.updateEntryButtons();
assert.equal(enterARButton.disabled, false);
enterARButton.handlers.click();
await flush();
assert.deepEqual(launches.at(-1), ['immersive-ar', 'local-floor'], 'AR button enters immersive AR, not VR');
assert.equal(context.xrModeInputs[1].checked, true);
assert.equal(disposed, 1, 'Switching modes disposes the old XR experience');
await context.experience().baseExperience.exitXRAsync();

let release;
prepareHook = () => new Promise(resolve => { release = resolve; });
const pending = context.setupDefaultXRExperience('immersive-vr');
await flush();
const queued = context.setupDefaultXRExperience('immersive-ar');
const launch = context.enterXRMode('immersive-ar');
await context.enterXRMode('immersive-vr');
assert.equal(context.busy(), true);
prepareHook = async () => {};
release();
await Promise.all([pending, queued, launch]);
assert.deepEqual(builds, ['immersive-vr', 'immersive-ar', 'immersive-vr', 'immersive-ar'],
  'Queued preparation and launch never build duplicate experiences');
assert.equal(launches.at(-1)[0], 'immersive-ar', 'Concurrent mode clicks cannot override the first launch');
await context.experience().baseExperience.exitXRAsync();

failEntry = true;
await context.enterXRMode('immersive-ar');
assert.match(context.xrEntryStatus.textContent, /Could not open AR: Permission denied/);
assert.equal(context.xrEntryStatus.hidden, false);
assert.equal(context.busy(), false);
assert.equal(timers.size, 1, 'Status changes replace rather than accumulate hide timers');
const timer = [...timers.values()][0];
assert.equal(timer.delay, 10000, 'XR entry UI hides after ten seconds');
timers.clear();
timer.callback();
assert.equal(enterVRButton.hidden, true);
assert.equal(enterARButton.hidden, true);
assert.equal(context.xrEntryStatus.hidden, true, 'Compatibility/status message hides with the buttons');
context.updateEntryButtons();
assert.equal(enterVRButton.hidden, true, 'Support updates do not restore timed-out buttons');
context.entryStatus('Could not open VR: retry required.');
assert.equal(context.xrEntryStatus.hidden, false, 'New errors are visible after the startup timeout');
disposeTimer();
assert.equal(timers.size, 0, 'Disposal clears the newly scheduled timer');
assert.equal(enterARButton.disabled, false, 'Rejected session entry can be retried');
failEntry = false;
fullScaleVRButton.handlers.click();
await flush();
assert.equal(launches.at(-1)[0], 'immersive-vr');
assert.deepEqual(scales, [1], 'Full scale VR remains an explicit full-scale launch');
await context.experience().baseExperience.exitXRAsync();
supported.delete('immersive-ar');
await context.enterXRMode('immersive-ar');
assert.match(context.xrEntryStatus.textContent, /not supported/);
assert.ok(errors.length >= 2, 'Launch errors are surfaced to the UI and logged');
assert.equal(context.busy(), false);
console.log('XR entry checks passed: separate VR/AR buttons, preloaded reuse, safe mode switches, serialized preparation, concurrent-click guard, permission retries, full-scale launch and unsupported-device feedback.');
