import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import midiPackage from '@tonejs/midi';

const context = vm.createContext({});
const source = readFileSync(new URL('../src/audio/midiNotation.ts', import.meta.url), 'utf8');
vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, '')}
globalThis.api = { quantizeScoreNote, scoreMeasureCount, scoreMeasure, scorePitch, scoreBeatPositions, scoreBeatPositionsMulti };`, context);
const { quantizeScoreNote, scoreMeasureCount, scoreMeasure, scorePitch, scoreBeatPositions, scoreBeatPositionsMulti } = context.api;
const track = notes => ({ name: 'Test', percussion: false, notes });
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(quantizeScoreNote(0.13, 0.01, 60)), { start: 1, end: 2, pitch: 60 });
assert.equal(scorePitch(60).key, 'c/4');
assert.equal(scorePitch(61).accidental, '#');
assert.equal(scorePitch(0).key, 'c/-1');
assert.equal(scorePitch(127).key, 'g/9');
assert.deepEqual(plain(scoreMeasure(track([]), 0)), [{ ticks: 16, pitches: [], tiedPitches: [] }]);
const crossing = track([quantizeScoreNote(3.5, 2, 60)]);
assert.equal(scoreMeasureCount(crossing), 2);
assert.deepEqual(plain(scoreMeasure(crossing, 1)[0]), { ticks: 4, pitches: [60], tiedPitches: [60] });
const chord = track([quantizeScoreNote(0, 2, 60), quantizeScoreNote(1, 1, 64)]);
assert.deepEqual(plain(scoreMeasure(chord, 0)), [
  { ticks: 4, pitches: [60], tiedPitches: [] },
  { ticks: 4, pitches: [60, 64], tiedPitches: [60] },
  { ticks: 8, pitches: [], tiedPitches: [] },
]);
const repeated = track([quantizeScoreNote(0, 1, 60), quantizeScoreNote(1, 1, 60)]);
assert.deepEqual(plain(scoreMeasure(repeated, 0)[1].tiedPitches), []);
const overlapping = track([quantizeScoreNote(0, 2, 60), quantizeScoreNote(1, 1, 60)]);
assert.deepEqual(plain(scoreMeasure(overlapping, 0)[1].tiedPitches), []);
assert.deepEqual(plain(scoreBeatPositions(scoreMeasure(track([]), 0), [100], 740)), [100, 260, 420, 580]);
assert.deepEqual(plain(scoreBeatPositions(scoreMeasure(chord, 0), [100, 260, 500], 740)), [100, 260, 500, 620]);
assert.throws(() => scoreBeatPositions([], [], 740), /incomplete beat spacing/);
assert.deepEqual(plain(scoreBeatPositionsMulti([{ segments: scoreMeasure(chord, 0), notePositions: [100, 260, 500] }], 100, 740)), [100, 260, 500, 620]);
assert.deepEqual(plain(scoreBeatPositionsMulti([
  { segments: [{ ticks: 16, pitches: [60], tiedPitches: [] }], notePositions: [120] },
  { segments: [{ ticks: 4, pitches: [48], tiedPitches: [] }, { ticks: 4, pitches: [50], tiedPitches: [] }, { ticks: 4, pitches: [52], tiedPitches: [] }, { ticks: 4, pitches: [53], tiedPitches: [] }], notePositions: [120, 260, 400, 540] },
], 120, 740)), [120, 260, 400, 540]);
assert.throws(() => scoreBeatPositionsMulti([], 100, 740), /incomplete beat spacing/);
const midi = new midiPackage.Midi(readFileSync(new URL('../src/assets/stars-and-stripes.mid', import.meta.url)));
for (const midiTrack of midi.tracks.filter(t => t.notes.length)) {
  const scoreTrack = track(midiTrack.notes.map(note =>
    quantizeScoreNote(note.ticks / midi.header.ppq, note.durationTicks / midi.header.ppq, note.midi)));
  for (let measure = 0; measure < scoreMeasureCount(scoreTrack); measure++) {
    const segments = scoreMeasure(scoreTrack, measure);
    assert.equal(segments.reduce((sum, segment) => sum + segment.ticks, 0), 16);
    let tick = measure * 16;
    for (const segment of segments) {
      const expected = [...new Set(scoreTrack.notes
        .filter(note => note.start <= tick && note.end > tick).map(note => note.pitch))].sort((a, b) => a - b);
      assert.deepEqual(plain(segment.pitches), expected);
      tick += segment.ticks;
    }
  }
}
// Check measure-per-page dynamic sizing logic for full score and individual tracks
function calcMeasuresPerPage(trackCount, standScale, measuresConfig) {
  if (typeof measuresConfig === 'number') {
    return Math.max(1, Math.min(8, measuresConfig));
  }
  if (trackCount <= 1) {
    if (standScale >= 1.4) return 6;
    if (standScale <= 0.8) return 2;
    return 4;
  }
  if (trackCount <= 4) {
    if (standScale >= 1.25) return 4;
    if (standScale <= 0.8) return 1;
    return 2;
  }
  if (standScale >= 1.5) return 2;
  return 1;
}

// 2-track full score (e.g. Sousa march)
assert.equal(calcMeasuresPerPage(2, 1.0, 'auto'), 2, 'Default 1.0x scale shows 2 measures in full score');
assert.equal(calcMeasuresPerPage(2, 1.3, 'auto'), 4, 'Sized up 1.3x scale shows 4 measures (8 staves)');
assert.equal(calcMeasuresPerPage(2, 0.7, 'auto'), 1, 'Sized down 0.7x scale shows 1 measure (large print)');
assert.equal(calcMeasuresPerPage(2, 1.0, 4), 4, 'Explicit 4 measures override shows 4 measures');
assert.equal(calcMeasuresPerPage(2, 1.5, 1), 1, 'Explicit 1 measure override shows 1 measure');
// 1-track score
assert.equal(calcMeasuresPerPage(1, 1.0, 'auto'), 4, 'Single track at 1.0x scale shows 4 measures');
assert.equal(calcMeasuresPerPage(1, 1.5, 'auto'), 6, 'Single track at 1.5x scale shows 6 measures');

console.log('MIDI notation checks passed: quantization, pitch spelling, rests, chords, ties, repeated attacks, bar crossings, measure pagination scaling, and every measure of the bundled Sousa MIDI.');
