// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// The zombie outbreak survival game is the immersive-VR form of zombie mode:
// the player is a quad (tenors) drummer followed by the existing POV, steers
// by striking their own four drums (outer drums turn hard; only the glowing
// called drum buys the escape sprint, and the call then jumps elsewhere),
// and the horde chases the player instead of the tubas, bowling over
// standing marchers who rise after an incubation and join the chase.
// Striped referees hold fixed posts and whistle nearby zombies into a brief
// retreat. It is an interactive Drum-Game-style mode: the transport pauses,
// movers are exempted through setRobotHeld, and stopping restores schedules,
// uniforms, instrument poses, upright roots, and disposes the referees.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const engine = new NullEngine();
const scene = new Scene(engine);
let cameraClass = 'FreeCamera';
Object.defineProperty(scene, 'activeCamera', {
  value: { getClassName: () => cameraClass }, writable: true, configurable: true,
});
let fakeNow = 0;
let deltaMs = 100;
scene.getEngine().getDeltaTime = () => deltaMs;

const fieldRoot = new TransformNode('pathRoot', scene);
const makeMarcher = (name) => {
  const robot = new TransformNode(name, scene);
  robot.parent = fieldRoot;
  const horn = MeshBuilder.CreateBox('marcherHorn', { size: 0.05 }, scene);
  horn.parent = robot;
  return robot;
};
const quad = makeMarcher('quad');
const clarinet = makeMarcher('clarinet');
const flute = makeMarcher('flute');
quad.position.set(0, 0, 10);
clarinet.position.set(0, 0, -20);
flute.position.set(6, 0, -14);

let snapshots = [];
const heldSet = new Set();
const colors = new Map([[quad, new Color3(1, 1, 1)], [clarinet, new Color3(0.1, 0.4, 0.8)],
  [flute, new Color3(0.9, 0.9, 0.1)]]);
const poseSets = [];
const walks = [];
let paused = 0, played = 0, playing = false, povActive = false, locked = null;
const statuses = [];
let presentationCount = 0;
let registered = null;
let controllers = new Map();

const context = vm.createContext({
  Vector3, Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, scene, performance: { now: () => fakeNow },
  getActiveControllers: () => controllers,
  setSceneManipulationLocked: value => { locked = value; },
  getARScale: () => 1, getARScaleRange: () => ({ min: 1 / 120, max: 1 }),
  animateHeldMarcherWalk: (robot, phase, amplitude) => walks.push({ robot, phase, amplitude }),
  captureMarcherSchedules: () => snapshots,
  createPresentationMarcher: () => { presentationCount++; return makeMarcher(`referee${presentationCount}`); },
  getInstrumentPose: () => 'playing',
  getRobotColor: robot => colors.get(robot) ?? new Color3(0.5, 0.5, 0.5),
  isAnyPlaying: () => playing, pauseAll: () => { paused++; }, playAll: () => { played++; },
  setMarcherInstrumentPose: (robot, pose) => poseSets.push({ robot, pose }),
  setRobotColor: (robot, color) => colors.set(robot, color),
  setRobotHeld: (robot, held) => { if (held) heldSet.add(robot); else heldSet.delete(robot); },
  getSharedAudioContext: () => null,
  registerZombieOutbreakGame: hooks => { registered = hooks; },
  FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333,
});
const source = readFileSync(new URL('../src/camera/zombieOutbreakGame.ts', import.meta.url), 'utf8');
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);

vm.runInContext(`initZombieOutbreakGame({
  selectMarcher: robot => { globalThis.selected = robot; },
  startPOV: () => { globalThis.povOn(); },
  isPOVActive: () => globalThis.povActive(),
  status: message => globalThis.pushStatus(message),
})`, context);
context.povOn = () => { povActive = true; };
context.povActive = () => povActive;
context.pushStatus = message => statuses.push(message);
assert.ok(registered, 'The game registers itself with zombie mode');

// Guards: desktop and quad-less bands fall back to the scripted cinematic.
snapshots = [{ robot: quad, instrument: 'tenors' }, { robot: clarinet, instrument: 'clarinet' },
  { robot: flute, instrument: 'flute' }];
assert.equal(registered.tryStart(), false, 'Desktop falls back to the cinematic outbreak');
cameraClass = 'WebXRCamera';
snapshots = [{ robot: clarinet, instrument: 'clarinet' }, { robot: flute, instrument: 'flute' }];
assert.equal(registered.tryStart(), false, 'No quad player on the field: no survival game');

// Start: POV on the quad, transport paused, zombies tinted and exempted,
// striped referees posted.
snapshots = [{ robot: quad, instrument: 'tenors' }, { robot: clarinet, instrument: 'clarinet' },
  { robot: flute, instrument: 'flute' }];
playing = true;
assert.equal(registered.tryStart(), true, 'VR with a quad and clarinets starts the game');
assert.equal(registered.isActive(), true);
assert.equal(context.selected, quad, 'The quad player is selected for POV');
assert.equal(povActive, true);
assert.equal(paused, 1, 'The drill transport pauses for the game');
assert.equal(locked, true, 'Field manipulation locks during the game');
assert.ok(heldSet.has(quad) && heldSet.has(clarinet), 'Movers are exempted via setRobotHeld');
assert.ok(!heldSet.has(flute), 'Standing marchers keep their scheduled poses');
const clarinetColor = colors.get(clarinet);
assert.ok(clarinetColor.g > clarinetColor.r, 'Clarinets turn green at the start');
assert.equal(presentationCount, 3, 'Three referees take their posts');
const referee = scene.transformNodes.find(node => node.name === 'referee1');
assert.ok(referee.getChildMeshes(false).filter(mesh => mesh.name === 'zombieRefereeStripe').length === 4,
  'Referees wear four black stripes over a white uniform');
assert.ok(colors.get(referee).equals(Color3.White()), 'Referee base uniform is white');

// Steering and the call: any drum steers, but only the glowing called drum
// buys the escape sprint; the cooldown debounces. The game opens calling
// an inner drum.
const marker = scene.meshes.find(mesh => mesh.name === 'zombieOutbreakDrumTarget');
assert.ok(marker && !marker.isDisposed(), 'A glowing ring marks the called drum');
assert.ok(Math.abs(marker.position.x - -0.115) < 1e-6 && Math.abs(marker.position.z - 0.42) < 1e-6,
  'The first call is an inner drum');
const grip = new TransformNode('grip', scene);
controllers = new Map([['right', { grip }]]);
const headingBefore = vm.runInContext('player.heading', context);
const placeGripOnZone = (center) => {
  quad.computeWorldMatrix(true);
  const horn = quad.getChildMeshes(false).find(mesh => mesh.name === 'marcherHorn');
  horn.computeWorldMatrix(true);
  grip.position.copyFrom(Vector3.TransformCoordinates(center, horn.getWorldMatrix())
    .subtract(new Vector3(0, 0, 0.34)));
};
placeGripOnZone(new Vector3(-0.25, 0.87, 0.26));
fakeNow = 1000;
vm.runInContext('update()', context);
const headingAfter = vm.runInContext('player.heading', context);
assert.ok(Math.abs(headingAfter - (headingBefore - 0.75)) < 1e-9,
  'Striking the outer-left drum turns the run hard left');
assert.equal(vm.runInContext('sprintUntil', context), 0,
  'A wrong-drum hit steers but buys no sprint');
vm.runInContext('update()', context);
assert.ok(Math.abs(vm.runInContext('player.heading', context) - headingAfter) < 1e-9,
  'The hit cooldown debounces rapid strikes');
// Past the cooldown, strike the called inner-left drum: sprint is granted
// and the call jumps to a different drum.
fakeNow += 300;
placeGripOnZone(new Vector3(-0.115, 0.88, 0.42));
vm.runInContext('update()', context);
assert.ok(vm.runInContext('sprintUntil', context) > fakeNow,
  'Striking the called drum buys the escape sprint');
assert.ok(Math.abs(marker.position.x - -0.115) > 1e-6 || Math.abs(marker.position.z - 0.42) > 1e-6,
  'The call moves to a new drum after a correct hit');
controllers = new Map();

// The player runs in the steered heading; the horde runs after the player.
const playerBefore = quad.position.clone();
const chaserBefore = clarinet.position.clone();
fakeNow += 500;
vm.runInContext('update()', context);
assert.ok(!quad.position.equals(playerBefore), 'The player runs continuously');
const chaserStep = clarinet.position.subtract(chaserBefore);
assert.ok(chaserStep.length() > 0.01, 'Zombies chase');
assert.ok(Vector3.Distance(clarinet.position, quad.position) <
  Vector3.Distance(chaserBefore, playerBefore) + 1e-6, 'The chase closes on the player');
assert.ok(walks.some(walk => walk.robot === quad) && walks.some(walk => walk.robot === clarinet),
  'Runners use the shared held-marcher walk');

// A referee whistle scares zombies into retreat: move the chaser near the
// midfield post and the next update turns it away.
clarinet.position.set(1, 0, 1);
vm.runInContext('update()', context);
assert.ok(vm.runInContext('chasers[0].scaredUntil', context) > fakeNow,
  'A zombie near a referee is whistled at');
const fleeing = clarinet.position.clone();
vm.runInContext('update()', context);
assert.ok(Vector3.Distance(clarinet.position, new Vector3(0, 0, 0)) >
  Vector3.Distance(fleeing, new Vector3(0, 0, 0)) - 1e-6,
  'A scared zombie runs away from the referee post');
const burst = referee ?? null;
assert.ok(scene.meshes.some(mesh => mesh.name === 'zombieRefereeWhistleBurst' && mesh.isEnabled()),
  'The whistle blast shows a burst');

// Knockdown: a zombie brushing a standing marcher fells it; after the
// incubation it rises green and joins the horde.
flute.position.copyFrom(clarinet.position).addInPlace(new Vector3(0.3, 0, 0));
vm.runInContext('update()', context);
assert.ok(heldSet.has(flute), 'A trampled marcher is exempted where it fell');
fakeNow += 600;
vm.runInContext('update()', context);
assert.ok(Math.abs(flute.rotation.x) > 1.2, 'The trampled marcher lies flat');
fakeNow += 20000;
vm.runInContext('update()', context);
vm.runInContext('update()', context);
assert.equal(vm.runInContext('chasers.length', context), 2, 'The risen marcher joins the horde');
const fluteColor = colors.get(flute);
assert.ok(fluteColor.g > fluteColor.r, 'The risen marcher turns green');

// Caught: a zombie touching the player ends the game and restores the band.
clarinet.position.copyFrom(quad.position).addInPlace(new Vector3(0.2, 0, 0));
fakeNow += 100;
vm.runInContext('update()', context);
assert.equal(registered.isActive(), false, 'A zombie touch ends the game');
assert.match(statuses[statuses.length - 1], /horde got you/, 'The ending reports survival');
assert.equal(heldSet.size, 0, 'Every held marcher returns to its schedule');
assert.equal(flute.rotation.x, 0, 'The fallen stand back up');
assert.ok(colors.get(clarinet).b > colors.get(clarinet).g, 'Clarinet uniforms are restored');
assert.ok(poseSets.filter(entry => entry.pose === 'playing').length >= 2, 'Instrument poses restore');
assert.equal(locked, false, 'Field manipulation unlocks');
assert.equal(played, 1, 'Playback resumes because it was playing at entry');
assert.ok(scene.transformNodes.every(node => !node.name.startsWith('referee') || node.isDisposed()),
  'Referees leave the field with the game');
assert.ok(marker.isDisposed(), 'The called-drum ring leaves with the game');

// Stopping through zombie mode's toggle path also works when idle.
registered.stop();
assert.equal(registered.isActive(), false);

scene.activeCamera = null;
scene.dispose();
engine.dispose();
console.log('Zombie outbreak game checks passed: VR/quad gating with cinematic fallback, ' +
  'drum-steered running with called-drum sprint and cooldown, chasing horde, ' +
  'referee whistle scares, knockdown/incubation/rise, and a full restore on game over.');
