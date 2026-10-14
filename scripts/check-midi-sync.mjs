import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import midiPackage from '@tonejs/midi';

const { Midi } = midiPackage;
const context = vm.createContext({ Math });
const source = readFileSync(new URL('../src/audio/midiTimeline.ts', import.meta.url), 'utf8');
vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, '')}
globalThis.MidiTimeline = MidiTimeline;`, context);
const midi = new Midi();
midi.header.setTempo(90);
const track = midi.addTrack();
track.addNote({ midi: 60, ticks: 0, durationTicks: midi.header.ppq * 4, velocity: 0.8 });
track.addNote({ midi: 64, ticks: midi.header.ppq, durationTicks: midi.header.ppq, velocity: 0.5 });
const parsed = new Midi(midi.toArray());
const notes = parsed.tracks.flatMap(t => t.notes.map(n => ({
  beat: n.ticks / parsed.header.ppq, duration: n.durationTicks / parsed.header.ppq,
  pitch: n.midi, velocity: n.velocity, program: t.instrument.number, percussion: t.instrument.percussion,
})));
assert.equal(notes[1].beat, 1);
const timeline = new context.MidiTimeline(notes);
const state = { beat: 0, beatsPerSecond: 2, playing: true, lastBeat: 16, revision: 0 };
let result = timeline.update(state, 0);
assert.equal(result.scheduled.length, 1);
assert.equal(result.scheduled[0].durationSeconds, 2);
assert.equal(result.reset, true);
result = timeline.update({ ...state, beat: 0.9 }, 0.45);
assert.equal(result.reset, false);
assert.equal(result.scheduled.length, 1);
assert.ok(Math.abs(result.scheduled[0].delaySeconds - 0.05) < 1e-9);
assert.equal(timeline.update({ ...state, beat: 0.95 }, 0.475).scheduled.length, 0);
result = timeline.update({ ...state, beat: 2, revision: 1 }, 0.5);
assert.equal(result.reset, true);
assert.equal(result.scheduled.length, 1);
assert.equal(result.scheduled[0].durationSeconds, 1);
assert.equal(timeline.update({ ...state, beat: 2, playing: false }, 0.6).scheduled.length, 0);
result = timeline.update({ ...state, beat: 2, beatsPerSecond: 1 }, 0.7);
assert.equal(result.scheduled[0].durationSeconds, 2);
result = timeline.update({ ...state, beat: 2, beatsPerSecond: 4 }, 0.8);
assert.equal(result.scheduled[0].durationSeconds, 0.5);
assert.equal(timeline.update({ ...state, beatsPerSecond: -4 }, 0.9).scheduled.length, 0);
assert.equal(timeline.update({ ...state, beat: 16 }, 1).scheduled.length, 0);
result = timeline.update({ ...state, beat: 0, lastBeat: 1 }, 1.1);
assert.equal(result.scheduled[0].durationSeconds, 0.5);
result = timeline.update({ ...state, beat: 0.1, lastBeat: 1 }, 3);
assert.equal(result.reset, true);
assert.ok(result.scheduled[0].durationSeconds < 0.5);
timeline.reset();
assert.equal(timeline.update(state, 4).scheduled.length, 1);
const robotSource = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const snapshotSource = robotSource.slice(robotSource.indexOf('function getTempoBpmAtBeat'),
  robotSource.indexOf('function notifyDrillTransport'));
const playback = { countIndex: 3, stepAccumulatorSeconds: 0.125, tempoMultiplier: 0.5, speedMultiplier: 1, playing: true };
const transportContext = vm.createContext({
  Math, globalPlayback: playback, COUNTS_PER_SECOND: 4,
  MARCHING_GAITS: [{ tempoFactor: 1 }, { tempoFactor: 2 }], selectedMarchingGait: 0,
  playbackTempoMap: null, repeatElapsed: null, getMaxCountIndex: () => 16, transportRevision: 7,
});
vm.runInContext(`${stripTypeScriptTypes(snapshotSource).replace(/export /g, '')}
globalThis.snapshot = getDrillTransportState;
globalThis.getTempoBpmAtBeat = getTempoBpmAtBeat;
globalThis.getSecondsBetweenBeats = getSecondsBetweenBeats;
globalThis.advanceBeatBySeconds = advanceBeatBySeconds;
globalThis.setDrillBeatPosition = setDrillBeatPosition;`, transportContext);
let snapshot = transportContext.snapshot();
assert.equal(snapshot.beat, 3.25);
assert.equal(snapshot.beatsPerSecond, 2);
assert.equal(snapshot.revision, 7);
playback.playing = false;
assert.equal(transportContext.snapshot().beat, 3.25, 'Pause preserves fractional MIDI beat position');
playback.playing = true;
assert.equal(transportContext.snapshot().beat, 3.25, 'Resume does not rewind the beat');
transportContext.setDrillBeatPosition(6.375);
playback.playing = false;
assert.equal(transportContext.snapshot().beat, 6.375, 'Fractional seek holds its exact position');
playback.playing = true;
assert.equal(transportContext.snapshot().beat, 6.375, 'Fractional seek resumes without phase offset');
transportContext.setDrillBeatPosition(3.25);
transportContext.playbackTempoMap = [{ beat: 0, bpm: 180 }, { beat: 4, bpm: 90 }];
snapshot = transportContext.snapshot();
assert.equal(snapshot.beat, 3.375);
assert.equal(snapshot.beatsPerSecond, 3);
assert.equal(transportContext.getTempoBpmAtBeat(4), 90);
assert.equal(transportContext.getTempoBpmAtBeat(3), 180);
transportContext.playbackTempoMap = [{ beat: 0, bpm: 120 }, { beat: 0.5, bpm: 60 }];
assert.equal(transportContext.getSecondsBetweenBeats(0, 1), 0.75);
assert.equal(transportContext.advanceBeatBySeconds(0, 1, 0.625), 0.875);
assert.equal(transportContext.advanceBeatBySeconds(1, 0, 0.625), 0.25);
transportContext.playbackTempoMap = null;
transportContext.selectedMarchingGait = 1;
playback.speedMultiplier = 2;
snapshot = transportContext.snapshot();
assert.equal(snapshot.beat, 3.5);
assert.equal(snapshot.beatsPerSecond, 8);
playback.speedMultiplier = -2;
assert.equal(transportContext.snapshot().beat, 2.5);
playback.countIndex = 0;
assert.equal(transportContext.snapshot().beat, 0);
playback.countIndex = 16;
playback.speedMultiplier = 2;
assert.equal(transportContext.snapshot().beat, 16);
const playbackSource = readFileSync(new URL('../src/audio/midiPlayback.ts', import.meta.url), 'utf8');
const urlReaderSource = playbackSource.slice(playbackSource.indexOf('async function readMidiUrl'),
  playbackSource.indexOf('async function loadMidi('));
let response = new Response(midi.toArray());
const urlContext = vm.createContext({
  URL, AbortSignal, Uint8Array, Number, Error,
  window: { location: { href: 'https://chartxr.example/' } },
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  fetch: async () => response,
});
vm.runInContext(`${stripTypeScriptTypes(urlReaderSource)}
globalThis.readUrl = readMidiUrl;`, urlContext);
const downloaded = await urlContext.readUrl('https://music.example/public.mid');
assert.equal(new Midi(new Uint8Array(downloaded)).tracks.length, 1);
await assert.rejects(() => urlContext.readUrl('file:///private.mid'), /Only http and https/);
response = new Response('missing', { status: 404 });
await assert.rejects(() => urlContext.readUrl('https://music.example/missing.mid'), /HTTP 404/);
response = new Response('large', { headers: { 'content-length': String(11 * 1024 * 1024) } });
await assert.rejects(() => urlContext.readUrl('https://music.example/large.mid'), /10 MB/);
response = new Response(new Uint8Array(10 * 1024 * 1024 + 1));
await assert.rejects(() => urlContext.readUrl('https://music.example/stream.mid'), /10 MB/);
const example = new Midi(readFileSync(new URL('../src/assets/liberty-bell-band.mid', import.meta.url)));
assert.equal(example.header.tempos[0].bpm, 180.00018000018);
const bandTracks = example.tracks.filter(track => track.notes.length);
assert.equal(bandTracks.length, 20);
assert.ok(bandTracks.some(track => track.instrument.percussion));
assert.ok(bandTracks.some(track => track.instrument.number === 56), 'Full band includes trumpet/cornet');
assert.ok(bandTracks.some(track => track.instrument.number === 58), 'Full band includes tuba');
assert.ok(bandTracks.some(track => track.instrument.number === 71), 'Full band includes clarinet');
assert.ok(bandTracks.some(track => track.instrument.number === 73), 'Full band includes flute');
const bandNotes = bandTracks.flatMap(track => track.notes.map(note => ({
  beat: note.ticks / example.header.ppq, duration: note.durationTicks / example.header.ppq,
  pitch: note.midi, velocity: note.velocity, program: track.instrument.number,
  percussion: track.instrument.percussion,
})));
assert.ok(bandNotes.length < 100000);
assert.ok(bandNotes.every(note => Number.isFinite(note.beat) && note.beat >= 0 &&
  Number.isFinite(note.duration) && note.duration > 0 && Number.isInteger(note.pitch) &&
  note.pitch >= 0 && note.pitch <= 127 && note.velocity > 0 && note.velocity <= 1));
bandNotes.sort((a, b) => a.beat - b.beat);
const bandTimeline = new context.MidiTimeline(bandNotes);
const bandPlan = bandTimeline.update({ ...state, lastBeat: 636 }, 0);
assert.ok(bandPlan.scheduled.some(scheduled => scheduled.note.program === 56));
const firstDrumBeat = bandNotes.find(note => note.percussion).beat;
const drumPlan = bandTimeline.update({ ...state, beat: firstDrumBeat, lastBeat: 636, revision: 1 }, 1);
assert.ok(drumPlan.scheduled.some(scheduled => scheduled.note.percussion));
assert.ok(playbackSource.includes("../assets/liberty-bell-band.mid?url"), 'Startup loads the verified full-band MIDI');
console.log('MIDI sync checks passed: parser round-trip, beat alignment, no duplicate notes, seek into held notes, pause/resume, tempo, fast-forward, reverse mute, drill-end cutoff, drift recovery, and reload.');
console.log('MIDI URL checks passed: download parsing, scheme validation, HTTP errors, declared and streamed size limits, and bundled public-domain music.');
