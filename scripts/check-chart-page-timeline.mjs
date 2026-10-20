import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const read = name => readFileSync(new URL(`../src/robot/${name}.ts`, import.meta.url), 'utf8');
const transform = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const marcher = { position: Vector3.Zero(), rotation: { y: 0 }, computeWorldMatrix() {}, isDisposed: () => false };
const state = { counts: Array.from({ length: 25 }, (_, index) => ({
  position: new Vector3(index, 0, 0), rotationY: Math.PI / 2,
})) };
const players = new Map([[marcher, state]]);
let accepted = true;
const context = vm.createContext({
  Vector3, players, allRobots: new Set([marcher]),
  getMaxCountIndex: () => 24, tryManualMarcherPoses: () => accepted,
  invalidateLegBake() {}, applyGlobalCountToAllRobots() {}, recalculateCollisionMarkers() {},
});
vm.runInContext(transform(read('chartPageTimeline')), context);
context.setChartPageTimeline({ beatsPerPage: 8, authoredCounts: [0, 24] });
assert.deepEqual(Array.from(context.getChartPageCounts(24)), [0, 8, 16, 24]);
assert.equal(context.isAuthoredChartPage(8, 24), false);
const source = read('robot');
vm.runInContext(transform(source.slice(source.indexOf('function clearBakedCountGaits('),
  source.indexOf('function getGaitStepPhaseOffsets('))), context);
const start = source.indexOf('export function setRobotSetPoses(');
const end = source.indexOf('// Transition library:', start);
assert.ok(start >= 0 && end > start);
vm.runInContext(transform(source.slice(start, end)), context);
assert.equal(context.setRobotSetPoses(8, [{ robot: marcher, position: new Vector3(4, 0, 8) }], 0, 16, {}), true);
assert.equal(context.isAuthoredChartPage(8, 24), true, 'Editing a generated page promotes it');
assert.ok(state.counts[0].position.equals(Vector3.Zero()), 'Opening authored position stays fixed');
assert.ok(state.counts[24].position.equals(new Vector3(24, 0, 0)), 'Final authored position stays fixed');
assert.ok(state.counts[4].position.equals(new Vector3(2, 0, 4)), 'Earlier counts lerp to the promoted page');
assert.ok(state.counts[16].position.equals(new Vector3(14, 0, 4)), 'Intermediate page is regenerated, not treated as an anchor');
context.setRobotSetPoses(16, [{ robot: marcher, position: new Vector3(20, 0, 8) }], 8, 24, {});
assert.ok(state.counts[8].position.equals(new Vector3(4, 0, 8)), 'Promoted page remains fixed during subsequent edits');
assert.equal(context.isAuthoredChartPage(16, 24), true);
context.setChartPageTimeline({ beatsPerPage: 6, authoredCounts: [0, 8, 16, 24] });
assert.deepEqual(Array.from(context.getChartPageCounts(24)), [0, 6, 8, 12, 16, 18, 24], 'Authored off-grid pages are retained');
context.insertChartPageTimeline(8, 6);
assert.deepEqual(Array.from(context.getChartPageTimeline().authoredCounts), [0, 8, 14, 22, 30], 'Insertion shifts later anchors by its beat duration');
const saved = context.getChartPageTimeline();
saved.authoredCounts.push(99);
assert.equal(context.getChartPageTimeline().authoredCounts.includes(99), false, 'Callers cannot mutate stored anchors');
assert.throws(() => context.setChartPageTimeline({ beatsPerPage: 0, authoredCounts: [] }));
assert.throws(() => context.setChartPageTimeline({ beatsPerPage: 8, authoredCounts: [-1] }));
context.setChartPageTimeline({ beatsPerPage: 8, authoredCounts: [0, 24] });
accepted = false;
const before = state.counts.map(count => count.position.clone());
assert.equal(context.setRobotSetPoses(8, [{ robot: marcher, position: new Vector3(5, 0, 5) }], 0, 16, {}), false);
assert.equal(context.isAuthoredChartPage(8, 24), false, 'Rejected edits do not promote generated pages');
assert.ok(state.counts.every((count, index) => count.position.equals(before[index])));
accepted = true;
Object.assign(context, { blankChartPage: null, getGlobalCountIndex: () => 8,
  setRobotHeld() {}, applyGlobalCount() {}, sharedScene: null, heldRobots: new Set() });
const placeStart = source.indexOf('export function placeRobot(');
const placeEnd = source.indexOf('// Directly overrides one marching step', placeStart);
vm.runInContext(transform(source.slice(placeStart, placeEnd)), context);
const endPosition = state.counts[24].position.clone();
assert.ok(context.placeRobot(marcher, new Vector3(6, 0, 3), {}).equals(Vector3.Zero()),
  'Chart-aware grab placement edits the current page without translating the full route');
assert.ok(state.counts[24].position.equals(endPosition));
assert.equal(context.isAuthoredChartPage(8, 24), true);
const facingStart = source.indexOf('export function setPlacedMarcherFacing(');
const facingEnd = source.indexOf('// Read-only view', facingStart);
vm.runInContext(transform(source.slice(facingStart, facingEnd)), context);
context.setPlacedMarcherFacing(marcher, Math.PI / 3);
assert.equal(state.counts[8].facingY, Math.PI / 3);
assert.equal(state.counts[24].facingY, undefined, 'Guide facing does not change other authored pages');
const snapshotStart = source.indexOf('export function captureMarcherMovement(');
const snapshotEnd = source.indexOf('export function clearRobotPath(', snapshotStart);
vm.runInContext(transform(source.slice(snapshotStart, snapshotEnd)), context);
const snapshot = context.captureMarcherMovement(marcher);
context.setRobotSetPoses(16, [{ robot: marcher, position: new Vector3(9, 0, 2) }], 8, 24, {});
assert.equal(context.isAuthoredChartPage(16, 24), true);
context.restoreMarcherMovement(marcher, snapshot);
assert.equal(context.isAuthoredChartPage(16, 24), false, 'Undo restores generated versus authored status');
vm.runInContext(transform(read('chartPageDraft')), context);
const draft = {
  version: 1, savedAt: 'now', beat: 8, tempoBpm: 120, page: null, drafting: null,
  transition: { shape: 'straight', pace: 'even', styleIndex: null },
  marchers: [{ instrument: 'snare', gait: 0, rest: false, color: [1, 1, 1], step: 0.625,
    counts: [{ p: [0, 0, 0], r: 0 }] }],
  timeline: { beatsPerPage: 6, authoredCounts: [0, 8, 24] },
};
const parsed = context.parseChartPageDraft(context.serializeChartPageDraft(draft));
assert.deepEqual(JSON.parse(JSON.stringify(parsed.timeline)), draft.timeline);
draft.timeline.beatsPerPage = 0;
assert.throws(() => context.serializeChartPageDraft(draft), 'Invalid saved page intervals are rejected');
console.log('Chart page timeline passed: automatic pages, authored anchors, promotion, exact lerps, fixed endpoints, interval changes, insertion, rejected edits, and draft persistence.');
