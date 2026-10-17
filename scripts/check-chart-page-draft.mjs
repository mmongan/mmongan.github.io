import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const draftSource = read('robot/chartPageDraft.ts');
const robot = read('robot/robot.ts');
const path = read('interaction/pathInteraction.ts');
const pad = read('menu/drillChartPad.ts');
const html = read('index.html');

const context = vm.createContext({ JSON, Math, Number, Array, Set, Error });
vm.runInContext(stripTypeScriptTypes(draftSource).replace(/export /g, '') +
  '\nglobalThis.api = { serializeChartPageDraft, parseChartPageDraft, roundVector, CHART_PAGE_DRAFT_KEY };', context);
const { serializeChartPageDraft, parseChartPageDraft, roundVector, CHART_PAGE_DRAFT_KEY } = context.api;

assert.equal(CHART_PAGE_DRAFT_KEY, 'chartxr.chartPageDraft');
assert.deepEqual([...roundVector(1.234567, 0, -2.00001)], [1.2346, 0, -2]);

const draft = {
  version: 1,
  savedAt: '2026-01-01T00:00:00.000Z',
  beat: 8,
  tempoBpm: 144,
  transition: { shape: 'sCurve', pace: 'ease', styleIndex: null },
  page: { count: 8, previous: 0, next: 16, waiting: [1] },
  marchers: [
    { instrument: 'trumpet', gait: 0, rest: false, color: [1, 0.5, 0], step: 0.625, label: 'T1',
      counts: [{ p: [0, 0, 0], r: 0 }, { p: [1, 0, 2], r: 0.5, f: 1, s: 2 }] },
    { instrument: 'snare', gait: 1, rest: true, color: [0, 0, 1], step: 0.625, fixed: Math.PI,
      counts: [{ p: [5, 0, 5], r: 0 }] },
  ],
  drafting: null,
};
const json = serializeChartPageDraft(draft);
assert.deepEqual(JSON.parse(JSON.stringify(parseChartPageDraft(json))), draft, 'round trip keeps every field');

const broken = mutate => {
  const copy = JSON.parse(json);
  mutate(copy);
  return () => parseChartPageDraft(JSON.stringify(copy));
};
assert.throws(() => parseChartPageDraft('not json'), /invalid: not JSON/);
assert.throws(broken(d => { d.version = 2; }), /unsupported version/);
assert.throws(broken(d => { d.marchers = []; }), /non-empty/);
assert.throws(broken(d => { d.marchers[0].counts[0].p = [0, 0]; }), /three numbers/);
assert.throws(broken(d => { d.marchers[0].counts[1].s = 1.5; }), /whole count/);
assert.throws(broken(d => { d.marchers[0].step = 0; }), /positive/);
assert.throws(broken(d => { d.page.waiting = [2]; }), /distinct saved marchers/);
assert.throws(broken(d => { d.page.waiting = [1, 1]; }), /distinct saved marchers/);
assert.throws(broken(d => { d.page.previous = 9; }), /out of order/);
assert.throws(broken(d => { d.tempoBpm = -1; }), /tempo must be positive/);
assert.equal(parseChartPageDraft(JSON.stringify({ ...draft, page: null })).page, null);

// Robot side: exact schedules and the blank page are captured and reopened.
assert.match(robot, /export function captureMarcherSchedules\(\)/);
assert.match(robot, /waiting: \[\.\.\.page\.pending\.keys\(\), \.\.\.page\.claimed\]/);
assert.match(robot, /export function restoreMarcherSchedule\([\s\S]*?players\.set\(robot, \{[\s\S]*?fixedFacingY: snapshot\.fixedFacingY/);
assert.match(robot, /export function resumeBlankChartPage\([\s\S]*?seekToCount\(count\);\s*openBlankChartPage\(/);
assert.match(robot, /seekToCount\(count\);\s*openBlankChartPage\(count, at,/, 'insert and resume share the page opener');

// Wiring: Save/Resume on the chart pad, Settings, and the menu dispatcher.
assert.match(pad, /label: "Save", name: "saveDraft"[\s\S]*?drillChartSaveDraft/);
assert.match(pad, /label: "Resume", name: "resumeDraft"[\s\S]*?drillChartResumeDraft/);
assert.match(pad, /distance < nearestDistance/, 'nearest chart-pad button wins overlapping touch margins');
assert.match(html, /id="saveChartDraftButton"/);
assert.match(html, /id="resumeChartDraftButton"/);
assert.match(path, /case "drillChartSaveDraft":\s*saveChartPageDraft\(\);/);
assert.match(path, /case "drillChartResumeDraft":\s*resumeChartPageDraft\(\);/);
assert.match(path, /if \(marcherGrabs\.size > 0\)[\s\S]*?Release the grabbed marcher before saving/);
assert.match(path, /localStorage\.setItem\(CHART_PAGE_DRAFT_KEY, serializeChartPageDraft\(draft\)\)/);
const resume = path.slice(path.indexOf('function resumeChartPageDraft'), path.indexOf('saveChartDraftButton?.addEventListener'));
assert.ok(resume.indexOf('parseChartPageDraft') < resume.indexOf('clearAllRobots()'), 'validate before clearing the field');
assert.ok(resume.indexOf('MARCHER_INSTRUMENTS') < resume.indexOf('clearAllRobots()'), 'instruments validated before clearing');
assert.match(resume, /resumeBlankChartPage\(\{ \.\.\.draft\.page, waiting: draft\.page\.waiting\.map\(\(index\) => robots\[index\]\) \}, scene\)/);
assert.match(resume, /importDrawingWorkspace\(draft\.drafting\)/);

console.log('chart page draft checks passed');
