import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
const formatSource = readFileSync(new URL('../src/robot/openChartFormat.ts', import.meta.url), 'utf8');
const run = (source, context) => vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^export /gm, ''), context);
let selected = 'flute';
let cleared = 0;
let plays = 0;
let sought;
let timeline;
let download;
let blankPage = null;
const revoked = [];
const errors = [];
const robots = [];
const status = { value: '', classList: { toggle() {} } };
class Vector3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
}
class Color3 {
  constructor(r, g, b) { this.r = r; this.g = g; this.b = b; }
}
const context = vm.createContext({
  Float64Array, Uint8Array, DataView, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream,
  Vector3, Color3, FIELD_SURFACE_Y: 0.1, FIELD_WIDTH_YARDS: 53.333, scene: {}, pathRoot: {},
  showMarcherInfo: new WeakMap(), chartPageNames: new Map(), chartPageNotes: new Map(),
  robotPaths: new Map(), marcherGrabs: new Map(), openMarchStatus: status,
  openMarchButton: { disabled: false }, openMarchExampleButton: { disabled: false },
  MARCHER_INSTRUMENTS: ['trumpet', 'flute'],
  MARCHING_GAITS: [{ name: 'Auto' }, { name: 'Side Step' }],
  console: { warn: (...args) => errors.push(args) },
  URL: {
    createObjectURL: blob => { download = blob; return 'blob:show'; },
    revokeObjectURL: url => revoked.push(url),
  },
  window: { setTimeout: callback => callback() },
  document: {
    body: { append() {} },
    createElement: () => ({ click() {}, remove() {} }),
  },
  getSelectedInstrument: () => selected,
  setSelectedInstrument: value => { selected = value; },
  getOpenMarchSectionInstrument: () => 'trumpet',
  clearAllRobots: () => { cleared++; robots.length = 0; context.robotPaths.clear(); },
  forgetOtherChartPageGuides() {},
  createLowPolyRobot: (_scene, gaitIndex = 0) => {
    const robot = { instrument: selected, gaitIndex, instrumentRestPose: false, color: new Color3(0.2, 0.4, 0.6), stepSizeYards: 0.625 };
    robots.push(robot);
    return robot;
  },
  updateRobotPathLine() {},
  walkRobotAlongCounts: (robot, path) => {
    robot.counts = path.map(position => ({ position, rotationY: 0 }));
  },
  restoreMarcherSchedule: (robot, snapshot) => { Object.assign(robot, snapshot); },
  setMarchTempo: tempo => Math.max(60, Math.min(120, tempo)),
  restoreDrillMidiTiming: timing => { context.savedTiming = timing; },
  captureDrillMidiTiming: lastCount => ({
    ppq: 960, countTicks: Array.from({ length: lastCount + 1 }, (_, index) => index * 720),
    tempos: [{ tick: 0, bpm: 96 }, { tick: 360, bpm: 108 }],
  }),
  seekToCount: count => { sought = count; },
  playAll: () => { plays++; },
  refreshCollisionMarkers() {},
  setDrillLabels: (_scene, _root, labels) => labels.forEach(({ robot, label }) => { robot.label = label; }),
  getDrillLabel: robot => robot.label,
  setShowInfo: (_name, show) => assert.ok(show.marchers[0].positions instanceof Float64Array),
  getChartPageTimeline: () => ({ beatsPerPage: 8 }),
  setChartPageTimeline: value => { timeline = value; },
  refreshChartEditorPages() {},
  getBlankChartPageState: () => blankPage,
  captureBakedMarcherSchedules: () => robots.map(robot => ({
    robot, counts: robot.counts.map((count, index) => ({
      ...count,
      stepPhase: count.stepPhase ?? index + 0.25,
      bakedGait: count.bakedGait === undefined ? {
        gaitIndex: robot.gaitIndex, stepsPerCount: 1, bodyYaw: count.facingY ?? count.rotationY,
        legYawOffset: 0, inPlace: false, sideways: false, label: 'Auto',
      } : count.bakedGait,
    })),
    instrument: robot.instrument, gaitIndex: robot.gaitIndex, instrumentRestPose: robot.instrumentRestPose,
    color: robot.color, stepSizeYards: robot.stepSizeYards, fixedFacingY: robot.fixedFacingY,
  })),
  getMarchTempo: () => 96,
  getDrillChartSetCounts: () => timeline.authoredCounts,
});
run(formatSource, context);
run(readFileSync(new URL('../src/robot/openChartPerformance.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, ''), context);
vm.runInContext('let currentShowName = "OpenChart show";', context);
const start = source.indexOf('function spawnOpenChartDrill(');
const end = source.indexOf('export function initInteraction()', start);
assert.ok(start >= 0 && end > start);
run(source.slice(start, end), context);
const show = {
  name: 'Imported show', tempoBpm: 96, widthYards: 53.333,
  pages: [{ name: 'Opening', count: 0, notes: 'Start here' }, { name: '1A', count: 2, notes: 'Subset' }],
  marchers: [{
    label: 'T1', name: 'Alice', section: 'Trumpet', notes: 'Solo',
    positions: new Float64Array([0, 1, 2, 3, 4, 5]),
  }],
};
assert.equal(await context.openDrill(async () => show), true);
assert.equal(cleared, 1);
assert.equal(robots.length, 1);
assert.equal(selected, 'flute', 'Import restores the instrument picker');
assert.equal(robots[0].instrument, 'trumpet', 'Imported sections resolve to an app-native instrument');
assert.equal(robots[0].label, 'T1');
assert.equal(robots[0].counts[2].position.x, 4);
assert.equal(robots[0].counts[2].position.z, 5);
assert.equal(robots[0].counts[2].position.y, 0.1);
assert.equal(sought, 0);
assert.equal(plays, 0, 'Loading leaves playback paused at the opening count');
assert.match(status.value, /Imported show: 1 marchers, 2 pages, 2 counts at 96 BPM/);
const before = robots[0];
for (const bad of [
  { ...show, widthYards: 42 },
  { ...show, marchers: [{ ...show.marchers[0], instrument: 'invalid-instrument' }] },
  { ...show, marchers: [{ ...show.marchers[0], positions: new Float64Array([NaN, 0]) }] },
]) {
  assert.equal(await context.openDrill(async () => bad), false);
  assert.equal(robots[0], before, 'Invalid data never clears the current show');
  assert.equal(cleared, 1);
}
assert.equal(errors.length, 3, 'Import failures are both visible and logged');

robots[0].counts[1].position.x = 7.25;
robots[0].counts[1].position.y = 0.75;
robots[0].counts[1].rotationY = -0.8;
robots[0].counts[1].facingY = 1.2;
robots[0].counts[1].styleIndex = 1;
robots[0].counts[1].bakedGait = {
  gaitIndex: 1, stepsPerCount: 2, bodyYaw: 1.3, legYawOffset: 0.4,
  inPlace: false, sideways: true, label: 'Sideways double time',
};
robots[0].counts[2].bakedGait = null;
robots[0].instrument = 'flute';
robots[0].gaitIndex = 1;
robots[0].instrumentRestPose = true;
robots[0].color = new Color3(0.8, 0.2, 0.1);
robots[0].stepSizeYards = 0.4;
robots[0].fixedFacingY = -0.7;
await context.saveOpenChartRoutes();
assert.ok(download instanceof Blob);
const saved = await context.decodeOpenChart(new Uint8Array(await download.arrayBuffer()));
assert.equal(saved.name, show.name);
assert.equal(saved.timing.ppq, 960);
assert.deepEqual([...saved.timing.countTicks], [0, 720, 1440]);
assert.equal(saved.timing.tempos[1].tick, 360);
assert.equal(saved.marchers[0].positions[2], 7.25, 'Export captures edited routes rather than the original import');
assert.equal(saved.marchers[0].instrument, 'flute');
assert.equal(saved.marchers[0].performance.instrumentPose, 'carry');
assert.equal(saved.marchers[0].name, 'Alice');
assert.equal(saved.marchers[0].notes, 'Solo');
assert.equal(saved.pages[1].notes, 'Subset');
assert.equal(saved.pages[1].name, '1A');
assert.equal(revoked.at(-1), 'blob:show', 'Download URLs are released');
const beforeUnknownGait = robots[0];
assert.equal(await context.openDrill(async () => ({
  ...saved, marchers: saved.marchers.map(marcher => ({
    ...marcher, performance: {
      ...marcher.performance, gait: 'Unknown step',
      gaits: marcher.performance.gaits.map(() => 'Unknown step'),
    },
  })),
})), false);
assert.equal(robots[0], beforeUnknownGait, 'Unknown named steps are rejected before clearing the live scene');
assert.equal(await context.openDrill(async () => saved), true);
assert.deepEqual(context.savedTiming, saved.timing, 'Import restores PPQ, independent ticks and tempo changes');
assert.equal(robots[0].instrument, 'flute', 'Explicit native instruments survive reimport');
assert.equal(robots[0].counts[1].position.x, 7.25);
assert.equal(robots[0].counts[1].position.y, 0.75);
assert.equal(robots[0].counts[1].rotationY, -0.8);
assert.equal(robots[0].counts[1].stepPhase, 1.25);
assert.equal(robots[0].footfalls, undefined);
assert.equal(robots[0].counts[1].facingY, 1.2);
assert.equal(robots[0].counts[1].styleIndex, 1);
assert.equal(robots[0].counts[1].bakedGait.stepsPerCount, 2);
assert.equal(robots[0].counts[1].bakedGait.bodyYaw, 1.3);
assert.equal(robots[0].counts[1].bakedGait.legYawOffset, 0.4);
assert.equal(robots[0].counts[1].bakedGait.sideways, true);
assert.equal(robots[0].counts[1].bakedGait.label, 'Sideways double time');
assert.equal(robots[0].counts[2].bakedGait, null, 'Final halt stays explicit');
assert.equal(robots[0].gaitIndex, 1);
assert.equal(robots[0].instrumentRestPose, true);
assert.equal(robots[0].stepSizeYards, 0.4);
assert.equal(robots[0].fixedFacingY, -0.7);
assert.equal(robots[0].color.r, 0.8);
assert.equal(robots[0].color.g, 0.2);
assert.equal(robots[0].color.b, 0.1);
assert.equal(plays, 0);
download = undefined;
blankPage = {};
await context.saveOpenChartRoutes();
assert.equal(download, undefined, 'Incomplete blank pages cannot be exported as completed routes');
assert.match(status.value, /Finish the open blank page/);
blankPage = null;

let resolveOld;
const old = context.openDrill(() => new Promise(resolve => { resolveOld = resolve; }));
await context.openDrill(async () => ({ ...show, name: 'Newer show' }));
const latest = robots[0];
resolveOld(show);
assert.equal(await old, false);
assert.equal(robots[0], latest, 'Stale async imports cannot overwrite a newer show');
assert.equal(context.openMarchButton.disabled, false);
assert.match(status.value, /Newer show/);
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
assert.match(html, /id="openChartFile"[^>]*accept="\.openchart,\.dots"/);
assert.match(html, /id="saveOpenChartButton"/);
assert.match(source, /openChartFileInput\?\.addEventListener\("change"/);
assert.match(source, /saveOpenChartButton\?\.addEventListener\("click", saveOpenChartRoutes\)/);
console.log('OpenChart integration checks passed: paused scene loading, metadata/instruments, atomic rejection, edited route export, native reimport, blank-page guard and stale request handling.');
