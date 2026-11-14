// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Drill-first drafting: a drafted guide applied as the marchers' positions in
// an authored drill set through the selection editor's atomic set transaction.
// Covers the drafting workspace destination stepping, slot distribution and
// ordering along the guide, facing modes, height preservation, desktop
// gating, atomic collision rejection, and too-short/empty-set messages.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const compile = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

const engine = new NullEngine();
const scene = new Scene(engine);
const root = new TransformNode('field', scene);

// Four marchers with authored counts 0..16 (sets at 0, 8 and 16).
const robots = [0, 1, 2, 3].map(index => {
  const robot = new TransformNode('pathRobot', scene);
  robot.parent = root;
  robot.position.set(index, 0.125, 0);
  return robot;
});
const makeCounts = x => Array.from({ length: 17 }, (_, count) =>
  ({ position: new Vector3(x, 0.125, count * 0.5), rotationY: 0 }));
// Previous-set (count 0) X order is intentionally shuffled: 2, -5, 7, 0.
const schedules = new Map([
  [robots[0], makeCounts(2)],
  [robots[1], makeCounts(-5)],
  [robots[2], makeCounts(7)],
  [robots[3], makeCounts(0)],
]);

class Control extends EventTarget {
  checked = false;
  value = '';
  replaceChildren() {}
}
const selectionMode = new Control(), setEditMode = new Control(), editSet = new Control();
const calibration = new Control();
const selectionStatus = { textContent: '' };
const transport = new Observable();
let immersive = false, playing = true, beat = -1, pov = true, prepared = 0;
let acceptPoses = true;
const transactions = [];
const fakeElement = () => ({ value: '', textContent: '', addEventListener() {}, classList: { add() {} },
  setAttribute() {}, append() {}, namespaceURI: 'svg', querySelector: () => ({ addEventListener() {} }) });
const context = vm.createContext({
  scene, engine, Mesh, MeshBuilder, TransformNode, Matrix, Vector3, Color3, Observable, Event,
  FIELD_SURFACE_Y: 0.1,
  DESKTOP_PLAYBACK_NOTICE: 'Desktop is playback-only at 1:1. Enter immersive VR/AR to edit the drill.',
  isDrillEditingEnabled: () => immersive,
  canvas: { addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
    setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} },
  drillSelectionMode: selectionMode, drillSetEditMode: setEditMode, drillEditSet: editSet,
  drillSelectionStatus: selectionStatus, selectionEditor: fakeElement(),
  drillShapeInputs: {}, drillShapeKind: { value: 'line' },
  formationMoveX: { value: '0' }, formationMoveZ: { value: '0' },
  formationRotation: { value: '0' }, formationScale: { value: '1' },
  gridSnapX: { value: '0.625' }, gridSnapZ: { value: '0.625' }, gridSnapInterval: { value: 'custom' },
  floorCalibrationToggle: calibration,
  getRobotCounts: robot => schedules.get(robot) ?? null,
  pauseAll: () => { playing = false; },
  seekToCount: count => { beat = count; },
  setRobotSetPoses: (count, poses, previousCount, nextCount) => {
    if (!acceptPoses) return false;
    // Array.from in this realm: the vm's own arrays fail deepStrictEqual.
    transactions.push({ count, previousCount, nextCount,
      poses: Array.from(poses, pose => ({ robot: pose.robot, position: pose.position.clone(), facingY: pose.facingY })) });
    return true;
  },
  tryManualMarcherPoses: () => true,
  setMarcherPOVEnabled: enabled => { pov = enabled; },
  createFieldChartMode: () => ({ setPages() {}, clear() {} }),
  onDrillTransportChangedObservable: transport,
  HTMLButtonElement: class {}, HTMLElement: class {},
  window: { addEventListener() {} },
  document: { createElement: () => fakeElement(), createElementNS: () => fakeElement(),
    body: { append() {} } },
});
for (const file of ['interaction/drillEditing', 'interaction/drillShapes',
  'interaction/guideMarcherLayout', 'interaction/selectionEditor']) {
  vm.runInContext(compile(read(`../src/${file}.ts`)), context);
}
const editor = context.createSelectionEditor({
  root,
  getMarchers: () => robots.filter(robot => !robot.isDisposed()),
  getStandingForm: () => [],
  detachStandingMembers() {},
  changed() {},
  prepare: () => { prepared++; },
  notify() {},
  snap: point => point,
  snapAngle: angle => angle,
  constrain: delta => delta,
});
const line = (fromX, toX) => [new Vector3(fromX, 0.125, 0), new Vector3(toX, 0.125, 0)];
try {
  editor.setPages([{ name: 'A', count: 0 }, { name: 'B', count: 8 }, { name: 'C', count: 16 }]);

  // Desktop stays playback-only: nothing steps or applies outside immersive editing.
  assert.equal(editor.stepDestination(1), null);
  assert.ok(selectionStatus.textContent.includes('playback-only'), 'Desktop gating is explained');
  assert.equal(editor.applyGuideToSet(line(-6, 6), { spacing: 1.25, facing: 'along', facingAngle: 0 }), false);
  assert.equal(transactions.length, 0);
  assert.equal(selectionMode.checked, false, 'Desktop attempts do not enable editing modes');

  immersive = true;
  // First step enables set editing, pauses, and seeks to the destination.
  const label = editor.stepDestination(1);
  assert.ok(selectionMode.checked && setEditMode.checked, 'Workspace stepping enables authored-set editing');
  assert.equal(playing, false, 'Entering set editing pauses playback');
  assert.ok(prepared > 0, 'Entering set editing prepares other editing modes away');
  assert.equal(pov, false, 'Entering set editing exits marcher POV');
  assert.ok(label.includes('B') && label.includes('count 8') && label.includes('8 counts from A'),
    `Step label names the set, count, and transition length: ${label}`);
  assert.equal(beat, 8, 'Stepping seeks to the destination set');
  assert.ok(editor.destinationLabel().includes('count 8'), 'Status readout names the destination');
  assert.equal(editor.stepDestination(1), `set 3/3: C (count 16, 8 counts from B)`);
  assert.equal(editor.stepDestination(1), `set 3/3: C (count 16, 8 counts from B)`, 'Stepping clamps at the last set');
  editor.stepDestination(-1);
  assert.equal(beat, 8);

  // Applying a guide forms every destination marcher along it, ordered by
  // their previous-set projection so the form does not cross itself.
  assert.equal(editor.applyGuideToSet(line(-6, 6), { spacing: 1.25, facing: 'along', facingAngle: 0 }), true);
  assert.equal(transactions.length, 1);
  const applied = transactions[0];
  assert.equal(applied.count, 8);
  assert.equal(applied.previousCount, 0, 'Transitions rebuild from the previous set');
  assert.equal(applied.nextCount, 16, 'Transitions rebuild to the next set');
  assert.equal(applied.poses.length, 4, 'Without a selection, every destination marcher is formed');
  assert.deepEqual(applied.poses.map(pose => robots.indexOf(pose.robot)), [1, 3, 0, 2],
    'Marchers take slots in previous-set order along the guide');
  assert.deepEqual(applied.poses.map(pose => pose.position.x), [-6, -2, 2, 6],
    'Slots spread evenly along the guide including both endpoints');
  assert.ok(applied.poses.every(pose => Math.abs(pose.position.y - 0.125) < 1e-9),
    'Authored marcher heights are preserved');
  assert.ok(applied.poses.every(pose => Math.abs(pose.facingY - Math.PI / 2) < 1e-9),
    'Along-guide facing follows the guide tangent');
  assert.ok(selectionStatus.textContent.includes('Formed 4 marchers'), 'Success is reported');

  // Facing modes: reversed and fixed angles.
  editor.applyGuideToSet(line(-6, 6), { spacing: 1.25, facing: 'reverse', facingAngle: 0 });
  assert.ok(transactions[1].poses.every(pose => Math.abs(pose.facingY + Math.PI / 2) < 1e-9),
    'Reverse facing turns the form around');
  editor.applyGuideToSet(line(-6, 6), { spacing: 1.25, facing: 'fixed', facingAngle: 90 });
  assert.ok(transactions[2].poses.every(pose => Math.abs(pose.facingY - Math.PI / 2) < 1e-9),
    'Fixed facing uses the configured field angle');

  // A selection limits the form to the selected marchers.
  editor.select([robots[2], robots[0]]);
  assert.equal(editor.applyGuideToSet(line(0, 3), { spacing: 1.25, facing: 'along', facingAngle: 0 }), true);
  const subset = transactions[3];
  assert.equal(subset.poses.length, 2, 'A selection forms only the selected marchers');
  assert.deepEqual(subset.poses.map(pose => robots.indexOf(pose.robot)), [0, 2],
    'Selected marchers still order along the guide');
  assert.deepEqual(subset.poses.map(pose => pose.position.x), [0, 3]);

  // Atomic rejection leaves no transaction and explains the failure.
  acceptPoses = false;
  assert.equal(editor.applyGuideToSet(line(-6, 6), { spacing: 1.25, facing: 'along', facingAngle: 0 }), false);
  assert.ok(selectionStatus.textContent.includes('collisions'), 'Collision rejection is explained');
  acceptPoses = true;

  // Degenerate guides are refused before any transaction.
  const before = transactions.length;
  assert.equal(editor.applyGuideToSet(line(0, 0.001), { spacing: 1.25, facing: 'along', facingAngle: 0 }), false);
  assert.ok(selectionStatus.textContent.includes('too short'), 'Too-short guides are explained');
  assert.equal(transactions.length, before);

  // Closed guides spread marchers around the loop without duplicating the start.
  editor.select([]);
  const square = [new Vector3(-4, 0.125, -4), new Vector3(4, 0.125, -4), new Vector3(4, 0.125, 4),
    new Vector3(-4, 0.125, 4), new Vector3(-4, 0.125, -4)];
  assert.equal(editor.applyGuideToSet(square, { spacing: 1.25, facing: 'along', facingAngle: 0 }), true);
  const loop = transactions[transactions.length - 1];
  const keys = new Set(loop.poses.map(pose => `${pose.position.x},${pose.position.z}`));
  assert.equal(keys.size, 4, 'Closed guides never stack marchers on the shared start point');

  // Calibration blocks the transaction.
  calibration.checked = true;
  assert.equal(editor.applyGuideToSet(line(-6, 6), { spacing: 1.25, facing: 'along', facingAngle: 0 }), false);
  assert.ok(selectionStatus.textContent.includes('calibration'));
  calibration.checked = false;

  // Without authored sets there is no destination.
  editor.setPages([]);
  assert.equal(editor.stepDestination(1), null);
  assert.ok(selectionStatus.textContent.includes('authored sets'), 'Missing sets are explained');
  assert.equal(editor.applyGuideToSet(line(-6, 6), { spacing: 1.25, facing: 'along', facingAngle: 0 }), false);

  console.log('Guide-to-set checks passed: destination stepping with implicit set editing, pause/seek, ' +
    'ordered slot assignment with facing modes and preserved heights, selection subsets, atomic rejection, ' +
    'short/closed guides, calibration and desktop gating, and missing-set messages.');
} finally {
  scene.dispose();
  engine.dispose();
}
