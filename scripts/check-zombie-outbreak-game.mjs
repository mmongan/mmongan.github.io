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
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
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
const zombifiedSet = new Set();
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
  Matrix, Quaternion, TargetCamera, Vector3, Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, scene,
  performance: { now: () => fakeNow },
  getActiveControllers: () => controllers,
  isGripPressed: controller => !!controller.squeezePressed,
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
  setMarcherZombified: (robot, value) => { if (value) zombifiedSet.add(robot); else zombifiedSet.delete(robot); },
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
  stopPOV: () => { globalThis.povOff(); },
  isPOVActive: () => globalThis.povActive(),
  status: message => globalThis.pushStatus(message),
})`, context);
let povEngages = true;
context.povOn = () => { if (povEngages) povActive = true; };
context.povOff = () => { povActive = false; };
context.povActive = () => povActive;
context.pushStatus = message => statuses.push(message);
assert.ok(registered, 'The game registers itself with zombie mode');

// Guards: desktop and quad-less bands fall back to the scripted cinematic.
snapshots = bandSnapshots();
assert.equal(registered.tryStart(), 'declined', 'Desktop falls back to the cinematic outbreak');
cameraClass = 'WebXRCamera';
snapshots = bandSnapshots().slice(1);
assert.equal(registered.tryStart(), 'declined', 'No quad player on the field: no survival game');
// POV not engaging (the XR session still settling) keeps the request
// pending instead of degrading to the sideline or the cinematic.
snapshots = bandSnapshots();
povEngages = false;
assert.equal(registered.tryStart(), 'retry', 'An unengaged POV retries rather than declines');
assert.equal(registered.isActive(), false);
povEngages = true;

// Start: POV on the quad, transport paused, zombies tinted and exempted,
// striped referees posted, ghost trail strung along the route.
snapshots = bandSnapshots();
playing = true;
// POV already following another marcher (the cinematic's sousaphone, say)
// restarts onto the quad player rather than keeping the old target.
povActive = true;
context.selected = clarinet;
assert.equal(registered.tryStart(), 'started', 'VR with a quad and clarinets starts the game');
assert.equal(context.selected, quad, 'The game re-targets POV onto the quad player');
assert.equal(registered.isActive(), true);
assert.equal(context.selected, quad, 'The quad player is selected for POV');
assert.equal(povActive, true);
assert.equal(paused, 1, 'The drill transport pauses for the game');
assert.equal(locked, true, 'Field manipulation locks during the game');
assert.ok(heldSet.has(quad) && heldSet.has(clarinet), 'Movers are exempted via setRobotHeld');
assert.ok(!heldSet.has(flute), 'Standing marchers keep their scheduled poses');
const clarinetColor = colors.get(clarinet);
assert.ok(clarinetColor.g > clarinetColor.r, 'Clarinets turn green at the start');
assert.ok(zombifiedSet.has(clarinet), 'Zombies get green skin and the zombie face');
assert.equal(presentationCount, 3, 'Three referees take their posts');
const referee = scene.transformNodes.find(node => node.name === 'referee1');
assert.ok(referee.getChildMeshes(false).filter(mesh => mesh.name === 'zombieRefereeStripe').length === 4,
  'Referees wear four black stripes over a white uniform');
assert.ok(colors.get(referee).equals(Color3.White()), 'Referee base uniform is white');
const playerHornMesh = quad.getChildMeshes(false).find(mesh => mesh.name === 'marcherHorn');
assert.ok(Math.abs(playerHornMesh.position.z - 0.16) < 1e-9,
  "The player's drums shift forward to a natural striking distance");
assert.ok(Math.abs(playerHornMesh.position.y - 0.22) < 1e-9,
  "The player's drums rise to chest height for easy game striking");
const ghosts = scene.meshes.filter(mesh => mesh.name.startsWith('zombieGhostDrum') && mesh.isEnabled());
assert.equal(ghosts.length, 6, 'A trail of ghost drums rides the authored route');
assert.ok(ghosts[0].material.alpha > ghosts[5].material.alpha + 0.1,
  'The ghost trail fades into the distance');

// In formation: while the player stays aligned with the lead ghost, the
// horde marches its own drill paths — how tightly is the player's timing.
// Metronome-perfect strikes pin them to their spots; sloppy timing frees
// them to roam. Nobody is bowled over in formation either way.
assert.equal(vm.runInContext('strikePrecision', context), 0.5, 'Precision starts neutral');
const clarinetPost = clarinet.position.clone();
flute.position.set(0.3, 0, -20);
vm.runInContext('strikePrecision = 1', context);
fakeNow = 500;
vm.runInContext('update()', context);
assert.ok(clarinet.position.subtract(clarinetPost).length() < 0.05,
  'Perfect timing keeps the zombies exactly on their drill paths');
assert.ok(!heldSet.has(flute), 'No knockdowns while the horde is in formation');
vm.runInContext('strikePrecision = 0', context);
fakeNow = 600;
vm.runInContext('update()', context);
assert.ok(clarinet.position.subtract(clarinetPost).length() > 0.1,
  'Sloppy timing frees the zombies to roam off their paths');
clarinet.position.copyFrom(clarinetPost);
vm.runInContext('strikePrecision = 0.5', context);
flute.position.set(6, 0, -14);
assert.ok(Math.abs(ghosts[0].position.z - 10) < 1.5 && Math.abs(ghosts[0].position.x) < 1e-6,
  'The lead ghost marks the player\'s scheduled spot');
assert.ok(ghosts[3].position.z > ghosts[0].position.z,
  'Trail drums march ahead along the route');
const beatGhost = scene.meshes.find(mesh => mesh.name === 'zombieBeatGhost');
assert.ok(beatGhost.isEnabled(), 'A beat ghost marks the next strike spot');
assert.ok(Math.abs(beatGhost.position.z - 10.625) < 1e-6,
  'The beat ghost stands where the player should be at the next beat');
assert.ok(vm.runInContext(
  'Math.abs(targetMarkers[0].material.alpha - (0.22 + 0.68 * (gameCount % 1) ** 3)) < 1e-9', context),
'The ring pulse is locked to the ghost cadence beat');

// The future footsteps: one sole print per upcoming count, left foot on
// odd counts (cyan) just left of the route line, right foot (gold) on
// even counts to its right, fading into the future.
const prints = scene.meshes.filter(mesh => mesh.name.startsWith('zombieFootprint'));
assert.equal(prints.length, 16, 'Future footsteps are strung along the route');
assert.ok(prints.every(print => print.isEnabled()),
  'Every upcoming marching count leaves a print');
assert.ok(Math.abs(prints[0].position.x - -0.12) < 1e-6 &&
  Math.abs(prints[0].position.z - 10.625) < 1e-6,
'The next step is the left foot, just left of the route line');
assert.ok(prints[0].material.emissiveColor.b > prints[0].material.emissiveColor.r,
  'Left prints wear cyan');
assert.ok(Math.abs(prints[1].position.x - 0.12) < 1e-6 &&
  Math.abs(prints[1].position.z - 11.25) < 1e-6,
'The following step is the right foot, right of the line');
assert.ok(prints[1].material.emissiveColor.r > prints[1].material.emissiveColor.b,
  'Right prints wear gold');
assert.ok(prints[0].material.alpha > prints[15].material.alpha + 0.2,
  'The footsteps fade into the future');

// Strayed, a guide ghost stands a few yards from the player in the exact
// direction of the drill spot — some turn always finds it — and leads
// the walk back; on the path it stands down and the trail leads.
const guideGhost = scene.meshes.find(mesh => mesh.name === 'zombieGuideGhost');
assert.ok(guideGhost && !guideGhost.isEnabled(), 'Aligned, no guide ghost is needed');
const quadHome = quad.position.clone();
quad.position.set(-9, 0, 10);
fakeNow = 650;
vm.runInContext('update()', context);
assert.ok(guideGhost.isEnabled(), 'Strayed off the path, a guide ghost appears');
assert.ok(Math.abs(guideGhost.position.x - -6) < 0.5 && Math.abs(guideGhost.position.z - 10) < 0.5,
  'The guide ghost stands three yards from the player, toward the drill spot');
assert.ok(Math.abs(guideGhost.rotation.y - Math.PI / 2) < 0.1,
  'The guide ghost faces the way back to the drill');
// Facing away from the drill, a floating arrow ahead of the face points
// the way to turn back to the path.
const turnArrow = scene.transformNodes.find(node => node.name === 'zombieTurnArrow');
assert.ok(turnArrow.isEnabled(), 'Facing away from the drill, a floating turn arrow appears');
assert.ok(Math.abs(turnArrow.rotation.y - Math.PI / 2) < 0.1,
  'The arrow points the turn back toward the drill path');
quad.position.copyFrom(quadHome);
fakeNow = 700;
vm.runInContext('update()', context);
assert.ok(!guideGhost.isEnabled(), 'Back on the path, the guide ghost stands down');
assert.ok(!turnArrow.isEnabled(), 'Facing along the drill, the arrow rests');

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
// Steering: the march and the carried drums face where the player looks;
// the controllers only strike. The opening call is gold: the right hand.
povCamera.rotation.y = -0.75;
fakeNow = 950;
vm.runInContext('update()', context);
assert.ok(Math.abs(vm.runInContext('player.heading', context) - -0.75) < 1e-6,
  'The march faces where the player looks');
assert.ok(Math.abs(quad.rotation.y - -0.75) < 1e-6,
  'The carried drums swing with the look');
assert.ok(vm.runInContext('targetMarkers[0].material.emissiveColor.r', context) > 0.9,
  'The opening call is gold: the right hand');
controllers = new Map([['right', { grip }]]);
grip.rotation.y = 0.6;
placeGripOnZone(new Vector3(-0.25, 0.87, 0.26));
fakeNow = 1000;
vm.runInContext('update()', context);
assert.ok(Math.abs(vm.runInContext('player.heading', context) - -0.75) < 1e-6,
  'Controller pointing does not steer the march');
assert.equal(vm.runInContext('stepDistanceLeft', context), 0,
  'A wrong-drum hit plays no step');
const rightStick = scene.meshes.find(mesh => mesh.name === 'zombieOutbreakStick-right');
assert.ok(rightStick.material.emissiveColor.r > 0.5 && rightStick.material.emissiveColor.b < 0.3,
  "The right stick wears the call's gold while its hand is called");
// Past the cooldown, strike the called inner-left drum with the called
// right hand: the player strides toward the look direction, and the next
// call in the sequence is a double stop — cyan left ring and gold right
// ring on two different drums.
const standing = quad.position.clone();
fakeNow += 300;
placeGripOnZone(new Vector3(-0.115, 0.88, 0.42));
vm.runInContext('update()', context);
assert.ok(quad.position.x < standing.x - 1e-3,
  'Striking the called drum strides toward the look direction');
assert.notEqual(vm.runInContext('strikePrecision', context), 0.5,
  'A landed strike rescores the rolling beat precision');
const marker2 = scene.meshes.find(mesh => mesh.name === 'zombieOutbreakDrumTarget2');
assert.ok(marker2.isEnabled(), 'A double stop lights a second ring');
assert.ok(vm.runInContext('targetMarkers[0].material.emissiveColor.r', context) < 0.5,
  'The left half of the double wears cyan');
assert.ok(vm.runInContext('targetMarkers[1].material.emissiveColor.r', context) > 0.9,
  'The right half of the double wears gold');
// An immediate right-stick strike is debounced by that hand's cooldown.
placeGripOnZone(new Vector3(0.25, 0.87, 0.26));
vm.runInContext('update()', context);
assert.equal(vm.runInContext('satisfiedHands.size', context), 0,
  'The hit cooldown debounces rapid strikes');
// Past the cooldown, the right stick on the LEFT-hand half is a miss.
fakeNow += 300;
placeGripOnZone(new Vector3(-0.115, 0.88, 0.42));
vm.runInContext('update()', context);
assert.equal(vm.runInContext('satisfiedHands.size', context), 0,
  'The wrong hand on a called drum plays no half');
// The right half lands and waits, paying nothing yet.
fakeNow += 300;
placeGripOnZone(new Vector3(0.25, 0.87, 0.26));
vm.runInContext('update()', context);
assert.equal(vm.runInContext('satisfiedHands.size', context), 1,
  'Half the double stop lands and waits for its partner');
assert.equal(vm.runInContext('stepDistanceLeft', context), 0,
  'Half a double stop pays nothing yet');
// The left stick completes the pair inside the window: two strides.
controllers = new Map([['left', { grip }]]);
fakeNow += 100;
placeGripOnZone(new Vector3(-0.115, 0.88, 0.42));
vm.runInContext('update()', context);
assert.ok(vm.runInContext('stepDistanceLeft', context) > 0.75,
  'A completed double stop pays two strides');
assert.ok(vm.runInContext('stepDistanceLeft', context) <= 1.5 + 1e-9,
  'One distinct hit per step: strikes never bank distance beyond the call');
const leftStick = scene.meshes.find(mesh => mesh.name === 'zombieOutbreakStick-left');
assert.ok(leftStick.material.emissiveColor.b > 0.3,
  "The left stick wears the call's cyan while its half is outstanding");
controllers = new Map();
povCamera.rotation.y = 0;
vm.runInContext('stepDistanceLeft = 0', context);

// The drum handle: a fresh squeeze with the grip on the bar grabs the
// whole carriage; moving and twisting the hand repositions and tilts the
// drums, the adjusting hand's stick plays nothing, and releasing leaves
// the new pose riding the marcher.
const handle = scene.meshes.find(mesh => mesh.name === 'zombieOutbreakDrumHandle');
assert.ok(handle && handle.parent === playerHornMesh, 'A grab handle rides the drum carriage');
// Settle the heading on the new look first, so the drag asserts exercise
// the hand motion alone in a steady body frame.
fakeNow += 100;
vm.runInContext('update()', context);
grip.rotation.set(0, 0, 0);
handle.computeWorldMatrix(true);
grip.position.copyFrom(handle.getAbsolutePosition());
controllers = new Map([['right', { grip, squeezePressed: true }]]);
fakeNow += 300;
vm.runInContext('update()', context);
assert.equal(vm.runInContext('handleGrabHand', context), 'right',
  'A fresh squeeze on the bar grabs the carriage');
const hornMount = playerHornMesh.position.clone();
grip.position.y += 0.3;
grip.position.x += 0.2;
grip.position.z -= 0.1;
grip.rotation.x = 0.4;
fakeNow += 100;
vm.runInContext('update()', context);
assert.ok(Math.abs(playerHornMesh.position.y - (hornMount.y + 0.3)) < 1e-6 &&
  Math.abs(playerHornMesh.position.x - (hornMount.x + 0.2)) < 1e-6 &&
  Math.abs(playerHornMesh.position.z - (hornMount.z - 0.1)) < 1e-6,
'The hand drags the drums freely in all three axes, relative to the view');
assert.ok(Math.abs(playerHornMesh.rotation.x - 0.4) < 1e-6, 'Pitching the wrist tilts the drums');
assert.equal(playerHornMesh.rotation.y, 0, 'The drums stay yaw-squared to the facing');
assert.equal(vm.runInContext('stepDistanceLeft', context), 0,
  'The adjusting hand strikes nothing');
grip.position.y += 5;
controllers = new Map([['right', { grip, squeezePressed: false }]]);
fakeNow += 100;
vm.runInContext('update()', context);
assert.equal(vm.runInContext('handleGrabHand', context), null, 'Releasing the squeeze lets go');
assert.ok(Math.abs(playerHornMesh.rotation.x - 0.4) < 0.05,
  'The adjusted pose keeps riding the marcher');
controllers = new Map();
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
assert.ok(!zombifiedSet.has(flute), 'The cure restores skin and face');

// Clubbed: a drumstick blow to the head fells a zombie for good. The cured
// flute is bitten again, rises, and takes a stick to the head.
trumpet.position.set(-6, 0, -14);
flute.position.copyFrom(clarinet.position).addInPlace(new Vector3(0.25, 0, 0));
fakeNow += 100;
vm.runInContext('update()', context);
assert.ok(heldSet.has(flute), 'A cured marcher can be bitten again');
fakeNow += 20000;
vm.runInContext('update()', context);
vm.runInContext('update()', context);
assert.equal(vm.runInContext('chasers.length', context), 2, 'The re-bitten marcher rises again');
clarinet.position.set(-20, 0, -30);
controllers = new Map([['right', { grip }]]);
grip.rotation.set(0, 0, 0);
grip.position.copyFrom(flute.position).addInPlace(new Vector3(0, 1.7, -0.34));
fakeNow += 100;
vm.runInContext('update()', context);
assert.equal(vm.runInContext('chasers.length', context), 1,
  'A drumstick to the head fells the zombie');
fakeNow += 600;
vm.runInContext('update()', context);
assert.ok(Math.abs(flute.rotation.x) > 1.2, 'The felled zombie drops flat');
fakeNow += 30000;
vm.runInContext('update()', context);
assert.equal(vm.runInContext('chasers.length', context), 1, 'A felled zombie never rises');
assert.ok(Math.abs(flute.rotation.x) > 1.2, 'It stays down');
controllers = new Map();

// Corpses are obstacles: marching into one trips the drummer — owed steps
// are lost and the sticks go quiet until the stumble wears off.
quad.position.copyFrom(flute.position).addInPlace(new Vector3(0.5, 0, 0));
vm.runInContext('stepDistanceLeft = 0.75; stumbleUntil = 0; corpseContacts.clear();', context);
fakeNow += 100;
vm.runInContext('update()', context);
assert.equal(vm.runInContext('stepDistanceLeft', context), 0,
  'Marching over a corpse trips the drummer');
vm.runInContext(`strikeZone(currentCall[0].zone, ${fakeNow + 50})`, context);
assert.equal(vm.runInContext('stepDistanceLeft', context), 0,
  'A stumbling drummer cannot step');
fakeNow += 2000;
vm.runInContext(`strikeZone(currentCall[0].zone, ${fakeNow})`, context);
assert.ok(vm.runInContext('stepDistanceLeft', context) > 0, 'The stumble wears off');
vm.runInContext('stepDistanceLeft = 0', context);

// A trumpet player standing near a corpse wakes it cured.
trumpet.position.copyFrom(flute.position).addInPlace(new Vector3(1, 0, 0));
fakeNow += 100;
vm.runInContext('update()', context);
assert.ok(!heldSet.has(flute), 'A trumpet wakes the fallen corpse cured');
assert.equal(flute.rotation.x, 0, 'The cured corpse stands back up');
assert.ok(!zombifiedSet.has(flute), 'The cured corpse sheds the zombie look');
trumpet.position.set(-6, 0, -14);

// Dirty tricks: clubbing a healthy bandmate stumbles it into bait that
// lures nearby hunting zombies; the horde knocks the decoy down on contact.
quad.position.set(0, 0, 0);
clarinet.position.copyFrom(flute.position).addInPlace(new Vector3(3, 0, 0));
controllers = new Map([['right', { grip }]]);
grip.position.copyFrom(flute.position).addInPlace(new Vector3(0, 1.7, -0.34));
fakeNow += 300;
vm.runInContext('update()', context);
assert.equal(vm.runInContext('decoys.length', context), 1,
  'A clubbed healthy bystander stumbles into a decoy');
assert.ok(heldSet.has(flute), 'The decoy is exempted while staggering');
controllers = new Map();
const decoyGap = Vector3.Distance(clarinet.position, flute.position);
fakeNow += 100;
vm.runInContext('update()', context);
assert.ok(Vector3.Distance(clarinet.position, flute.position) < decoyGap - 1e-3,
  'A stumbling decoy lures the nearby zombie off the player');
clarinet.position.copyFrom(flute.position).addInPlace(new Vector3(0.2, 0, 0));
fakeNow += 100;
vm.runInContext('update()', context);
assert.equal(vm.runInContext('decoys.length', context), 0, 'The horde knocks the decoy down');
assert.ok(heldSet.has(flute), 'The knocked decoy falls like any victim');

// Caught: a zombie touching the player ends the game and restores the band.
clarinet.position.copyFrom(quad.position).addInPlace(new Vector3(0.2, 0, 0));
fakeNow += 100;
vm.runInContext('update()', context);
assert.equal(registered.isActive(), false, 'A zombie touch ends the game');
assert.match(statuses[statuses.length - 1], /horde got you/, 'The ending reports survival');
assert.equal(heldSet.size, 0, 'Every held marcher returns to its schedule');
assert.equal(zombifiedSet.size, 0, 'Game over restores every zombified skin and face');
assert.equal(playerHornMesh.position.z, 0, 'The drums return to their parade mount');
assert.equal(playerHornMesh.position.y, 0, 'The raised drums lower back to the parade mount');
assert.equal(playerHornMesh.rotation.x, 0, 'The tilted drums level back to the parade mount');
assert.ok(!scene.meshes.some(mesh => mesh.name === 'zombieOutbreakDrumHandle' && !mesh.isDisposed()),
  'The grab handle is disposed with the game');
assert.ok(!scene.transformNodes.some(node => node.name === 'zombieTurnArrow'),
  'The turn arrow is disposed with the game');
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
assert.ok(scene.meshes.every(mesh => !mesh.name.startsWith('zombieFootprint') || mesh.isDisposed()),
  'The future footsteps leave with the game');

// The Outbreak! button forces the game on any platform; the Settings
// toggle's unforced request still falls back to the cinematic on desktop.
cameraClass = 'FreeCamera';
snapshots = bandSnapshots();
quad.position.set(0, 0, 10);
assert.equal(registered.tryStart(), 'declined', 'An unforced desktop request keeps the cinematic');
assert.equal(registered.tryStart(true), 'started', 'Outbreak! starts the survival game on desktop');
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
assert.equal(registered.tryStart(), 'started', 'The game restarts for another run');
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
  'fading ghost-drum trail on the captured schedule, fading future footsteps, the strayed-player guide ghost, the turn arrow, look-steered marching with the drums ' +
  'swinging to the facing, the free-position drum handle, call-colored sticks, one-hit-one-step marching, ' +
  'hand-colored call enforcement with double-stop pairs, called-drum steps with per-hand cooldowns, ' +
  'zombify/restore of skin and ' +
  'face, head-bonk felling, corpse trips and trumpet corpse revival, formation-vs-hunt by ' +
  'drill alignment, referee whistle scares, ' +
  'knockdown/incubation/rise, the trumpet cure, the aligned-finish win, and a full restore ' +
  'on game over.');
