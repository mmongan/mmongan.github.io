import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure.js';
import initSqlJs from 'sql.js';

const read = name => readFileSync(new URL(`../src/robot/${name}.ts`, import.meta.url), 'utf8');
const robotSource = read('robot');
const slice = (start, end) => robotSource.slice(robotSource.indexOf(start), robotSource.indexOf(end, robotSource.indexOf(start)));
const robot = { isDisposed: () => false, isEnabled: () => true };
const parts = { gaitIndex: 0, instrument: 'trumpet', instrumentRestPose: true };
const state = {
  stepSizeYards: 0.5, fixedFacingY: Math.PI / 2,
  counts: Array.from({ length: 5 }, (_, count) => ({
    position: new Vector3(0, 0.1 + count / 10, count / 4),
    rotationY: 0, facingY: Math.PI / 2,
  })),
};
let musicBeat = 0;
let applications = 0;
const players = new Map([[robot, state]]);
const context = vm.createContext({
  Vector3, Color3, Float64Array, Uint8Array, DataView, TextEncoder, TextDecoder,
  Blob, Response, CompressionStream, DecompressionStream,
  players, allRobots: new Set([robot]), marcherParts: new Map([[robot, parts]]),
  DEFAULT_STEP_SIZE_YARDS: 0.625, playbackBeatUnits: [],
  playbackPpq: 480, playbackCountTicks: [],
  blankChartPage: null, getGlobalCountIndex: () => 0,
  repeatOptions: { songLength: 0 }, getMusicTransportState: () => ({ beat: musicBeat }),
  getDrillTransportState: () => ({ beat: 0 }),
  midiPulseAtBeat: beat => beat, midiBeatAtPulse: pulse => pulse,
  getRobotColor: () => new Color3(0.2, 0.6, 0.8),
  ensureSharedObserver() {}, invalidateLegBake() {},
  setMarcherInstrument() {}, setMarcherInstrumentRestPose() {}, setRobotColor() {},
  applyGlobalCount: () => { applications++; },
});
const run = source => vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, ''), context);
run(read('gaitSelection'));
run(readFileSync(new URL('../src/audio/drillMidiTiming.ts', import.meta.url), 'utf8'));
context.buildGaitStepPhaseOffsets = steps => {
  const result = [0];
  steps.forEach(step => result.push(result.at(-1) + step));
  return result;
};
run(slice('export const MARCHING_GAITS =', 'let selectedMarchingGait'));
run(slice('const GAIT_INDEX_BY_NAME =', '// The gait a marcher uses leaving'));
run(slice('export function captureMarcherSchedules()', 'export function captureBlankChartPage('));
run(slice('export function restoreMarcherSchedule(', '// Reopens a saved blank page:'));
run(slice('function applyFixedFacing(', 'export function getRobotFixedFacing('));
run(slice('export function setPlacedMarcherFacing(', '// Read-only view'));
run(read('openChartFormat'));
run(read('openChartPerformance'));
const gaitNames = vm.runInContext('MARCHING_GAITS.map(gait => gait.name)', context);
const index = name => gaitNames.indexOf(name);
parts.gaitIndex = index('Field March');
assert.ok(parts.gaitIndex >= 0);
state.counts[2].styleIndex = index('Mark Time');
const before = JSON.stringify(state.counts);
const expected = state.counts.map((_, count) => context.resolveSegmentGait(state, count, parts.gaitIndex));
const baked = context.captureBakedMarcherSchedules()[0];
assert.equal(JSON.stringify(state.counts), before, 'Export baking never edits the live route');
baked.counts.forEach((count, i) => assert.deepEqual(count.bakedGait, expected[i]));
assert.equal(baked.counts.at(-1).bakedGait, null, 'An ended auto route halts explicitly');
assert.equal(baked.counts[2].bakedGait.gaitIndex, index('Mark Time'), 'Authored gait overrides are resolved');
assert.equal(baked.counts[0].styleIndex, undefined, 'Inherited styles remain editable as defaults');
assert.equal(baked.counts[0].stepPhase, 0);
assert.ok(baked.counts[4].stepPhase > baked.counts[1].stepPhase);
const performance = context.packOpenChartPerformance(baked, gaitNames);
const show = {
  name: 'Named steps', tempoBpm: 96, widthYards: 53.333,
  pages: [{ name: 'Start', count: 0, notes: '' }, { name: 'Finish', count: 4, notes: '' }],
  marchers: [
    { label: 'T1', name: 'Solo', notes: '', section: 'Trumpet', instrument: 'trumpet',
      positions: Float64Array.from(baked.counts.flatMap(count => [count.position.x, count.position.z])), performance },
    { label: 'T2', name: 'Solo', notes: '', section: 'Trumpet', instrument: 'trumpet',
      positions: Float64Array.from(baked.counts.flatMap(count => [count.position.x + 5, count.position.z])), performance },
  ],
};
const bytes = await context.encodeOpenChart(show);
const rawFile = bytes;
assert.equal(new TextDecoder().decode(rawFile.subarray(0, 8)), 'OCHART13');
const metadataSize = new DataView(rawFile.buffer).getUint32(8, true);
const metadata = JSON.parse(new TextDecoder().decode(rawFile.subarray(16, 16 + metadataSize)));
assert.deepEqual(Object.keys(metadata).sort(), ['marchers', 'name', 'pages', 'tempoBpm', 'timing', 'widthYards']);
assert.deepEqual(Object.keys(metadata.timing).sort(), ['countTicks', 'ppq', 'tempos']);
assert.deepEqual(Object.keys(metadata.timing.tempos[0]).sort(), ['bpm', 'tick']);
assert.deepEqual(Object.keys(metadata.pages[0]).sort(), ['count', 'name', 'notes']);
assert.deepEqual(Object.keys(metadata.marchers[0]).sort(),
  ['counts', 'instrument', 'label', 'name', 'notes', 'performance', 'section']);
assert.deepEqual(Object.keys(metadata.marchers[0].performance).sort(),
  ['color', 'fixedFacingY', 'gait', 'gaits', 'instrumentPose', 'movementDescriptions', 'stepSizeYards']);
// Existing v2 files use the same binary data and expanded indexed metadata.
const oldJson = new TextEncoder().encode(JSON.stringify(metadata));
const oldPayload = rawFile.subarray(16 + metadataSize);
const oldBytes = new Uint8Array(16 + oldJson.length + oldPayload.length);
oldBytes.set(new TextEncoder().encode('OCHART02'));
new DataView(oldBytes.buffer).setUint32(8, oldJson.length, true);
new DataView(oldBytes.buffer).setUint32(12, oldPayload.length, true);
oldBytes.set(oldJson, 16);
oldBytes.set(oldPayload, 16 + oldJson.length);
await assert.rejects(() => context.decodeOpenChart(oldBytes), /unsupported signature or version/,
  'Version 2 files are rejected');
oldBytes[7] = '1'.charCodeAt(0);
await assert.rejects(() => context.decodeOpenChart(oldBytes), /unsupported signature or version/,
  'Version 1 files are rejected');
assert.equal('strings' in metadata, false, 'No per-file string table');
assert.equal(metadata.name, show.name);
assert.equal(metadata.pages[0].name, 'Start');
assert.equal(metadata.marchers[0].name, 'Solo');
assert.equal(metadata.marchers[1].name, 'Solo', 'Custom strings are stored in place');
assert.equal(metadata.marchers[0].instrument, 0, 'Instrument zero is trumpet');
assert.equal(metadata.marchers[0].performance.gait, 0, 'Gait zero independently means Field March');
assert.equal(metadata.marchers[0].performance.instrumentPose, 1, 'Pose one is carry');
assert.equal(context.decodeBuiltin(0, vm.runInContext('OPEN_CHART_POSE_CODES', context), 'pose'), 'playing');
assert.equal(typeof metadata.marchers[0].instrument, 'number');
assert.equal(typeof metadata.marchers[0].performance.gait, 'number');
assert.equal(typeof metadata.marchers[0].performance.instrumentPose, 'number');
assert.ok(metadata.marchers[0].performance.gaits.every(Number.isInteger));
assert.ok(metadata.marchers[0].performance.movementDescriptions.every(value => Number.isInteger(value) || typeof value === 'string'));
const decoded = await context.decodeOpenChart(bytes);
assert.equal(decoded.marchers[0].performance.instrumentPose, 'carry');
assert.deepEqual(decoded.marchers[0].performance.samples, performance.samples);
assert.equal('footfalls' in decoded.marchers[0].performance, false);
assert.equal('footfalls' in metadata.marchers[0].performance, false);
const restored = context.unpackOpenChartPerformance(decoded.marchers[0].performance, gaitNames);
assert.equal(restored.counts[3].stepPhase, baked.counts[3].stepPhase);
assert.equal('footfalls' in restored, false);
const restoredState = {
  stepSizeYards: performance.stepSizeYards,
  counts: restored.counts.map(({ height, ...count }, i) => ({ ...count, position: new Vector3(0, height, i / 4) })),
};
// Changing the clock or auto-gait rules cannot change a baked schedule.
musicBeat = 40;
const select = context.selectAutoGait;
context.selectAutoGait = () => { throw new Error('Baked playback must not infer a gait'); };
for (let i = 0; i < restoredState.counts.length; i++) {
  assert.deepEqual(context.resolveSegmentGait(restoredState, i, restored.gaitIndex), expected[i]);
}
const reversedNames = [...gaitNames].reverse();
const remapped = context.unpackOpenChartPerformance(performance, reversedNames);
assert.equal(reversedNames[remapped.gaitIndex], 'Field March', 'Defaults resolve by name, not runtime list position');
assert.equal(reversedNames[remapped.counts[2].bakedGait.gaitIndex], 'Mark Time');
assert.throws(() => context.unpackOpenChartPerformance(performance, ['Field March']), /Unknown OpenChart gait/);
const malformedMetadata = async mutate => {
  const copy = structuredClone(metadata);
  mutate(copy);
  const json = new TextEncoder().encode(JSON.stringify(copy));
  const payload = rawFile.subarray(16 + metadataSize);
  const corrupt = new Uint8Array(16 + json.length + payload.length);
  corrupt.set(rawFile.subarray(0, 8));
  const header = new DataView(corrupt.buffer);
  header.setUint32(8, json.length, true);
  header.setUint32(12, payload.length, true);
  corrupt.set(json, 16);
  corrupt.set(payload, 16 + json.length);
  await assert.rejects(() => context.decodeOpenChart(corrupt), /Invalid OpenChart/);
};
await malformedMetadata(data => { data.marchers[0].performance.gait = -1; });
await malformedMetadata(data => { data.marchers[0].performance.gaits[0] = 99; });
await malformedMetadata(data => { data.marchers[0].performance.movementDescriptions[0] = 1.5; });
await malformedMetadata(data => { data.marchers[0].performance.instrumentPose = 2; });
await malformedMetadata(data => { data.marchers[0].instrument = 17; });
await malformedMetadata(data => { data.marchers[0].performance.gait = 12; });
const customNames = ['Custom step', ...gaitNames.slice(1)];
const customPerformance = {
  ...performance, gait: 'Custom step', gaits: customNames,
  movementDescriptions: ['0', ...performance.movementDescriptions.slice(1)],
};
const customShow = { ...show, name: '0', marchers: [{
  ...show.marchers[0], instrument: 'Custom instrument', performance: customPerformance,
}] };
const customDecoded = await context.decodeOpenChart(await context.encodeOpenChart(customShow));
assert.equal(customDecoded.name, '0', 'Numeric-looking text stays text');
assert.equal(customDecoded.marchers[0].instrument, 'Custom instrument');
assert.equal(customDecoded.marchers[0].performance.gait, 'Custom step');
assert.equal(customDecoded.marchers[0].performance.movementDescriptions[0], '0');
assert.equal(context.unpackOpenChartPerformance(customDecoded.marchers[0].performance, customNames).gaitIndex, 0);
context.selectAutoGait = select;

// Baking twice preserves the already resolved performance.
players.set(robot, restoredState);
assert.deepEqual(context.captureBakedMarcherSchedules()[0].counts.map(count => count.bakedGait),
  restoredState.counts.map(count => count.bakedGait));
context.setRobotFacing(robot, 0);
assert.ok(restoredState.counts.every(count => count.bakedGait === undefined), 'Editing facing invalidates the old resolved gait');
assert.ok(restoredState.counts.every(count => count.stepPhase === undefined), 'Editing clears stored step phase too');
assert.equal(restoredState.counts[2].styleIndex, index('Mark Time'), 'Edits retain authored style overrides');
assert.equal(restoredState.counts[0].styleIndex, undefined);
restoredState.counts.forEach(count => { count.bakedGait = expected[0]; });
context.setPlacedMarcherFacing(robot, 0.4);
assert.ok(restoredState.counts.every(count => count.bakedGait === undefined));
assert.equal(applications, 2);
const invalid = async mutate => {
  const copy = {
    ...show, marchers: [{ ...show.marchers[0], performance: {
      ...performance, samples: performance.samples.slice(),
    } }],
  };
  mutate(copy.marchers[0].performance);
  await assert.rejects(() => context.encodeOpenChart(copy), /Invalid OpenChart/);
};
await invalid(p => { p.samples = p.samples.slice(0, -1); });
await invalid(p => { p.samples[0] = NaN; });
await invalid(p => { p.samples[3] = 9999; });
await invalid(p => { p.samples[4] = -2; });
await invalid(p => { p.samples[5] = 0; });
await invalid(p => { p.samples[8] = 16; });
await invalid(p => { p.samples[9] = -1; });
await invalid(p => { p.instrumentPose = 'unknown'; });
await invalid(p => { p.color = [2, 0, 0]; });
await invalid(p => { p.stepSizeYards = -1; });
await invalid(p => { p.fixedFacingY = Infinity; });
console.log('OpenChart performance checks passed: actual gait resolution, explicit halts, named step/pose indices, exact baked round trips, list reordering, playback without inference, editing invalidation and invalid payload rejection.');

// Bake the bundled fixture through the same registration and capture code as a fresh app import.
const reader = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(read('openMarchFormat'), { mode: 'transform' })
  .replace(/^export /gm, ''), reader);
const SQL = await initSqlJs();
const example = context.convertToOpenChart(reader.readOpenMarchDatabase(SQL,
  new Uint8Array(readFileSync(new URL('../src/assets/openmarch/example-show.dots', import.meta.url))), 53.333),
  'Example show', 53.333);
run(read('openMarchUrl').slice(read('openMarchUrl').indexOf('const SECTION_INSTRUMENTS')));
run(readFileSync(new URL('../src/field/constants.ts', import.meta.url), 'utf8'));
const fieldSurfaceY = vm.runInContext('FIELD_SURFACE_Y', context);
run(slice('const ROBOT_COLOR_GOLDEN_ANGLE_DEGREES =', 'export function setRobotColor('));
run(slice('export function registerRobotCounts(', '// Same as walkRobotAlongPath'));
context.recalculateCollisionMarkers = () => {};
players.clear();
context.allRobots.clear();
context.marcherParts.clear();
musicBeat = 0;
example.marchers.forEach(marcher => {
  const robot = { isDisposed: () => false, isEnabled: () => true };
  marcher.instrument = context.getOpenMarchSectionInstrument(marcher.section, 'trumpet');
  context.allRobots.add(robot);
  context.marcherParts.set(robot, {
    gaitIndex: index('Field March'), instrument: marcher.instrument, instrumentRestPose: false,
  });
  context.fixtureRobot = robot;
  vm.runInContext('robotColors.set(fixtureRobot, nextRobotColor())', context);
  const positions = Array.from({ length: marcher.positions.length / 2 }, (_, count) =>
    new Vector3(marcher.positions[count * 2], fieldSurfaceY, marcher.positions[count * 2 + 1]));
  context.registerRobotCounts(robot, positions, {});
});
context.captureBakedMarcherSchedules().forEach((schedule, index) => {
  example.marchers[index].performance = context.packOpenChartPerformance(schedule, gaitNames);
});
const exampleBytes = await context.encodeOpenChart(example);
const exampleUrl = new URL('../src/assets/openmarch/example-show.openchart', import.meta.url);
if (process.argv.includes('--write-example')) writeFileSync(exampleUrl, exampleBytes);
const storedExampleBytes = new Uint8Array(readFileSync(exampleUrl));
const storedExample = await context.decodeOpenChart(storedExampleBytes);
assert.deepEqual(storedExampleBytes, exampleBytes, 'Bundled full schedules match a fresh app-default bake exactly');
assert.equal(storedExample.marchers.length, 40);
let sampleCount = 0;
storedExample.marchers.forEach(marcher => {
  assert.ok(marcher.performance, 'Every bundled marcher includes full baked performance');
  assert.equal(marcher.performance.samples.length, marcher.positions.length / 2 * 11);
  const restored = context.unpackOpenChartPerformance(marcher.performance, gaitNames);
  assert.equal(restored.counts.at(-1).bakedGait, null, 'The final count stores an explicit halt');
  assert.ok(restored.counts.every(count => Number.isFinite(count.stepPhase)));
  sampleCount += restored.counts.length;
});
console.log(`Bundled full OpenChart verified: ${storedExample.marchers.length} marchers, ${sampleCount} baked count samples, ${exampleBytes.length} bytes.`);
