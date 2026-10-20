import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import initSqlJs from 'sql.js';

const source = readFileSync(new URL('../src/robot/openMarchFormat.ts', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^export /gm, ''), context);
const SQL = await initSqlJs();
const spec = { level: 'highschool', widthYards: 53.333, hashOffsetYards: 8.8889 };
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `Expected ${expected}, received ${actual}`);
const linear = Array.from({ length: 9 }, (_, count) => ({ x: count / 2, z: -count }));
const curved = linear.map((point, count) => ({ ...point, z: point.z + (count % 4 === 2 ? 2 : 0) }));
const input = {
  tempoBpm: 96, setCounts: [8, 0, 4, 4], tracks: [linear, curved, []],
  marchers: [{ section: 'Trumpet', drillPrefix: 'T' }, { section: 'Trumpet', drillPrefix: 'T' }],
  pageNotes: ['Opening', 'Middle', 'Closing'],
};
const bytes = context.writeOpenMarchDatabase(SQL, input, spec);
const reopened = context.readOpenMarchDatabase(SQL, bytes, spec.widthYards);
near(reopened.tempoBpm, 96);
assert.deepEqual(plain(reopened.pages), [
  { name: '0', count: 0, notes: 'Opening' },
  { name: '1', count: 4, notes: 'Middle' },
  { name: '2', count: 8, notes: 'Closing' },
]);
assert.deepEqual(plain(reopened.marchers).map(marcher => marcher.label), ['T1', 'T2']);
for (const [index, track] of [linear, curved].entries()) {
  assert.equal(reopened.tracks[index].length, track.length);
  track.forEach((point, count) => {
    near(reopened.tracks[index][count].x, point.x);
    near(reopened.tracks[index][count].z, point.z);
  });
}
const db = new SQL.Database(bytes);
try {
  assert.equal(db.exec('PRAGMA foreign_key_check').length, 0);
  assert.equal(db.exec('SELECT COUNT(*) FROM midsets')[0].values[0][0], 6,
    'Only curved moves need intermediate dots');
  db.run("UPDATE workspace_settings SET json_data = ? WHERE id = 1", [JSON.stringify({ pageNumberOffset: 7 })]);
  db.run('UPDATE pages SET is_subset = 1 WHERE id > 0');
  const subsets = context.readOpenMarchDatabase(SQL, db.export(), spec.widthYards);
  assert.deepEqual(plain(subsets.pages).map(page => page.name), ['7', '7A', '7B']);
} finally {
  db.close();
}
const names = plain(context.getOpenMarchPageNames([false, ...Array(703).fill(true), false], 2));
for (const [index, suffix] of [[1, 'A'], [26, 'Z'], [27, 'AA'], [52, 'AZ'], [702, 'ZZ'], [703, 'AAA']]) {
  assert.equal(names[index], `2${suffix}`);
}
assert.equal(names.at(-1), '3');
const samples = plain(context.sampleKeyframes([
  { count: 1, point: { x: 2, z: 4 } },
  { count: 2.5, point: { x: 5, z: 1 } },
  { count: 4, point: { x: 8, z: 4 } },
], 5));
assert.deepEqual(samples, [
  { x: 2, z: 4 }, { x: 2, z: 4 }, { x: 4, z: 2 },
  { x: 6, z: 2 }, { x: 8, z: 4 }, { x: 8, z: 4 },
]);
assert.notEqual(samples[0], samples[1], 'Held positions are independent objects');
const example = context.readOpenMarchDatabase(SQL,
  readFileSync(new URL('../src/assets/openmarch/example-show.dots', import.meta.url)), spec.widthYards);
assert.equal(example.tracks.length, 40);
assert.equal(example.pages.length, 17);
assert.ok(example.tracks.every(track => track.length === 769));
console.log('OpenMarch format checks passed: round-trip, curved midsets, page timing/labels, fractional interpolation, schema integrity and bundled show.');
