import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import initSqlJs from 'sql.js';

const context = vm.createContext({
  Float64Array, Uint8Array, DataView, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream,
});
const run = source => vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^export /gm, ''), context);
run(readFileSync(new URL('../src/robot/openChartFormat.ts', import.meta.url), 'utf8'));
const format = context;
const SQL = await initSqlJs();
// Keep the compatibility reader's private constants out of the native format scope.
const reader = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(readFileSync(new URL('../src/robot/openMarchFormat.ts', import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^export /gm, ''), reader);
const dotsBytes = new Uint8Array(readFileSync(new URL('../src/assets/openmarch/example-show.dots', import.meta.url)));
const imported = reader.readOpenMarchDatabase(SQL, dotsBytes, 53.333);
const show = format.convertToOpenChart(imported, 'Example show', 53.333);
const encoded = await format.encodeOpenChart(show);
const bundledBytes = new Uint8Array(readFileSync(new URL('../src/assets/openmarch/example-show.openchart', import.meta.url)));
const roundTrip = await format.decodeOpenChart(encoded);
const bundled = await format.decodeOpenChart(bundledBytes);
const bundledRoutes = { ...bundled,
  marchers: bundled.marchers.map(({ performance, instrument, ...route }) => route) };
assert.deepEqual(JSON.parse(JSON.stringify(bundledRoutes)), JSON.parse(JSON.stringify(roundTrip)),
  'The full native startup asset retains compatibility metadata and exact route coordinates');
assert.ok(bundled.marchers.every(marcher => marcher.performance && marcher.instrument),
  'The native startup asset includes an instrument and full baked schedule for every marcher');
assert.equal(roundTrip.name, show.name);
assert.equal(roundTrip.tempoBpm, 120);
assert.equal(roundTrip.widthYards, 53.333);
assert.equal(roundTrip.pages.length, 17);
assert.equal(roundTrip.marchers.length, 40);
assert.equal(format.getOpenChartLastCount(roundTrip), 768);
assert.equal(roundTrip.timing.ppq, 480);
assert.equal(roundTrip.timing.countTicks[768], 768 * 480);
const customTiming = {
  ppq: 960,
  countTicks: Array.from({ length: 769 }, (_, count) => count * 720 + (count % 2 ? 120 : 0)),
  tempos: [{ tick: 0, bpm: 120 }, { tick: 360, bpm: 96 }, { tick: 12345, bpm: 144 }],
};
assert.deepEqual((await format.decodeOpenChart(await format.encodeOpenChart({ ...show, timing: customTiming }))).timing,
  vm.runInContext(`(${JSON.stringify(customTiming)})`, context),
  'Independent tick positions, non-quarter pulse spacing, PPQ and off-beat tempo changes round-trip exactly');
for (let index = 0; index < imported.tracks.length; index++) {
  const marcher = roundTrip.marchers[index];
  assert.deepEqual(marcher.positions, show.marchers[index].positions, 'Float64 coordinates round-trip without precision loss');
  assert.equal(marcher.label, imported.marchers[index].label);
  assert.equal(marcher.section, imported.marchers[index].section);
  imported.tracks[index].forEach((point, count) => {
    assert.equal(marcher.positions[count * 2], point.x);
    assert.equal(marcher.positions[count * 2 + 1], point.z);
  });
}
const jsonBytes = new TextEncoder().encode(JSON.stringify(imported)).length;
assert.ok(encoded.length < jsonBytes, 'Packed native show is smaller than equivalent object-based JSON');
const padded = new Uint8Array(encoded.length + 11);
padded.set(encoded, 7);
assert.equal((await format.decodeOpenChart(padded.subarray(7, 7 + encoded.length))).name, show.name,
  'Readers honor input byte offsets');

const rawFile = encoded;
assert.equal(new TextDecoder().decode(rawFile.subarray(0, 8)), 'OCHART13');
assert.equal(rawFile.length, 16 + new DataView(rawFile.buffer).getUint32(8, true) +
  new DataView(rawFile.buffer).getUint32(12, true), 'Entire file is stored without compression');
const metadataSize = new DataView(rawFile.buffer).getUint32(8, true);
const payloadStart = 16 + metadataSize;
const originalMetadata = JSON.parse(new TextDecoder().decode(rawFile.subarray(16, payloadStart)));
function withMetadata(change) {
  const data = structuredClone(originalMetadata);
  change(data);
  const json = new TextEncoder().encode(JSON.stringify(data));
  const bytes = new Uint8Array(16 + json.length + rawFile.length - payloadStart);
  bytes.set(rawFile.subarray(0, 8));
  new DataView(bytes.buffer).setUint32(8, json.length, true);
  new DataView(bytes.buffer).setUint32(12, rawFile.length - payloadStart, true);
  bytes.set(json, 16);
  bytes.set(rawFile.subarray(payloadStart), 16 + json.length);
  return bytes;
}
for (const [label, bytes] of [
  ['truncated header', encoded.slice(0, 11)],
  ['unknown version', Uint8Array.from(rawFile, (value, index) => index === 7 ? 57 : value)],
  ['truncated payload', encoded.slice(0, -1)],
  ['trailing bytes', Uint8Array.from([...rawFile, 0])],
  ['zero tempo', withMetadata(data => { data.tempoBpm = 0; })],
  ['zero PPQ', withMetadata(data => { data.timing.ppq = 0; })],
  ['fractional PPQ', withMetadata(data => { data.timing.ppq = 480.5; })],
  ['SMPTE PPQ bit', withMetadata(data => { data.timing.ppq = 32768; })],
  ['missing timing', withMetadata(data => { data.timing = {}; })],
  ['missing count tick', withMetadata(data => { data.timing.countTicks.pop(); })],
  ['unordered count ticks', withMetadata(data => { data.timing.countTicks[2] = 1; })],
  ['fractional tick', withMetadata(data => { data.timing.countTicks[1] = 1.5; })],
  ['nonzero count origin', withMetadata(data => { data.timing.countTicks[0] = 1; })],
  ['nonzero tempo origin', withMetadata(data => { data.timing.tempos[0].tick = 1; })],
  ['unordered tempo ticks', withMetadata(data => { data.timing.tempos.push({ tick: 0, bpm: 120 }); })],
  ['invalid MIDI tempo', withMetadata(data => { data.timing.tempos[0].bpm = 0; })],
  ['wrong coordinate units', withMetadata(data => { data.widthYards = -1; })],
  ['too many count samples', withMetadata(data => { data.marchers[0].counts = 1e9; })],
  ['fractional count length', withMetadata(data => { data.marchers[0].counts = 1.5; })],
  ['pages out of order', withMetadata(data => { data.pages.reverse(); })],
  ['negative page', withMetadata(data => { data.pages[0].count = -1; })],
  ['page past end', withMetadata(data => { data.pages.at(-1).count = 9999; })],
  ['invalid marcher metadata', withMetadata(data => { data.marchers[0].label = -1; })],
  ['numeric show name', withMetadata(data => { data.name = 0; })],
  ['numeric page notes', withMetadata(data => { data.pages[0].notes = 0; })],
  ['unknown instrument code', withMetadata(data => { data.marchers[0].instrument = 99; })],
]) {
  await assert.rejects(() => format.decodeOpenChart(bytes), /Invalid OpenChart/, label);
}
function withPayload(payload) {
  const bytes = new Uint8Array(payloadStart + payload.length);
  bytes.set(rawFile.subarray(0, payloadStart));
  new DataView(bytes.buffer).setUint32(12, payload.length, true);
  bytes.set(payload, payloadStart);
  return bytes;
}
const rawCoordinates = rawFile.subarray(payloadStart);
const notFinite = Buffer.from(rawCoordinates);
notFinite.writeDoubleLE(NaN, 0);
await assert.rejects(() => format.decodeOpenChart(withPayload(notFinite)), /non-finite/);
await assert.rejects(() => format.decodeOpenChart(withPayload(rawCoordinates.subarray(0, -8))), /payload length/);
await assert.rejects(() => format.decodeOpenChart(withPayload(Buffer.concat([rawCoordinates, Buffer.alloc(8)]))),
  /payload length/, 'Payload cannot exceed the declared sample count');
const oversized = rawFile.slice();
new DataView(oversized.buffer).setUint32(8, 0xffffffff, true);
await assert.rejects(() => format.decodeOpenChart(oversized), /oversized/);
const overflow = Buffer.concat([rawFile, Buffer.alloc(8)]);
await assert.rejects(() => format.decodeOpenChart(overflow), /payload length/);
const oversizedPayload = rawFile.slice();
new DataView(oversizedPayload.buffer).setUint32(12, 0xffffffff, true);
await assert.rejects(() => format.decodeOpenChart(oversizedPayload), /oversized payload/);
const badJson = rawFile.slice();
badJson[16] = 0xff;
await assert.rejects(() => format.decodeOpenChart(badJson), /UTF-8 JSON/);
const uneven = {
  ...show,
  name: 'Unicode \u266b show',
  pages: [{ name: 'Opening', count: 0, notes: 'A \u00e9 note' }],
  marchers: [
    { ...show.marchers[0], instrument: 'trumpet', positions: new Float64Array([0, 1]) },
    { ...show.marchers[1], positions: new Float64Array([2, 3, 4, 5]) },
  ],
};
const unevenRoundTrip = await format.decodeOpenChart(await format.encodeOpenChart(uneven));
assert.equal(unevenRoundTrip.name, uneven.name);
assert.equal(unevenRoundTrip.pages[0].notes, uneven.pages[0].notes);
assert.equal(unevenRoundTrip.marchers[0].instrument, 'trumpet');
assert.equal(format.getOpenChartLastCount(unevenRoundTrip), 1, 'Mixed route lengths are preserved');
await assert.rejects(() => format.encodeOpenChart({ ...uneven, marchers: [] }), /marchers/);
await assert.rejects(() => format.encodeOpenChart({
  ...uneven, marchers: [{ ...uneven.marchers[0], positions: new Float64Array([0, Infinity]) }],
}), /finite/);

let sqliteLoads = 0;
Object.assign(context, {
  FIELD_WIDTH_YARDS: 53.333,
  loadSqlJs: async () => { sqliteLoads++; return SQL; },
  compatibilityReader: reader.readOpenMarchDatabase,
});
const loader = readFileSync(new URL('../src/robot/openMarchUrl.ts', import.meta.url), 'utf8');
run(loader.slice(loader.indexOf('export async function decodeDrillFile'), loader.indexOf('export async function loadDrillFromUrl'))
  .replace('import("./openMarchFormat")', 'Promise.resolve({ readOpenMarchDatabase: compatibilityReader })'));
await context.decodeDrillFile(encoded, 'ignored');
assert.equal(sqliteLoads, 0, 'Native loading does not initialize or download SQLite');
for (const version of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']) {
  const outdated = rawFile.slice();
  outdated.set(new TextEncoder().encode(version), 6);
  assert.equal(context.isOpenChartFile(outdated), false);
  await assert.rejects(() => context.decodeDrillFile(outdated, 'Old'), /Only version 13/);
}
assert.equal(sqliteLoads, 0, 'Unsupported native versions never load SQLite');
const converted = await context.decodeDrillFile(dotsBytes, 'Imported');
assert.equal(sqliteLoads, 1, 'SQLite is used only at the OpenMarch boundary');
assert.equal(converted.name, 'Imported');
assert.deepEqual(converted.marchers[0].positions, show.marchers[0].positions);
await assert.rejects(() => context.decodeDrillFile(new Uint8Array([1, 2, 3]), 'Bad'), /not a supported/);
assert.equal(sqliteLoads, 1, 'Unknown files do not load SQLite');
console.log(`OpenChart format checks passed: exact coordinates, metadata, native startup, lazy compatibility import, corrupt input rejection. Native ${encoded.length} bytes vs JSON ${jsonBytes} and SQLite ${dotsBytes.length}.`);
