import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/audio/midiPlayback.ts', import.meta.url), 'utf8');
const setupSource = source.slice(source.indexOf('function initializeAudioContext()'), source.indexOf('async function enableAudio('));
const enableSource = source.slice(source.indexOf('async function enableAudio('), source.indexOf('async function prepareSynth()'));
const initSource = source.slice(source.indexOf('  const audioButton = midiAudioButton;'),
  source.indexOf("  fileInput?.addEventListener('change'"));
const buttonSource = source.slice(source.indexOf("  audioButton?.addEventListener('click'"),
  source.indexOf('  onDrillTransportChangedObservable.add(updatePlayback)'));
const events = {};
const buttonEvents = {};
let resumes = 0;
let contexts = 0;
let rejectResume = false;
let releaseResume;
let stopped = 0;
let updated = 0;
let resets = 0;
const messages = [];
class Node {}
const button = new Node();
button.contains = node => node === button;
button.addEventListener = (type, handler) => { buttonEvents[type] = handler; };
class AudioContext {
  constructor() {
    contexts++;
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
    this.listeners = {};
  }
  createGain() { return { gain: { value: 0 }, connect() {} }; }
  createDynamicsCompressor() { return { connect() {} }; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  async resume() {
    resumes++;
    if (rejectResume) throw new Error('Permission denied');
    await new Promise(resolve => { releaseResume = resolve; });
    this.state = 'running';
  }
}
const context = vm.createContext({
  AudioContext, Node, midiAudioButton: button, midiVolumeInput: { value: '60' },
  window: { addEventListener(type, handler) { events[type] = handler; } },
  status: message => messages.push(message),
  stopVoices: () => { stopped++; },
  updatePlayback: () => { updated++; },
  prepareSynth: async () => {},
});
vm.runInContext(`${stripTypeScriptTypes(`
let context: AudioContext | null = null;
let master = null;
let audioEnabled = true;
let enablingAudio = false;
let midiNotes = [];
let synth = null;
let synthLoading = false;
let timeline = { reset() { resets++; } };
let loadedDescription = 'Example MIDI';
${setupSource}
${enableSource}
${initSource}
${buttonSource}
`, { mode: 'transform' }).replace(/export /g, '').replace('resets++;', 'globalThis.onReset();')}
globalThis.state = () => ({ enabled: audioEnabled, context, enabling: enablingAudio });
globalThis.initialize = initializeAudioContext;
globalThis.connectXR = connectMidiXRSession;`, context);
context.onReset = () => { resets++; };
const flush = () => new Promise(resolve => setImmediate(resolve));
assert.equal(context.state().enabled, true);
assert.equal(contexts, 0);
context.initialize();
assert.equal(contexts, 1, 'Audio context exists before opening Settings, so samples can preload');
assert.equal(resumes, 0, 'Startup must not request permission without a user gesture');
assert.equal(button.textContent, 'Mute MIDI audio');
events.pointerdown({ isTrusted: false, target: new Node() });
assert.equal(contexts, 1);
events.pointerdown({ isTrusted: true, target: button });
assert.equal(resumes, 0, 'Mute button must not also auto-enable audio');
events.pointerdown({ isTrusted: true, target: new Node() });
events.keydown({ isTrusted: true, target: new Node() });
assert.equal(resumes, 1, 'Concurrent gestures must share activation');
releaseResume();
await flush();
assert.equal(context.state().context.state, 'running');
assert.equal(updated, 1);
buttonEvents.click();
assert.equal(context.state().enabled, false);
events.pointerdown({ isTrusted: true, target: new Node() });
assert.equal(resumes, 1, 'Explicit mute must survive later gestures');
buttonEvents.click();
releaseResume();
await flush();
assert.equal(context.state().enabled, true);
const audio = context.state().context;
audio.state = 'suspended';
audio.listeners.statechange();
assert.equal(context.state().enabled, true, 'Suspension must retain the enabled preference');
assert.match(messages.at(-1), /permission/);
const xrEvents = {};
const removed = [];
context.connectXR({
  addEventListener(type, handler) { xrEvents[type] = handler; },
  removeEventListener(type) { removed.push(type); },
});
releaseResume();
await flush();
assert.equal(audio.state, 'running');
audio.state = 'suspended';
xrEvents.selectstart();
releaseResume();
await flush();
assert.equal(audio.state, 'running', 'XR pinch/trigger resumes music without a DOM menu');
buttonEvents.click();
const mutedResumes = resumes;
xrEvents.squeezestart();
assert.equal(resumes, mutedResumes, 'XR squeeze must preserve explicit mute');
buttonEvents.click();
releaseResume();
await flush();
assert.equal(context.state().enabled, true);
xrEvents.end();
assert.deepEqual(removed.sort(), ['selectend', 'selectstart', 'squeezestart']);
for (const type of ['pointerup', 'touchend', 'click']) {
  audio.state = 'suspended';
  events[type]({ isTrusted: true, target: new Node() });
  releaseResume();
  await flush();
  assert.equal(audio.state, 'running', `${type} unlocks touch/desktop audio`);
}
audio.state = 'suspended';
rejectResume = true;
events.pointerdown({ isTrusted: true, target: new Node() });
await flush();
assert.equal(context.state().enabled, true, 'Automatic permission failure must allow another field/XR gesture to retry');
assert.equal(button.disabled, false);
assert.match(messages.at(-1), /Permission denied.*retry/);
rejectResume = false;
events.pointerup({ isTrusted: true, target: new Node() });
releaseResume();
await flush();
assert.equal(audio.state, 'running', 'A later trusted interaction recovers after permission denial');
assert.ok(stopped > 0 && resets > 0);
assert.ok(!source.includes('midiStartButton'), 'Music must not require a separate start button');
const sceneSource = readFileSync(new URL('../src/scene/index.ts', import.meta.url), 'utf8');
assert.doesNotMatch(sceneSource, /\bplayAll\b|\bstartupPlaybackObserver\b/,
  'Application startup never starts music or drill playback');
assert.doesNotMatch(setupSource + enableSource, /\bplayAll\b|\btoggleAllPlayback\b/,
  'Audio permission and XR connection must not start playback');
const readinessSource = source.slice(source.indexOf('export function isMidiPlaybackReady()'), source.indexOf('function updatePlaybackHint('));
const readiness = vm.createContext({ audioEnabled: true, midiLoading: true, timeline: null, context: null, synth: null });
vm.runInContext(stripTypeScriptTypes(readinessSource).replace(/export /g, ''), readiness);
assert.equal(readiness.isMidiPlaybackReady(), false);
readiness.midiLoading = false;
readiness.timeline = {};
readiness.synth = {};
readiness.context = { state: 'suspended' };
assert.equal(readiness.isMidiPlaybackReady(), false);
readiness.context.state = 'running';
assert.equal(readiness.isMidiPlaybackReady(), true);
readiness.synth = null;
assert.equal(readiness.isMidiPlaybackReady(), false, 'Running context alone is not enough; samples must be loaded');
readiness.audioEnabled = false;
assert.equal(readiness.isMidiPlaybackReady(), true, 'Explicit mute or reported audio failure does not block drill');
readiness.audioEnabled = true;
readiness.timeline = null;
assert.equal(readiness.isMidiPlaybackReady(), true, 'No MIDI or failed MIDI load does not block drill');
const statusSource = source.slice(source.indexOf('export function isMidiPlaybackReady()'), source.indexOf('function stopVoices('));
const hintContext = vm.createContext({
  audioEnabled: true, midiLoading: false, timeline: {}, context: { state: 'running' },
  synth: {}, synthLoading: false, statusIsError: false,
  midiStatus: { textContent: '' }, midiPlaybackHint: { hidden: true, textContent: '' },
});
vm.runInContext(stripTypeScriptTypes(statusSource).replace(/export /g, ''), hintContext);
hintContext.status('MIDI download failed; previous music retained.', true);
assert.equal(hintContext.midiPlaybackHint.hidden, false, 'Errors are explicit state, not inferred from English wording');
hintContext.updatePlaybackHint();
assert.equal(hintContext.midiPlaybackHint.hidden, false, 'Load completion must not hide error notices');
hintContext.status('Sampled General MIDI ready.');
assert.equal(hintContext.midiPlaybackHint.hidden, true);
hintContext.context.state = 'suspended';
hintContext.status('Waiting for audio.');
assert.match(hintContext.midiPlaybackHint.textContent, /Press Play/);
assert.equal(hintContext.midiPlaybackHint.hidden, false);
let disposed = 0;
const disposalContext = vm.createContext({
  synthRequest: 1, synthLoading: true, synth: { dispose() { disposed++; } },
});
const disposalSource = source.slice(source.indexOf('function disposeSynth()'), source.indexOf('function initializeAudioContext()'));
vm.runInContext(stripTypeScriptTypes(disposalSource), disposalContext);
disposalContext.disposeSynth();
assert.equal(disposalContext.synthRequest, 2, 'Disposal invalidates older asynchronous sample loads');
assert.equal(disposalContext.synthLoading, false);
assert.equal(disposalContext.synth, null);
assert.equal(disposed, 1);
console.log('MIDI activation checks passed: startup context, trusted pointer/touch/click unlock, concurrent activation, XR session/pinch/squeeze and cleanup, mute preservation, suspension recovery, and visible retry errors.');
