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
const midi = new midiPackage.Midi(readFileSync(new URL('../src/assets/liberty-bell-band.mid', import.meta.url)));
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
const layoutSource = readFileSync(new URL('../src/audio/scoreLayout.ts', import.meta.url), 'utf8');
vm.runInContext(`${stripTypeScriptTypes(layoutSource, { mode: 'transform' }).replace(/export /g, '')}
globalThis.layoutApi = { scoreMeasuresPerPage, layoutScorePage };`, context);
const { scoreMeasuresPerPage: calcMeasuresPerPage, layoutScorePage } = context.layoutApi;

// 2-track full score (e.g. Sousa march)
assert.equal(calcMeasuresPerPage(2, 1.0, 'auto'), 2, 'Default 1.0x scale shows 2 measures in full score');
assert.equal(calcMeasuresPerPage(2, 1.3, 'auto'), 4, 'Sized up 1.3x scale shows 4 measures (8 staves)');
assert.equal(calcMeasuresPerPage(2, 0.7, 'auto'), 1, 'Sized down 0.7x scale shows 1 measure (large print)');
assert.equal(calcMeasuresPerPage(2, 1.0, 4), 4, 'Explicit 4 measures override shows 4 measures');
assert.equal(calcMeasuresPerPage(2, 1.5, 1), 1, 'Explicit 1 measure override shows 1 measure');
// 1-track score
assert.equal(calcMeasuresPerPage(1, 1.0, 'auto'), 4, 'Single track at 1.0x scale shows 4 measures');
assert.equal(calcMeasuresPerPage(1, 1.5, 'auto'), 6, 'Single track at 1.5x scale shows 6 measures');
assert.equal(calcMeasuresPerPage(20, 1, 'auto'), 3, 'Full band fills the pad with three measures across');
assert.equal(calcMeasuresPerPage(20, 1.5, 'auto'), 5, 'A larger pad shows more full-band measures');
assert.equal(calcMeasuresPerPage(20, 1, 8), 8, 'Eight-measure overview is available');
assert.equal(calcMeasuresPerPage(20, 1, 1), 1, 'Large-print override remains available');
const fullBandLayout = layoutScorePage([1940, 1940, 1940]);
assert.equal(fullBandLayout.columns, 3);
assert.ok(fullBandLayout.cells[0].width * 3 / 1456 > 0.88, 'Full score occupies over 88% of available width');
assert.ok(fullBandLayout.cells[0].height / 1110 > 0.97, 'Full score fills available height');
for (const heights of [[150, 150, 150, 150], [1940, 1900, 1920, 1940], [1940], [], Array(8).fill(1940)]) {
  const layout = layoutScorePage(heights);
  assert.equal(layout.cells.length, heights.length);
  for (const cell of layout.cells) {
    assert.ok(cell.x >= 0 && cell.y >= 0);
    assert.ok(cell.x + cell.width <= 1456 + 1e-6);
    assert.ok(cell.y + cell.height + cell.labelHeight <= 1110 + 1e-6);
  }
  for (let a = 0; a < layout.cells.length; a++) {
    for (let b = a + 1; b < layout.cells.length; b++) {
      const x = layout.cells[a], y = layout.cells[b];
      assert.ok(x.x + x.width <= y.x + 1e-6 || y.x + y.width <= x.x + 1e-6 ||
        x.y + x.height + x.labelHeight <= y.y + 1e-6 ||
        y.y + y.height + y.labelHeight <= x.y + 1e-6, 'Measures must not overlap');
    }
  }
}

console.log('MIDI notation checks passed: quantization, pitch spelling, rests, chords, ties, repeated attacks, bar crossings, measure pagination scaling, and every measure of the bundled Sousa MIDI.');
