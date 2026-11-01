// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

const source = readFileSync(new URL('../src/camera/marcherDrumGame.ts', import.meta.url), 'utf8');
const compile = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine();
const scene = new Scene(engine);
const field = new TransformNode('field', scene);
const robot = new TransformNode('percussionMarcher', scene);
robot.parent = field;
const counts = [
  { position: new Vector3(1, 0, 1), rotationY: 0 },
  { position: new Vector3(2, 0, 2), rotationY: 0.2 },
  { position: new Vector3(3, 0, 3), rotationY: 0.4 },
];
let selected = robot;
let playing = true;
let povActive = false;
let vrActive = true;
let scale = 1;
let now = 1000;
const statuses = [];
const seeks = [];
const controllers = new Map();
const grip = new TransformNode('leftGrip', scene);
controllers.set('left', { grip });
const context = vm.createContext({
  Color3, Vector3, Mesh, MeshBuilder, StandardMaterial, TransformNode, scene,
  performance: { now: () => now },
  getActiveControllers: () => controllers,
  setSceneManipulationLocked: value => { context.sceneLocked = value; },
  getARScale: () => scale,
  getARScaleRange: () => ({ min: 0.1, max: 1 }),
  getDrillLastCountIndex: () => counts.length - 1,
  getGlobalCountIndex: () => 0,
  getMarcherInstrument: () => context.instrument,
  getRobotCounts: () => counts,
  isAnyPlaying: () => playing,
  pauseAll: () => { playing = false; },
  playAll: () => { playing = true; },
  seekToCount: index => { seeks.push(index); },
  instrument: 'snare',
});

try {
  vm.runInContext(`${compile(source)}
globalThis.game = { initMarcherDrumGame, isMarcherDrumGameActive, toggleMarcherDrumGame };`, context);
  const camera = new FreeCamera('viewer', Vector3.Zero(), scene);
  camera.getClassName = () => 'WebXRCamera';
  scene.activeCamera = camera;
  context.game.initMarcherDrumGame({
    getSelected: () => selected,
    startPOV: () => { povActive = true; },
    isPOVActive: () => povActive,
    isVRActive: () => vrActive,
    status: message => statuses.push(message),
  });

  scale = 0.5;
  context.game.toggleMarcherDrumGame();
  assert.equal(context.game.isMarcherDrumGameActive(), false);
  assert.match(statuses.at(-1), /Full scale/);
  assert.equal(playing, true, 'Rejected start leaves playback unchanged');

  scale = 1;
  vrActive = false;
  context.game.toggleMarcherDrumGame();
  assert.equal(context.game.isMarcherDrumGameActive(), false);
  assert.match(statuses.at(-1), /immersive VR only/);
  vrActive = true;

  context.game.toggleMarcherDrumGame();
  assert.equal(context.game.isMarcherDrumGameActive(), true);
  assert.equal(playing, false, 'Starting pauses shared playback');
  assert.equal(context.sceneLocked, true, 'Stick swings cannot move the field');
  const target = scene.getTransformNodeByName('marcherDrumGameTarget');
  assert.ok(target);
  assert.ok(Vector3.Distance(target.position, new Vector3(2, 0.9, 2)) < 1e-6,
    'Target is placed at the next route count');

  grip.position.set(2, 0.9, 2 - 0.34);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.deepEqual(seeks, [1], 'A physical virtual-stick hit advances one count');
  const stick = scene.getMeshByName('marcherDrumGameStick-left');
  assert.ok(stick, 'A virtual drumstick is attached to the controller');
  assert.ok(Vector3.Distance(target.position, new Vector3(3, 0.9, 3)) < 1e-6,
    'The next hit target follows the route');

  now += 251;
  grip.position.set(3, 0.9, 3 - 0.34);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.deepEqual(seeks, [1, 2], 'The final hit reaches the final route count');
  assert.equal(context.game.isMarcherDrumGameActive(), false, 'Game ends at route completion');
  assert.equal(context.sceneLocked, false, 'Route completion unlocks field movement');
  assert.equal(playing, true, 'Playback resumes only after a previously playing show');
  assert.ok(target.isDisposed(), 'Target resources are removed when the game ends');
  assert.ok(stick.isDisposed(), 'Controller stick resources are removed when the game ends');

  playing = false;
  context.game.toggleMarcherDrumGame();
  assert.equal(playing, false, 'Paused playback stays paused when the game ends');
  context.game.toggleMarcherDrumGame();
  assert.equal(playing, false, 'Manual game exit does not start previously paused playback');
  assert.equal(context.sceneLocked, false);

  context.instrument = 'clarinet';
  context.game.toggleMarcherDrumGame();
  assert.equal(context.game.isMarcherDrumGameActive(), false);
  assert.match(statuses.at(-1), /snare, tenor/);
  console.log('Marcher drum game checks passed.');
} finally {
  scene.dispose();
  engine.dispose();
}
