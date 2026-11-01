// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const engine = new NullEngine(), scene = new Scene(engine);
const root = new TransformNode('field', scene);
root.position.set(3, 1, -2); root.scaling.setAll(.02); root.rotation.y = .7;
const schedules = new Map();
const players = Array.from({ length: 22 }, (_, index) => {
  const robot = new TransformNode(`football${index}`, scene); robot.parent = root;
  robot.position.set(index - 11, -.48, -10);
  const body = MeshBuilder.CreateSphere(`body${index}`, {}, scene); body.parent = robot; body.position.y = 1;
  schedules.set(robot, Array.from({ length: 17 }, (_, count) => ({
    position: new Vector3(index - 11 + (index === 0 ? 0 : Math.sin(count / 8)), -.48,
      -10 + (index === 0 ? 0 : count)), rotationY: 0,
  })));
  return robot;
});
let beat = 0, playing = false, blank = null, clearanceOffset = 0;
const listeners = new Set();
const toggle = { checked: false, addEventListener: (_, callback) => listeners.add(callback),
  removeEventListener: (_, callback) => listeners.delete(callback) };
const calibration = { checked: false }, status = { value: '' };
const context = vm.createContext({
  Mesh, MeshBuilder, VertexData, TransformNode, StandardMaterial, InstancedMesh, Color3, Matrix, Quaternion, Vector3, scene,
  FIELD_SURFACE_Y: -.48, footballFutureGhosts: toggle, footballFutureStatus: status,
  floorCalibrationToggle: calibration, getRobotCounts: robot => schedules.get(robot),
  getDrillTransportState: () => ({ beat, playing }), getBlankChartPageState: () => blank,
  getFootballPlaybackPosition: (robot, count) => {
    const position = schedules.get(robot)?.[count]?.position;
    return clearanceOffset && position ? { x: position.x + clearanceOffset, z: position.z } : null;
  },
});
const compile = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
vm.runInContext(compile(readFileSync(new URL('../src/robot/marcherGhost.ts', import.meta.url), 'utf8')), context);
const chart = readFileSync(new URL('../src/robot/fieldChartMode.ts', import.meta.url), 'utf8');
vm.runInContext(compile(chart.slice(chart.indexOf('export function buildChartArrowGeometry('),
  chart.indexOf('export function createFieldChartMode('))), context);
vm.runInContext(compile(readFileSync(new URL('../src/robot/footballFuturePreview.ts', import.meta.url), 'utf8')), context);
const baseline = scene.onBeforeRenderObservable.observers.length;
const dispose = context.createFootballFuturePreview(players, root,
  beat => beat < 16 ? { startCount: 0, endCount: 16, label: 'Chosen routes' } : null);
const refresh = () => scene.onBeforeRenderObservable.notifyObservers(scene);
const ghosts = () => scene.transformNodes.filter(node => node.name === 'footballFutureGhost');
try {
  assert.equal(ghosts().length, 0);
  toggle.checked = true; listeners.forEach(callback => callback());
  assert.equal(ghosts().length, 22, 'Every player including holds has a destination ghost');
  assert.match(status.value, /22\/22/);
  const first = ghosts()[0];
  assert.ok(first.position.equals(schedules.get(players[0])[16].position));
  assert.ok(first.getAbsolutePosition().equalsWithEpsilon(
    Vector3.TransformCoordinates(first.position, root.computeWorldMatrix(true)), 1e-6));
  assert.ok(ghosts().every(ghost => ghost.getChildMeshes().every(mesh => !mesh.isPickable && !mesh.checkCollisions)));
  const line = scene.getMeshByName('footballFutureRoutes');
  const arrows = scene.getMeshByName('footballFutureArrows');
  assert.ok(line && arrows && !line.isPickable && !arrows.isPickable);
  refresh(); assert.equal(ghosts()[0], first, 'Unchanged paused routes reuse visuals');
  schedules.get(players[1])[16].position.x += 2; refresh();
  assert.equal(ghosts().length, 22);
  assert.equal(ghosts()[1].position.x, schedules.get(players[1])[16].position.x, 'Live endpoint changes refresh');
  clearanceOffset = .3; refresh();
  assert.equal(ghosts()[1].position.x, schedules.get(players[1])[16].position.x + .3,
    'Future ghosts and route geometry use the same separated positions as football playback');
  clearanceOffset = 0;
  playing = true; refresh(); assert.equal(ghosts().length, 0);
  assert.equal(toggle.checked, true, 'Play hides previews without changing toggle preference');
  playing = false; beat = 8; refresh(); assert.equal(ghosts().length, 22);
  calibration.checked = true; refresh(); assert.equal(ghosts().length, 0);
  calibration.checked = false; blank = {}; refresh(); assert.equal(ghosts().length, 0);
  blank = null; beat = 16; refresh(); assert.equal(ghosts().length, 0);
  beat = 0; refresh(); assert.equal(ghosts().length, 22, 'Reverse seek reconstructs pre-play futures');
  toggle.checked = false; refresh(); assert.equal(ghosts().length, 0);
  dispose();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scene.onBeforeRenderObservable.observers.length, baseline);
  assert.equal(listeners.size, 0, 'Disposal unregisters native/XR toggle listener');
  assert.equal(scene.getMeshByName('footballFutureArrows'), null);
  assert.ok(players.every(player => !player.isDisposed()), 'Preview disposal preserves shared source players');
  console.log('Football future preview passed: 22 chosen-route ghosts, holds, paths/arrows, tabletop transforms, cached refresh, live edits, play/pause/reverse, calibration/blank-page gating and disposal.');
} finally { scene.dispose(); engine.dispose(); }
