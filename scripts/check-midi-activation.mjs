import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/audio/midiPlayback.ts', import.meta.url), 'utf8');
const enableSource = source.slice(source.indexOf('async function enableAudio()'), source.indexOf('async function prepareSynth()'));
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
let timeline = { reset() { resets++; } };
let loadedDescription = 'Example MIDI';
${enableSource}
${initSource}
${buttonSource}
`, { mode: 'transform' }).replace('resets++;', 'globalThis.onReset();')}
globalThis.state = () => ({ enabled: audioEnabled, context, enabling: enablingAudio });`, context);
context.onReset = () => { resets++; };
const flush = () => new Promise(resolve => setImmediate(resolve));
assert.equal(context.state().enabled, true);
assert.equal(contexts, 0);
assert.equal(button.textContent, 'Mute MIDI audio');
events.pointerdown({ isTrusted: false, target: new Node() });
assert.equal(contexts, 0);
events.pointerdown({ isTrusted: true, target: button });
assert.equal(contexts, 0, 'Mute button must not also auto-enable audio');
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
assert.match(messages.at(-1), /suspended/);
events.keydown({ isTrusted: true, target: new Node() });
releaseResume();
await flush();
assert.equal(audio.state, 'running');
audio.state = 'suspended';
rejectResume = true;
events.pointerdown({ isTrusted: true, target: new Node() });
await flush();
assert.equal(context.state().enabled, false);
assert.equal(button.disabled, false);
assert.match(messages.at(-1), /Permission denied.*retry/);
assert.ok(stopped > 0 && resets > 0);
console.log('MIDI activation checks passed: enabled default, trusted gesture unlock, concurrent activation, mute preservation, explicit enable, suspension recovery, and visible retry errors.');
