// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Zombie clarinets are a deterministic, scrub-safe easter egg built on the
// ordinary schedule/transport systems: enabling rewrites each clarinet's
// route from count 8 into a lurching pursuit of the nearest sousaphone,
// tubas flee (slower, clamped to the field) once a zombie is close enough to
// scare them, marchers a zombie runs into are knocked flat where they stood
// and rise as zombies after a reproducible 8–24-count incubation, eaten
// tubas and fallen marchers are pure functions of the transport beat
// (seeking backward revives and stands them up), and disabling restores the
// saved schedules, colors, poses, and upright roots exactly.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

const makeRobot = () => ({
  disposed: false, enabled: true, rotation: { x: 0, y: 0, z: 0 },
  isDisposed() { return this.disposed; },
  setEnabled(value) { this.enabled = value; },
  isEnabled() { return this.enabled; },
});
const clarinetRobot = makeRobot();
const tubaRobot = makeRobot();
const trumpetRobot = makeRobot();
const fluteRobot = makeRobot();
const tromboneRobot = makeRobot();

// A clarinet marching up the field; a halted tuba in the far corner; a
// trumpet halted directly on the zombie's opening line of pursuit; a flute
// far away on the other side, never touched. Fresh snapshots per capture,
// as the real captureBakedMarcherSchedules returns.
const makeSnapshots = () => [
  { robot: clarinetRobot, gaitIndex: 0, instrument: 'clarinet', instrumentPose: 'playing',
    color: new Color3(0.1, 0.4, 0.8), stepSizeYards: 0.625, scheduled: true,
    counts: Array.from({ length: 12 }, (_, i) =>
      ({ position: new Vector3(0, 0, 0.625 * i), rotationY: 0, stepPhase: i })) },
  { robot: tubaRobot, gaitIndex: 0, instrument: 'sousaphone', instrumentPose: 'playing',
    color: new Color3(0.2, 0.2, 0.2), stepSizeYards: 0.625, scheduled: true,
    counts: [{ position: new Vector3(12, 0, 12), rotationY: 0 },
      { position: new Vector3(12, 0, 12), rotationY: 0 }] },
  { robot: trumpetRobot, gaitIndex: 0, instrument: 'trumpet', instrumentPose: 'playing',
    color: new Color3(0.9, 0.1, 0.1), stepSizeYards: 0.625, scheduled: true,
    counts: [{ position: new Vector3(1.728, 0, 6.008), rotationY: 0 },
      { position: new Vector3(1.728, 0, 6.008), rotationY: 0 }] },
  // About two yards off the pursuit line: only reachable because zombies
  // actively veer into nearby marchers on the way to their prey.
  { robot: tromboneRobot, gaitIndex: 0, instrument: 'trombone', instrumentPose: 'playing',
    color: new Color3(0.3, 0.6, 0.3), stepSizeYards: 0.625, scheduled: true,
    counts: [{ position: new Vector3(4.2, 0, 9.5), rotationY: 0 },
      { position: new Vector3(4.2, 0, 9.5), rotationY: 0 }] },
  { robot: fluteRobot, gaitIndex: 0, instrument: 'flute', instrumentPose: 'playing',
    color: new Color3(0.9, 0.9, 0.1), stepSizeYards: 0.625, scheduled: true,
    counts: [{ position: new Vector3(-20, 0, -50), rotationY: 0 },
      { position: new Vector3(-20, 0, -50), rotationY: 0 }] },
];

let snapshots = makeSnapshots();
let beat = 0;
let playbackRequested = false;
let plays = 0;
const seeks = [];
let restores = [];
let colorSets = [];
let poseSets = [];
const zombieModeToggle = { checked: true };
const scene = { onDisposeObservable: { addOnce() {} } };
const context = vm.createContext({
  Vector3, Color3, zombieModeToggle, scene,
  FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333,
  captureBakedMarcherSchedules: () => snapshots,
  restoreMarcherSchedule: (robot, snapshot) => restores.push({ robot, snapshot }),
  setRobotColor: (robot, color) => colorSets.push({ robot, color }),
  setMarcherZombified: () => {},
  setMarcherInstrumentPose: (robot, pose) => poseSets.push({ robot, pose }),
  getDrillTransportState: () => ({ beat }),
  isPlaybackRequested: () => playbackRequested,
  playAll: () => { plays++; },
  seekToCount: count => seeks.push(count),
});
const source = readFileSync(new URL('../src/robot/zombieMode.ts', import.meta.url), 'utf8');
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);

// No prey: the outbreak refuses to start and nothing changes.
snapshots = makeSnapshots().filter(snapshot => snapshot.instrument !== 'sousaphone');
assert.match(vm.runInContext('enableZombieMode(scene)', context) ?? '',
  /sousaphone/, 'Needs at least one tuba to hunt');
assert.equal(restores.length, 0, 'A refused outbreak touches no schedules');
assert.equal(vm.runInContext('isZombieModeActive()', context), false);

// The outbreak rewrites the clarinet, the fleeing tuba, and the trampled
// trumpet — never the distant flute.
const povStarts = [];
let povStops = 0;
context.__povStart = robot => povStarts.push(robot);
context.__povStop = () => { povStops++; };
vm.runInContext('povHooks = { start: __povStart, stop: __povStop };', context);
snapshots = makeSnapshots();
assert.equal(vm.runInContext('enableZombieMode(scene)', context), null);
assert.equal(povStarts[0], tubaRobot, 'The outbreak starts in POV as the doomed tuba player');
assert.deepEqual(seeks, [0], 'The outbreak rewinds to the opening count');
assert.equal(plays, 1, 'The outbreak starts the transport itself');
assert.equal(vm.runInContext('isZombieModeActive()', context), true);
const byRobot = robot => restores.filter(entry => entry.robot === robot);
assert.equal(byRobot(fluteRobot).length, 0, 'Untouched marchers keep their schedules');
assert.equal(byRobot(clarinetRobot).length, 1);
assert.equal(byRobot(tubaRobot).length, 1);
assert.equal(byRobot(trumpetRobot).length, 1);
assert.equal(byRobot(tromboneRobot).length, 1, 'Zombies veer into marchers near their path');

const zombie = byRobot(clarinetRobot)[0].snapshot;
assert.equal(zombie.instrumentPose, 'rest', 'Zombies lower their clarinets');
assert.ok(zombie.color.g > zombie.color.r && zombie.color.g > zombie.color.b, 'Zombie skin is green');
for (let count = 0; count <= 8; count++) {
  assert.ok(zombie.counts[count].position.equals(new Vector3(0, 0, 0.625 * count)),
    'The authored route is untouched through count 8');
}
assert.ok(!zombie.counts[9].position.equals(new Vector3(0, 0, 0.625 * 9)),
  'At count 8 the zombie marches out of line');
for (let count = 9; count < zombie.counts.length; count++) {
  assert.ok(Vector3.Distance(zombie.counts[count].position, zombie.counts[count - 1].position)
    <= 1.0 + 1e-9, 'Lurches stay within the zombie stride');
}

// The tuba keeps its place until scared, then runs — slower than the zombie,
// inside the field — and is caught anyway.
const fled = byRobot(tubaRobot)[0].snapshot;
assert.equal(fled.instrumentPose, 'playing', 'A fleeing tuba is terrified, not undead');
assert.equal(fled.color, snapshots[1].color, 'The tuba keeps its uniform');
const authoredTuba = new Vector3(12, 0, 12);
const firstFlee = fled.counts.findIndex(count => !count.position.equals(authoredTuba));
assert.ok(firstFlee > 8, 'The tuba holds formation until a zombie closes in');
for (let count = firstFlee; count < fled.counts.length; count++) {
  const step = Vector3.Distance(fled.counts[count].position, fled.counts[count - 1].position);
  assert.ok(step <= 0.65 + 1e-9, 'A sousaphone is heavy: flee steps stay bounded');
  assert.ok(Math.abs(fled.counts[count].position.x) <= 53.333 / 2 - 1 + 1e-9 &&
    Math.abs(fled.counts[count].position.z) <= 120 / 2 - 1 + 1e-9,
    'The tuba never flees past the in-field margin');
}
const eatenState = vm.runInContext('state.eaten', context);
assert.equal(eatenState.length, 1, 'The tuba is caught despite fleeing');
assert.equal(eatenState[0].robot, tubaRobot);
const catchCount = eatenState[0].count;
assert.ok(Vector3.Distance(fled.counts[Math.min(catchCount, fled.counts.length - 1)].position,
  zombie.counts[Math.min(catchCount, zombie.counts.length - 1)].position) <= 0.9 + 0.66,
  'The chase ends within arm\'s reach');

// The trumpet in the zombie's path is knocked flat where it stood, lies
// still through its incubation, then rises to join the hunt.
const infected = vm.runInContext('state.infected', context);
assert.equal(infected.length, 2, "Both marchers in the way of the horde are knocked down");
assert.ok(infected.some(entry => entry.robot === tromboneRobot),
  'A marcher two yards off the straight pursuit line is still sought out and bowled over');
const { knockCount, riseCount } = infected.find(entry => entry.robot === trumpetRobot);
assert.ok(knockCount > 8 && knockCount < 14, 'Knocked early on the opening pursuit line');
assert.ok(riseCount - knockCount >= 8 && riseCount - knockCount < 25,
  'Incubation is a bounded, per-marcher count');
const trampled = byRobot(trumpetRobot)[0].snapshot;
assert.equal(trampled.instrumentPose, 'playing', 'The infected keep their uniform until they rise');
assert.equal(trampled.color, snapshots[2].color);
const knockSpot = new Vector3(1.728, 0, 6.008);
for (let count = knockCount; count <= Math.min(riseCount, trampled.counts.length - 1); count++) {
  assert.ok(trampled.counts[count].position.equals(knockSpot),
    'The fallen lie where they were knocked through their incubation');
}

// The whole timeline is a pure function of the beat: falls, rises, and
// eating all reverse under scrubbing.
beat = knockCount;
vm.runInContext('updateZombieMode()', context);
assert.equal(trumpetRobot.rotation.x, 0, 'Still upright at the moment of impact');
beat = knockCount + 1;
vm.runInContext('updateZombieMode()', context);
assert.ok(Math.abs(trumpetRobot.rotation.x) > 1.3, 'Flat on the turf one count later');
assert.equal(colorSets.length, 0, 'Uniform unchanged while incubating');
beat = riseCount + 1;
vm.runInContext('updateZombieMode()', context);
assert.ok(Math.abs(trumpetRobot.rotation.x) < 1e-9, 'Back on their feet after rising');
assert.equal(colorSets.length, 1, 'Rising turns the uniform green');
assert.ok(colorSets[0].color.g > colorSets[0].color.r);
assert.equal(poseSets[0].pose, 'rest', 'Risen zombies lower their instruments');
beat = 2;
vm.runInContext('updateZombieMode()', context);
assert.equal(trumpetRobot.rotation.x, 0, 'Scrubbing back stands everyone up');
assert.equal(colorSets.length, 2, 'Scrubbing back restores the uniform');
assert.equal(colorSets[1].color, infected[0].originalColor);
assert.equal(poseSets[1].pose, 'playing');
assert.equal(tubaRobot.enabled, true, 'The tuba survives before the catch');
beat = catchCount + 1;
vm.runInContext('updateZombieMode()', context);
assert.equal(tubaRobot.enabled, false, 'The tuba is eaten at its catch count');
beat = 2;
vm.runInContext('updateZombieMode()', context);
assert.equal(tubaRobot.enabled, true, 'Scrubbing backward revives the fallen');
assert.equal(fluteRobot.enabled, true, 'Bystanders out of reach are never eaten');

// Determinism: the same band produces the identical outbreak, incubation
// included.
const signature = entries => JSON.stringify(entries.map(({ robot, snapshot }) =>
  [snapshot.instrument, snapshot.counts.map(c => [c.position.x, c.position.z, c.rotationY])]));
const firstOutbreak = signature(restores);
beat = catchCount + 40;
vm.runInContext('updateZombieMode()', context);
restores = [];
colorSets = [];
poseSets = [];
vm.runInContext('disableZombieMode()', context);
assert.equal(vm.runInContext('isZombieModeActive()', context), false);
assert.equal(povStops, 1, 'Disabling leaves the prey POV it started');
assert.equal(tubaRobot.enabled, true, 'Disabling revives every tuba');
assert.equal(trumpetRobot.rotation.x, 0, 'Disabling stands the fallen back up');
assert.equal(restores.length, 4, 'Disabling restores every rewritten schedule');
const restoredClarinet = restores.find(entry => entry.robot === clarinetRobot).snapshot;
assert.equal(restoredClarinet.instrumentPose, 'playing', 'Original pose returns');
assert.equal(restoredClarinet.counts.length, 12, 'Original route returns');
assert.ok(restoredClarinet.counts[9].position.equals(new Vector3(0, 0, 0.625 * 9)));
restores = [];
snapshots = makeSnapshots();
assert.equal(vm.runInContext('enableZombieMode(scene)', context), null);
assert.equal(signature(restores), firstOutbreak, 'Re-enabling replays the identical outbreak');
assert.equal(seeks.length, 2, 'Each outbreak rewinds once');
playbackRequested = true;
vm.runInContext('disableZombieMode()', context);
restores = [];
snapshots = makeSnapshots();
assert.equal(vm.runInContext('enableZombieMode(scene)', context), null);
assert.equal(seeks.length, 2, 'A pending Play is never cancelled by the outbreak seek');
playbackRequested = false;

// A requested outbreak (toggle or VR button) waits for the show to load
// instead of giving up, and a cancelled request never fires later.
vm.runInContext('disableZombieMode()', context);
const notices = [];
context.__notify = message => notices.push(message);
context.__allowed = () => true;
vm.runInContext('initOptions = { scene, allowed: __allowed, notify: __notify };', context);
zombieModeToggle.checked = false;
snapshots = [];
vm.runInContext('requestZombieMode()', context);
assert.equal(zombieModeToggle.checked, true, 'A request checks the Settings toggle immediately');
assert.equal(vm.runInContext('isZombieModeActive()', context), false, 'No band yet: the outbreak waits');
assert.equal(notices.length, 1, 'The wait is reported once');
vm.runInContext('updateZombieMode()', context);
vm.runInContext('updateZombieMode()', context);
assert.equal(notices.length, 1, 'Retries do not repeat the notice');
snapshots = makeSnapshots();
vm.runInContext('updateZombieMode()', context);
assert.equal(vm.runInContext('isZombieModeActive()', context), true,
  'The outbreak starts by itself once the show has loaded');
vm.runInContext('disableZombieMode()', context);
snapshots = [];
vm.runInContext('requestZombieMode()', context);
vm.runInContext('disableZombieMode()', context);
snapshots = makeSnapshots();
vm.runInContext('updateZombieMode()', context);
assert.equal(vm.runInContext('isZombieModeActive()', context), false,
  'Unchecking the toggle cancels a waiting request');
// A tuba pressed against the boundary gets away by sliding along it at a
// full sprint — never pinned against the edge, never off the field.
const wallClarinet = makeRobot();
const wallTuba = makeRobot();
restores = [];
snapshots = [
  { robot: wallClarinet, gaitIndex: 0, instrument: 'clarinet', instrumentPose: 'playing',
    color: new Color3(0.1, 0.4, 0.8), stepSizeYards: 0.625, scheduled: true,
    counts: [{ position: new Vector3(18, 0, 10), rotationY: 0 },
      { position: new Vector3(18, 0, 10), rotationY: 0 }] },
  { robot: wallTuba, gaitIndex: 0, instrument: 'sousaphone', instrumentPose: 'playing',
    color: new Color3(0.2, 0.2, 0.2), stepSizeYards: 0.625, scheduled: true,
    counts: [{ position: new Vector3(24.6, 0, 10), rotationY: 0 },
      { position: new Vector3(24.6, 0, 10), rotationY: 0 }] },
];
assert.equal(vm.runInContext('enableZombieMode(scene)', context), null);
const wallFled = restores.find(entry => entry.robot === wallTuba).snapshot;
const xMargin = 53.333 / 2 - 1;
let pinnedSteps = 0;
let farthestSlide = 0;
for (let count = 9; count < wallFled.counts.length; count++) {
  const here = wallFled.counts[count].position;
  assert.ok(Math.abs(here.x) <= xMargin + 1e-9, 'The escape stays inside the field margin');
  if (Vector3.Distance(here, wallFled.counts[count - 1].position) < 0.3) pinnedSteps++;
  farthestSlide = Math.max(farthestSlide, Math.abs(here.z - 10));
}
assert.equal(pinnedSteps, 0, 'A wall never pins the fleeing tuba in place');
assert.ok(farthestSlide >= 3, 'Blocked straight ahead, the tuba sprints along the boundary');
assert.ok(vm.runInContext('state.eaten', context).some(entry => entry.robot === wallTuba),
  'The horde still wins in the end');
vm.runInContext('disableZombieMode()', context);
snapshots = makeSnapshots();
vm.runInContext('enableZombieMode(scene)', context);

// Replacing the show disposes the saved robots; the outbreak quietly ends.
for (const robot of [clarinetRobot, tubaRobot, trumpetRobot, tromboneRobot]) robot.disposed = true;
vm.runInContext('updateZombieMode()', context);
assert.equal(vm.runInContext('isZombieModeActive()', context), false,
  'A replaced show ends the outbreak');
assert.equal(zombieModeToggle.checked, false, 'The Settings toggle unchecks itself');

console.log('Zombie mode checks passed: count-8 outbreak, bounded lurches and flees inside ' +
  'the field, knockdown/incubation/rise, beat-pure eating and falling with scrub ' +
  'reversal, atomic enable, exact restore, and a fully deterministic epidemic.');
