// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// The zombie outbreak survival game is the immersive-VR form of zombie mode:
// the player is a quad (tenors) drummer followed by the existing POV. A
// fading trail of translucent ghost drums marches the player's captured
// drill schedule at a fixed cadence; any drum strike steers the facing
// (outer drums turn hard), and only the glowing called drum takes one
// marching stride toward it (the call then jumps elsewhere). Aligned with
// the lead ghost, the horde marches its own captured drill paths; strayed,
// it hunts the player, bowling over standing marchers who rise after an
// incubation and join the chase. Striped referees whistle nearby zombies
// into a brief retreat, and reaching the final count still aligned wins.
// It is an interactive Drum-Game-style mode: the transport pauses, movers
// are exempted through setRobotHeld, and stopping restores schedules,
// uniforms, instrument poses, upright roots, and disposes the referees and
// ghost drums.

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
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';

const engine = new NullEngine();
const scene = new Scene(engine);
let cameraClass = 'FreeCamera';
// A real TargetCamera (facing drives the march) reporting a fake class so
// the VR gate can be exercised.
const povCamera = new TargetCamera('povCamera', Vector3.Zero(), scene);
povCamera.getClassName = () => cameraClass;
Object.defineProperty(scene, 'activeCamera', {
  value: povCamera, writable: true, configurable: true,
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
const trumpet = makeMarcher('trumpet');
quad.position.set(0, 0, 10);
clarinet.position.set(0, 0, -20);
flute.position.set(6, 0, -14);
trumpet.position.set(-6, 0, -14);
const instruments = new Map([[quad, 'tenors'], [clarinet, 'clarinet'],
  [flute, 'flute'], [trumpet, 'trumpet']]);
const route = (x, z, steps, dz) => Array.from({ length: steps }, (_, index) =>
  ({ position: new Vector3(x, 0, z + dz * index), rotationY: 0 }));
const bandSnapshots = () => [
  { robot: quad, instrument: 'tenors', counts: route(0, 10, 24, 0.625) },
  { robot: clarinet, instrument: 'clarinet', counts: route(0, -20, 24, 0) },
  { robot: flute, instrument: 'flute', counts: route(6, -14, 1, 0) },
  { robot: trumpet, instrument: 'trumpet', counts: route(-6, -14, 1, 0) },
];
let tenorTemplateStub = null;

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
  Matrix, TargetCamera, Vector3, Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, scene,
  performance: { now: () => fakeNow },
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
  getMarcherInstrument: robot => instruments.get(robot) ?? null,
  getDrillTransportState: () => ({ beat: 0, playing: false }),
  getTenorTemplate: () => {
    if (!tenorTemplateStub || tenorTemplateStub.isDisposed()) {
      tenorTemplateStub = MeshBuilder.CreateBox('tenorTemplateStub', { size: 0.1 }, scene);
      tenorTemplateStub.setEnabled(false);
    }
    return tenorTemplateStub;
  },
  registerZombieOutbreakGame: hooks => { registered = hooks; },
  window: { addEventListener() {}, removeEventListener() {} },
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
snapshots = bandSnapshots();
assert.equal(registered.tryStart(), false, 'Desktop falls back to the cinematic outbreak');
cameraClass = 'WebXRCamera';
snapshots = bandSnapshots().slice(1);
assert.equal(registered.tryStart(), false, 'No quad player on the field: no survival game');

// Start: POV on the quad, transport paused, zombies tinted and exempted,
// striped referees posted, ghost trail strung along the route.
snapshots = bandSnapshots();
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
const ghosts = scene.meshes.filter(mesh => mesh.name.startsWith('zombieGhostDrum') && mesh.isEnabled());
assert.equal(ghosts.length, 6, 'A trail of ghost drums rides the authored route');
assert.ok(ghosts[0].material.alpha > ghosts[5].material.alpha + 0.1,
  'The ghost trail fades into the distance');

// In formation: while the player stays aligned with the lead ghost, the
// horde marches its own drill paths — the holding clarinet stays put and
// nobody is bowled over.
const clarinetPost = clarinet.position.clone();
flute.position.set(0.3, 0, -20);
fakeNow = 500;
vm.runInContext('update()', context);
assert.ok(clarinet.position.subtract(clarinetPost).length() < 0.05,
  'An aligned player keeps the zombies on their own drill paths');
assert.ok(!heldSet.has(flute), 'No knockdowns while the horde is in formation');
flute.position.set(6, 0, -14);
assert.ok(Math.abs(ghosts[0].position.z - 10) < 1.5 && Math.abs(ghosts[0].position.x) < 1e-6,
  'The lead ghost marks the player\'s scheduled spot');
assert.ok(ghosts[3].position.z > ghosts[0].position.z,
  'Trail drums march ahead along the route');

// The call and the march: the facing steers (the camera is the rudder),
// drums only play the calls, and only the glowing called drum takes a
// stride. The game opens calling an inner drum.
const marker = scene.meshes.find(mesh => mesh.name === 'zombieOutbreakDrumTarget');
assert.ok(marker && !marker.isDisposed(), 'A glowing ring marks the called drum');
assert.ok(Math.abs(marker.position.x - -0.115) < 1e-6 && Math.abs(marker.position.z - 0.42) < 1e-6,
  'The first call is an inner drum');
const grip = new TransformNode('grip', scene);
const placeGripOnZone = (center) => {
  quad.computeWorldMatrix(true);
  const horn = quad.getChildMeshes(false).find(mesh => mesh.name === 'marcherHorn');
  horn.computeWorldMatrix(true);
  grip.computeWorldMatrix(true);
  const stickForward = Vector3.TransformNormal(new Vector3(0, 0, 1), grip.getWorldMatrix());
  grip.position.copyFrom(Vector3.TransformCoordinates(center, horn.getWorldMatrix())
    .subtract(stickForward.scale(0.34)));
};
// With no controllers connected, the POV look steers (desktop play).
povCamera.rotation.y = 0.4;
fakeNow = 950;
vm.runInContext('update()', context);
assert.ok(Math.abs(vm.runInContext('player.heading', context) - 0.4) < 1e-6,
  'Without controllers the look direction steers the march');
povCamera.rotation.y = 0;
// Connected controllers take over: the march follows where the drumsticks
// point, leaving the head free to look around.
controllers = new Map([['right', { grip }]]);
grip.rotation.y = -0.75;
placeGripOnZone(new Vector3(-0.25, 0.87, 0.26));
fakeNow = 1000;
vm.runInContext('update()', context);
assert.ok(Math.abs(vm.runInContext('player.heading', context) - -0.75) < 1e-6,
  'The march follows where the drumsticks point, not the head');
assert.equal(vm.runInContext('stepDistanceLeft', context), 0,
  'A wrong-drum hit plays no step');
// Past the cooldown, strike the called inner-left drum: the player strides
// toward the look direction and the call jumps to a different drum.
const standing = quad.position.clone();
fakeNow += 300;
placeGripOnZone(new Vector3(-0.115, 0.88, 0.42));
vm.runInContext('update()', context);
assert.ok(quad.position.x < standing.x - 1e-3,
  'Striking the called drum strides toward the look direction');
assert.ok(Math.abs(marker.position.x - -0.115) > 1e-6 || Math.abs(marker.position.z - 0.42) > 1e-6,
  'The call moves to a new drum after a correct hit');
// An immediate strike on the new call is debounced by the hit cooldown.
const calledX = marker.position.x;
placeGripOnZone(new Vector3(0.25, 0.87, 0.26));
vm.runInContext('update()', context);
assert.equal(marker.position.x, calledX, 'The hit cooldown debounces rapid strikes');
controllers = new Map();
povCamera.rotation.y = 0;
// The stride plays out, then a silent drummer stands still.
fakeNow += 100;
vm.runInContext('update()', context);
const resting = quad.position.clone();
fakeNow += 100;
vm.runInContext('update()', context);
assert.ok(quad.position.equals(resting), 'A silent drummer stands still');

// Straying from the ghost trail breaks the horde out of formation into the
// hunt.
quad.position.set(10, 0, 10);
const chaserBefore = clarinet.position.clone();
fakeNow += 500;
vm.runInContext('update()', context);
const chaserStep = clarinet.position.subtract(chaserBefore);
assert.ok(chaserStep.length() > 0.01, 'Zombies chase once the player strays');
assert.ok(Vector3.Distance(clarinet.position, quad.position) <
  Vector3.Distance(chaserBefore, quad.position) + 1e-6, 'The chase closes on the strayed player');
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

// The brass cure: a zombie that runs into a trumpet player turns back into
// a normal uninfected marcher; the trumpet stands unharmed.
clarinet.position.set(20, 0, 30);
trumpet.position.copyFrom(flute.position).addInPlace(new Vector3(0.2, 0, 0));
fakeNow += 100;
vm.runInContext('update()', context);
assert.equal(vm.runInContext('chasers.length', context), 1, 'The cured zombie leaves the horde');
assert.ok(!heldSet.has(flute), 'The cured marcher is released back to its schedule');
const curedColor = colors.get(flute);
assert.ok(curedColor.r > 0.8 && curedColor.b < 0.2, 'The cured marcher gets its uniform back');
assert.ok(!heldSet.has(trumpet), 'The trumpet player stands through the cure');
assert.equal(flute.rotation.x, 0, 'The cured marcher stands upright');

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

assert.ok(scene.meshes.every(mesh => !mesh.name.startsWith('zombieGhostDrum') || mesh.isDisposed()),
  'The ghost trail leaves with the game');

// The Outbreak! button forces the game on any platform; the Settings
// toggle's unforced request still falls back to the cinematic on desktop.
cameraClass = 'FreeCamera';
snapshots = bandSnapshots();
quad.position.set(0, 0, 10);
assert.equal(registered.tryStart(), false, 'An unforced desktop request keeps the cinematic');
assert.equal(registered.tryStart(true), true, 'Outbreak! starts the survival game on desktop');
vm.runInContext('strikeZone(1, 2000000)', context);
assert.ok(vm.runInContext('stepDistanceLeft', context) > 0,
  'A desktop key strike on the called drum plays a step');
registered.stop();
cameraClass = 'WebXRCamera';

// Marching the whole show while aligned ends the run as a win.
quad.position.set(0, 0, 10);
clarinet.position.set(0, 0, -20);
snapshots = [
  { robot: quad, instrument: 'tenors', counts: route(0, 10, 2, 0.625) },
  { robot: clarinet, instrument: 'clarinet', counts: route(0, -20, 1, 0) },
];
assert.equal(registered.tryStart(), true, 'The game restarts for another run');
for (let i = 0; i < 10 && registered.isActive(); i++) {
  fakeNow += 100;
  vm.runInContext('update()', context);
}
assert.equal(registered.isActive(), false, 'Reaching the final count aligned ends the game');
assert.match(statuses[statuses.length - 1], /marched the whole show/, 'The ending reports the win');

// Stopping through zombie mode's toggle path also works when idle.
registered.stop();
assert.equal(registered.isActive(), false);

scene.activeCamera = null;
scene.dispose();
engine.dispose();
console.log('Zombie outbreak game checks passed: VR/quad gating with cinematic fallback, ' +
  'fading ghost-drum trail on the captured schedule, called-drum marching steps with ' +
  'steering and cooldown, formation-vs-hunt by drill alignment, referee whistle scares, ' +
  'knockdown/incubation/rise, the trumpet cure, the aligned-finish win, and a full restore ' +
  'on game over.');
