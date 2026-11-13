// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const context = vm.createContext({
  globalPlayback: { playing: false, speedMultiplier: 1, countIndex: 0, stepAccumulatorSeconds: 0 },
  prebakingLegAnimation: false, transportRevision: 0, repeatElapsed: null,
  notifyDrillTransport() {}, applyGlobalCountToAllRobots() {}, setDrillBeatPosition() {},
  getMaxCountIndex: () => 16, clampToBlankChartPageSpan: beat => beat,
});
vm.runInContext(stripTypeScriptTypes(source.slice(source.indexOf('let playbackStartGuard:'),
  source.indexOf('export function getMarchTempo(')) +
  source.slice(source.indexOf('export function rewindAll('), source.indexOf('// Nudges the shared clock')),
{ mode: 'transform' }).replace(/export /g, ''), context);
let ready = false, requests = 0;
context.setPlaybackStartGuard(() => { requests++; return ready; });
assert.equal(context.isPlaybackRequested(), false);
context.playAll();
assert.equal(context.globalPlayback.playing, false, 'Play waits without advancing the opening while samples/audio are unavailable');
assert.equal(context.globalPlayback.countIndex, 0);
assert.equal(context.isPlaybackStartPending(), true, 'Immersive controls can show that Play is armed');
assert.equal(context.isPlaybackRequested(), true, 'Play/Pause icons show the pending request as on');
context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, false);
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, true, 'Ready samples/browser audio release only an explicit pending Play');
assert.equal(context.isPlaybackStartPending(), false);
assert.equal(context.isPlaybackRequested(), true);
context.pauseAll();
ready = false; context.playAll(); context.toggleAllPlayback();
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, false, 'Second Play/Pause cancels a pending start');
ready = false; context.fastForwardAll();
assert.equal(context.globalPlayback.playing, false);
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.speedMultiplier, 2, 'Pending fast-forward retains its selected speed');
assert.equal(context.globalPlayback.playing, true);
context.pauseAll();
ready = false; context.playAll(); context.seekToCount(0);
ready = true; context.retryPendingPlaybackStart();
assert.equal(context.globalPlayback.playing, false, 'Seek cancels pending playback');
ready = false; context.rewindAll();
assert.equal(context.globalPlayback.playing, true, 'Muted rewind does not wait for audio');
context.pauseAll(); context.setPlaybackStartGuard(null); context.playAll();
assert.equal(context.globalPlayback.playing, true, 'No audio guard preserves ordinary drill playback');
assert.ok(requests >= 4);
const entrySource = readFileSync(new URL('../src/scene/index.ts', import.meta.url), 'utf8');
const warmup = entrySource.slice(entrySource.indexOf('const warmupObserver'), entrySource.indexOf('seekToCount(0.5)'));
assert.match(warmup, /if \(isPlaybackRequested\(\)\)/,
  'Startup warm-up seeks must not cancel a Play pressed while music is still loading');
assert.match(entrySource, /runFrameStage\('render', \(\) => scene\.render\(\)\)/,
  'Render-loop stages are contained so one failure cannot freeze the immersive view');
const audioSource = readFileSync(new URL('../src/audio/midiPlayback.ts', import.meta.url), 'utf8');
const gains = [];
const audioContext = vm.createContext({
  resetFootballMusicPause() {},
  midiVolumeInput: { value: '60' }, master: null, context: null,
});
vm.runInContext(stripTypeScriptTypes(audioSource.slice(audioSource.indexOf('let footballVolumeScale'),
  audioSource.indexOf('export function isMidiPlaybackReady')), { mode: 'transform' }).replace(/export /g, ''),
audioContext);
audioContext.setFootballAudioMode(true);
assert.equal(audioContext.selectedMidiGain(), .15, 'Football before audio initialization retains reduced gain');
audioContext.master = { gain: { setTargetAtTime: (gain, time, ramp) => gains.push({ gain, time, ramp }) } };
audioContext.context = { currentTime: 10 };
audioContext.setFootballAudioMode(true);
assert.equal(gains.at(-1).gain, .15, 'Football music uses 25% of the selected volume');
audioContext.midiVolumeInput.value = '80';
assert.equal(audioContext.selectedMidiGain(), .2, 'Volume slider retains the football multiplier');
audioContext.setFootballAudioMode(false);
assert.equal(gains.at(-1).gain, .8, 'Returning to band restores the current user volume');
assert.equal(audioContext.midiVolumeInput.value, '80', 'Mode changes never overwrite the user volume');
audioContext.midiVolumeInput.value = '0';
audioContext.setFootballAudioMode(true);
assert.equal(gains.at(-1).gain, 0, 'Muted volume stays muted in football');
assert.match(audioSource, /master\.gain\.value = selectedMidiGain\(\)/, 'Audio initialization applies the mode gain');
assert.match(audioSource, /setTargetAtTime\(selectedMidiGain\(\), context\.currentTime, 0\.02\)/,
  'Volume input changes apply the mode gain');
const musicContext = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(readFileSync(new URL('../src/audio/footballMusicTransport.ts', import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '') +
  '\nglobalThis.music = new FootballMusicTransport();', musicContext);
const music = musicContext.music;
const state = { beat: 48, playing: true, beatsPerSecond: 2, revision: 1, lastBeat: 264 };
music.start(state, 10);
const stopped = { ...state, playing: false, revision: 2 };
const during = music.resolve(stopped, 11.5);
assert.equal(during.playing, true, 'Music remains playing while players pause');
assert.equal(during.beat, 51, 'Music advances independently during the snap hold');
assert.equal(during.revision, 1, 'Internal player seek does not reset sounding notes');
music.finish(stopped, 13);
const resumed = music.resolve({ ...stopped, playing: true }, 13);
assert.equal(resumed.beat, 54, 'Music resumes six beats ahead instead of rewinding');
assert.equal(resumed.revision, 1);
music.start({ ...stopped, beat: 96, playing: true }, 20);
music.finish({ ...stopped, beat: 96, revision: 3 }, 23);
assert.equal(music.resolve({ ...state, beat: 96, revision: 3 }, 23).beat, 108,
  'Successive snap pauses accumulate music progress');
assert.equal(music.resolve({ ...state, beat: 10, revision: 4 }, 24).beat, 10,
  'Manual seek restores normal music/drill synchronization');
music.start(state, 25); music.reset();
assert.equal(music.resolve(stopped, 26).playing, false, 'Exit/cancellation removes independent playback');
const timelineContext = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(readFileSync(new URL('../src/audio/midiTimeline.ts', import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '') +
  '\nglobalThis.Timeline = MidiTimeline;', timelineContext);
let audioTime = 10, musicState = { ...state }, voiceStops = 0;
const scheduledPitches = [];
const integration = vm.createContext({
  context: { state: 'running', get currentTime() { return audioTime; } },
  audioEnabled: true, footballMusicTransport: music, master: {}, clickTrack: null, midiLoading: false,
  timeline: new timelineContext.Timeline(Array.from({ length: 80 }, (_, index) => ({
    beat: 48 + index / 4, duration: .2, pitch: index, velocity: 1, program: 0, percussion: false,
  }))),
  synth: { start: scheduled => scheduledPitches.push(scheduled.note.pitch) },
  stopVoices: () => { voiceStops++; },
  getMusicTransportState: () => musicState,
});
vm.runInContext(stripTypeScriptTypes(audioSource.slice(audioSource.indexOf('function updatePlayback('),
  audioSource.indexOf('async function readMidiUrl(')), { mode: 'transform' }), integration);
music.reset();
integration.updatePlayback();
const initialStops = voiceStops;
music.start(musicState, audioTime);
musicState = { ...stopped };
integration.updatePlayback();
for (let tick = 1; tick <= 120; tick++) {
  audioTime = 10 + tick * .025;
  integration.updatePlayback(true);
  if (tick % 4 === 0) integration.updatePlayback();
}
assert.equal(voiceStops, initialStops, 'Actual MIDI updates never stop voices during player snap hold');
assert.ok(scheduledPitches.length > 20, 'MIDI clock keeps scheduling fresh notes through the hold');
assert.equal(new Set(scheduledPitches).size, scheduledPitches.length, 'Snap hold does not replay scheduled notes');
music.finish(musicState, audioTime);
musicState = { ...musicState, playing: true };
integration.updatePlayback();
assert.equal(voiceStops, initialStops, 'Player resume does not cut off or rewind music');
musicState = { ...musicState, playing: false };
integration.updatePlayback();
assert.equal(voiceStops, initialStops + 1, 'Explicit user pause still stops music normally');
console.log('MIDI startup passed: explicit Play waits at the opening, readiness releases the request, pause/seek cancel, fast-forward preserves speed, rewind remains muted, and no guard preserves legacy playback.');
