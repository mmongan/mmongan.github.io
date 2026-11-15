// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Zombie outbreak survival game: the immersive-VR form of zombie mode. You
// are a quad (tenor drum) player seen through the existing marcher POV, and
// the zombie clarinets chase YOU instead of the tubas. Steer with the
// sticks: the march follows where the controllers point (averaged when
// both are connected), leaving the head free to look around at the horde;
// without controllers (desktop) the POV look steers instead. Escape is
// earned one correct note at a time: a
// glowing ring calls out one drum, and only striking the called drum with
// the controller drumsticks takes a marching stride toward the facing
// before the ring jumps to another drum — keeping up with the calls is
// marching fast, while a silent or sloppy drummer stands frozen in place.
// Zombies shamble
// after you a little slower than your sprint, bowling over any marcher still
// standing in formation; the fallen rise after an incubation and join the
// horde. Touched by a zombie, you are caught and the game ends.
//
// This is an interactive game in the Drum Game mould, not drill playback:
// the transport pauses, every moving marcher is exempted through
// setRobotHeld (legs animated with the shared held-marcher walk), and
// stopping restores held marchers to their scheduled poses, uniforms,
// instrument poses, and upright roots. Nothing here touches authored routes,
// counts, or saves.

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import { getActiveControllers, setSceneManipulationLocked } from '../interaction/controllers';
import { getARScale, getARScaleRange } from '../xr/ar';
import {
  animateHeldMarcherWalk, captureMarcherSchedules, createPresentationMarcher, getDrillTransportState,
  getInstrumentPose, getMarcherInstrument, getRobotColor, isAnyPlaying, pauseAll, playAll,
  setMarcherInstrumentPose, setRobotColor, setRobotHeld,
} from '../robot/robot';
import { getTenorTemplate } from '../robot/percussionModels';
import { getSharedAudioContext } from '../audio/midiPlayback';
import type { InstrumentPose } from '../robot/robot';
import { registerZombieOutbreakGame } from '../robot/zombieMode';
import { FIELD_LENGTH_YARDS, FIELD_WIDTH_YARDS } from '../field/constants';

type GameCallbacks = {
  selectMarcher: (robot: TransformNode) => void;
  startPOV: () => void;
  isPOVActive: () => boolean;
  status: (message: string) => void;
};

type DrumStick = { mesh: Mesh; grip: TransformNode };

interface Runner {
  robot: TransformNode;
  heading: number;
  stridePhase: number;
  // A whistled-at zombie runs from this spot until the scare wears off.
  scaredUntil?: number;
  scaredFrom?: Vector3;
}

interface Referee {
  robot: TransformNode;
  burst: Mesh;
  burstStart: number;
  lastBlast: number;
}

interface Victim {
  robot: TransformNode;
  fallStart: number;
  riseStart: number;
  pitchSign: number;
  color: Color3;
  risen: boolean;
}

// The four quad drums in instrument-local coordinates (head centres), left
// to right. They are strike targets for the calls, not steering: the march
// direction follows the player's facing. These mirror createTenorTemplate
// in percussionModels.ts.
const DRUM_ZONES: { center: Vector3; radius: number }[] = [
  { center: new Vector3(-0.25, 0.87, 0.26), radius: 0.13 },
  { center: new Vector3(-0.115, 0.88, 0.42), radius: 0.15 },
  { center: new Vector3(0.115, 0.88, 0.42), radius: 0.15 },
  { center: new Vector3(0.25, 0.87, 0.26), radius: 0.13 },
];
const STICK_LENGTH = 0.34;
const HIT_COOLDOWN_MS = 200;
// Each correct (called) hit takes one marching stride toward the facing,
// played out at step speed. Chained calls approach 3.75 yd/s — just ahead
// of the horde — while a silent drummer stands still and is caught.
export const PLAYER_STEP_YARDS = 0.75;
export const PLAYER_STEP_YARDS_PER_SECOND = 3.9;
// A translucent ghost drum marches the player's authored drill route at
// this cadence. Stay within the alignment radius of it and the horde holds
// formation, marching its own captured drill paths; stray and it breaks
// loose to hunt. Reaching the final count still aligned wins the run.
export const GHOST_CADENCE_COUNTS_PER_SECOND = 1.8;
export const DRILL_ALIGN_YARDS = 4;
export const ZOMBIE_RUN_YARDS_PER_SECOND = 3.15;
export const OUTBREAK_TOUCH_YARDS = 0.8;
const FALL_MS = 500;
const INCUBATION_MIN_MS = 6000;
const INCUBATION_SPREAD_MS = 9000;
const FALL_PITCH = Math.PI * 0.46;
const RUN_STRIDE_YARDS = 0.75;
// Referees in black-and-white stripes hold fixed posts; a whistle blast
// scares every zombie in range into a brief retreat, so running past a ref
// buys breathing room.
const REFEREE_POSTS: [number, number][] = [[0, 0], [-14, -25], [14, 25]];
export const WHISTLE_RADIUS_YARDS = 7;
export const WHISTLE_SCARE_MS = 2500;
const WHISTLE_BLAST_COOLDOWN_MS = 1500;
const WHISTLE_BURST_MS = 600;
const MARGIN = 1;
const X_LIMIT = FIELD_WIDTH_YARDS / 2 - MARGIN;
const Z_LIMIT = FIELD_LENGTH_YARDS / 2 - MARGIN;
const ZOMBIE_SKIN = new Color3(0.47, 0.66, 0.33);

let callbacks: GameCallbacks | null = null;
let active = false;
let player: Runner | null = null;
let playerHorn: Mesh | null = null;
let chasers: Runner[] = [];
let victims: Victim[] = [];
let bystanders: TransformNode[] = [];
let savedColors = new Map<TransformNode, Color3>();
let wasPlaying = false;
let startedPOV = false;
let startTime = 0;
let lastHitTime = 0;
// Marching distance still owed from correct hits; zero means standing.
let stepDistanceLeft = 0;
// The ghost's position along the authored schedule, in counts.
let gameCount = 0;
let lastScheduledCount = 0;
let playerSchedule: { position: Vector3; rotationY: number }[] = [];
let scheduleByRobot = new Map<TransformNode, { position: Vector3; rotationY: number }[]>();
let onDrill = true;
// The lead ghost marks where the player should be now; the rest trail
// ahead along the route, fading into the distance.
const GHOST_TRAIL_DRUMS = 6;
const GHOST_TRAIL_SPACING_COUNTS = 2;
let ghostDrums: Mesh[] = [];
let ghostMaterials: StandardMaterial[] = [];
// The called drum: a glowing ring marks the one drum whose strike buys the
// escape sprint. Any drum steers; only the call grants speed. The next call
// advances by a deterministic hash of the hit count (never Math.random),
// always landing on a different drum.
let targetZoneIndex = 1;
let targetHits = 0;
let targetMarker: Mesh | null = null;
let targetMaterial: StandardMaterial | null = null;
let stickMaterial: StandardMaterial | null = null;
const sticks = new Map<string, DrumStick>();
let referees: Referee[] = [];
let stripeMaterial: StandardMaterial | null = null;
let burstMaterial: StandardMaterial | null = null;

export function isZombieOutbreakGameActive() {
  return active;
}

function fieldPosition(robot: TransformNode): Vector3 {
  return robot.position;
}

// Run while staying on the field: a direction pressing into a boundary
// slides along it at full speed instead of pinning against the edge.
function slideDirection(position: Vector3, heading: number): Vector3 {
  const direction = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  if ((position.x >= X_LIMIT && direction.x > 0) || (position.x <= -X_LIMIT && direction.x < 0)) {
    direction.x = 0;
  }
  if ((position.z >= Z_LIMIT && direction.z > 0) || (position.z <= -Z_LIMIT && direction.z < 0)) {
    direction.z = 0;
  }
  if (direction.lengthSquared() > 1e-12) direction.normalize();
  return direction;
}

function clampToField(position: Vector3) {
  position.x = Math.max(-X_LIMIT, Math.min(X_LIMIT, position.x));
  position.z = Math.max(-Z_LIMIT, Math.min(Z_LIMIT, position.z));
}

function moveRunner(runner: Runner, speedYards: number, deltaSeconds: number) {
  const position = fieldPosition(runner.robot);
  const direction = slideDirection(position, runner.heading);
  position.addInPlace(direction.scale(speedYards * deltaSeconds));
  clampToField(position);
  runner.robot.rotation.y = direction.lengthSquared() > 1e-12
    ? Math.atan2(direction.x, direction.z) : runner.heading;
  runner.stridePhase = (runner.stridePhase + speedYards * deltaSeconds / RUN_STRIDE_YARDS) % 1;
  // A stationary runner stands with legs neutral instead of frozen mid-stride.
  animateHeldMarcherWalk(runner.robot, runner.stridePhase, speedYards > 1e-6 ? 1 : 0);
}

function ensureStick(handedness: string, grip: TransformNode) {
  const existing = sticks.get(handedness);
  if (existing?.grip === grip) return existing;
  existing?.mesh.dispose();
  stickMaterial ??= new StandardMaterial('zombieOutbreakStickMaterial', scene);
  stickMaterial.diffuseColor = Color3.FromHexString('#d8ad67');
  stickMaterial.emissiveColor = Color3.FromHexString('#392511');
  const mesh = MeshBuilder.CreateCylinder(`zombieOutbreakStick-${handedness}`, {
    height: STICK_LENGTH, diameter: 0.012, tessellation: 8,
  }, scene);
  mesh.parent = grip;
  mesh.position.z = STICK_LENGTH / 2;
  mesh.rotation.x = Math.PI / 2;
  mesh.material = stickMaterial;
  mesh.isPickable = false;
  const stick = { mesh, grip };
  sticks.set(handedness, stick);
  return stick;
}

function clearSticks() {
  sticks.forEach(({ mesh }) => mesh.dispose());
  sticks.clear();
  stickMaterial?.dispose();
  stickMaterial = null;
}

// The glowing ring over the called drum, parented to the player's horn so
// it rides the carried quads through every turn.
function createTargetMarker() {
  if (!playerHorn) return;
  targetMaterial ??= (() => {
    const material = new StandardMaterial('zombieOutbreakTargetMaterial', scene);
    material.emissiveColor = Color3.FromHexString('#ffc83d');
    material.disableLighting = true;
    return material;
  })();
  targetMarker = MeshBuilder.CreateTorus('zombieOutbreakDrumTarget', {
    diameter: 1, thickness: 0.09, tessellation: 24,
  }, scene);
  targetMarker.parent = playerHorn;
  targetMarker.material = targetMaterial;
  targetMarker.isPickable = false;
  positionTargetMarker();
}

function positionTargetMarker() {
  if (!targetMarker) return;
  const zone = DRUM_ZONES[targetZoneIndex];
  targetMarker.position.copyFrom(zone.center);
  targetMarker.position.y += 0.015;
  targetMarker.scaling.setAll(zone.radius * 2);
}

function clearTargetMarker() {
  targetMarker?.dispose();
  targetMarker = null;
  targetMaterial?.dispose();
  targetMaterial = null;
}

// One strike on drum `zoneIndex`, from a stick tip or a desktop key: only
// the called (glowing) drum plays a marching step, and the call then jumps
// to a different drum. The cooldown debounces all strikes.
function strikeZone(zoneIndex: number, now: number) {
  if (!player || now - lastHitTime < HIT_COOLDOWN_MS) return;
  lastHitTime = now;
  if (zoneIndex === targetZoneIndex) {
    stepDistanceLeft += PLAYER_STEP_YARDS;
    targetHits += 1;
    targetZoneIndex = (targetZoneIndex + 1 +
      ((targetHits * 2654435761 >>> 0) % (DRUM_ZONES.length - 1))) % DRUM_ZONES.length;
    positionTargetMarker();
  }
}

// Strike detection for the controller drumsticks: a stick tip inside one of
// your own drum heads.
function checkDrumHits(now: number) {
  if (!player || !playerHorn || now - lastHitTime < HIT_COOLDOWN_MS) return;
  playerHorn.computeWorldMatrix(true);
  const hornMatrix = playerHorn.getWorldMatrix();
  for (const { grip } of sticks.values()) {
    grip.computeWorldMatrix(true);
    const tip = Vector3.TransformCoordinates(new Vector3(0, 0, STICK_LENGTH), grip.getWorldMatrix());
    for (let index = 0; index < DRUM_ZONES.length; index++) {
      const zone = DRUM_ZONES[index];
      const center = Vector3.TransformCoordinates(zone.center, hornMatrix);
      if (Vector3.DistanceSquared(tip, center) > zone.radius * zone.radius) continue;
      strikeZone(index, now);
      return;
    }
  }
}

// Desktop drumming: the number keys 1-4 strike the four drums left to right.
function onDrumKey(event: KeyboardEvent) {
  if (!active) return;
  const zoneIndex = ['1', '2', '3', '4'].indexOf(event.key);
  if (zoneIndex >= 0) strikeZone(zoneIndex, performance.now());
}

// A referee: a presentation marcher in a white uniform with black torso
// stripes and no instrument, holding a fixed post and facing the player.
function createReferee(parent: TransformNode, x: number, z: number): Referee {
  const robot = createPresentationMarcher(scene);
  robot.parent = parent;
  robot.position.set(x, 0, z);
  robot.setEnabled(true);
  setRobotColor(robot, Color3.White());
  robot.getChildMeshes(false).find(mesh => mesh.name === 'marcherHorn')?.setEnabled(false);
  stripeMaterial ??= (() => {
    const material = new StandardMaterial('zombieRefereeStripeMaterial', scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    return material;
  })();
  for (const height of [0.78, 0.9, 1.02, 1.14]) {
    const stripe = MeshBuilder.CreateCylinder('zombieRefereeStripe', {
      height: 0.05, diameter: 0.37, tessellation: 12,
    }, scene);
    stripe.parent = robot;
    stripe.position.y = height;
    stripe.material = stripeMaterial;
    stripe.isPickable = false;
  }
  burstMaterial ??= (() => {
    const material = new StandardMaterial('zombieRefereeBurstMaterial', scene);
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.alpha = 0;
    return material;
  })();
  const burst = MeshBuilder.CreateTorus('zombieRefereeWhistleBurst', {
    diameter: 1, thickness: 0.06, tessellation: 24,
  }, scene);
  burst.parent = robot;
  burst.position.y = 1.3;
  burst.material = burstMaterial;
  burst.isPickable = false;
  burst.setEnabled(false);
  return { robot, burst, burstStart: 0, lastBlast: 0 };
}

// A pea-whistle trill through the shared music AudioContext, when the
// browser has already unlocked it; silent otherwise.
function blowWhistleSound() {
  try {
    const context = getSharedAudioContext();
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    const osc = context.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 2600;
    const trill = context.createOscillator();
    trill.frequency.value = 45;
    const trillGain = context.createGain();
    trillGain.gain.value = 320;
    trill.connect(trillGain);
    trillGain.connect(osc.frequency);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(now);
    trill.start(now);
    osc.stop(now + 0.4);
    trill.stop(now + 0.4);
  } catch {
    // A whistle that cannot sound still scares zombies visually.
  }
}

// Referees watch the player and blast any zombie that strays into range.
function updateReferees(now: number) {
  if (!player) return;
  const playerPosition = fieldPosition(player.robot);
  for (const referee of referees) {
    const post = fieldPosition(referee.robot);
    const look = playerPosition.subtract(post);
    referee.robot.rotation.y = Math.atan2(look.x, look.z);
    let scared = false;
    for (const chaser of chasers) {
      if (chaser.robot.isDisposed()) continue;
      if (Vector3.Distance(fieldPosition(chaser.robot), post) > WHISTLE_RADIUS_YARDS) continue;
      chaser.scaredUntil = now + WHISTLE_SCARE_MS;
      chaser.scaredFrom = post.clone();
      scared = true;
    }
    if (scared && now - referee.lastBlast >= WHISTLE_BLAST_COOLDOWN_MS) {
      referee.lastBlast = now;
      referee.burstStart = now;
      referee.burst.setEnabled(true);
      blowWhistleSound();
    }
    if (referee.burst.isEnabled()) {
      const progress = (now - referee.burstStart) / WHISTLE_BURST_MS;
      if (progress >= 1) referee.burst.setEnabled(false);
      else {
        const spread = 0.5 + progress * WHISTLE_RADIUS_YARDS * 2;
        referee.burst.scaling.setAll(spread);
        if (burstMaterial) burstMaterial.alpha = 0.7 * (1 - progress);
      }
    }
  }
}

// Linear interpolation along a captured schedule, with facing wrapped the
// short way, clamped to the schedule's ends.
function sampleSchedule(counts: { position: Vector3; rotationY: number }[], at: number) {
  if (!counts.length) return null;
  const clamped = Math.max(0, Math.min(counts.length - 1, at));
  const index = Math.floor(clamped);
  const current = counts[index];
  const next = counts[Math.min(index + 1, counts.length - 1)];
  const t = clamped - index;
  const turn = next.rotationY - current.rotationY;
  return {
    position: Vector3.Lerp(current.position, next.position, t),
    rotationY: current.rotationY + Math.atan2(Math.sin(turn), Math.cos(turn)) * t,
  };
}

// The ghost drums: translucent clones of the shared tenor template strung
// along the authored route ahead of the player, each one fainter than the
// last, so the path to follow fades into the distance.
function createGhostDrums(parent: TransformNode | null) {
  const template = getTenorTemplate(scene);
  for (let index = 0; index < GHOST_TRAIL_DRUMS; index++) {
    const material = new StandardMaterial(`zombieGhostDrumMaterial${index}`, scene);
    material.emissiveColor = Color3.FromHexString('#7fe0ff');
    material.disableLighting = true;
    material.alpha = Math.max(0.07, 0.4 * (1 - index / GHOST_TRAIL_DRUMS));
    const ghost = template.clone(`zombieGhostDrum${index}`, null) as Mesh;
    ghost.setEnabled(true);
    ghost.isVisible = true;
    ghost.isPickable = false;
    ghost.material = material;
    ghost.parent = parent;
    ghostMaterials.push(material);
    ghostDrums.push(ghost);
  }
}

function clearGhostDrums() {
  ghostDrums.forEach(ghost => ghost.dispose());
  ghostDrums = [];
  ghostMaterials.forEach(material => material.dispose());
  ghostMaterials = [];
}

// The brass cure: running into a trumpet player turns a zombie back into a
// normal uninfected marcher — uniform and instrument pose restored, and
// released back to its scheduled drill spot among the bystanders, where it
// can be bitten again. The trumpet player stands unharmed.
function cureZombie(chaser: Runner) {
  const robot = chaser.robot;
  const color = savedColors.get(robot) ?? victims.find(victim => victim.robot === robot)?.color;
  chasers = chasers.filter(other => other !== chaser);
  victims = victims.filter(victim => victim.robot !== robot);
  savedColors.delete(robot);
  if (color) setRobotColor(robot, color);
  setMarcherInstrumentPose(robot, getInstrumentPose());
  robot.rotation.x = 0;
  setRobotHeld(robot, false);
  bystanders.push(robot);
}

function knockVictim(robot: TransformNode, culprit: Runner, now: number) {
  bystanders = bystanders.filter(standing => standing !== robot);
  setRobotHeld(robot, true);
  const shove = fieldPosition(robot).subtract(fieldPosition(culprit.robot));
  const facing = robot.rotation.y;
  victims.push({
    robot, fallStart: now,
    riseStart: now + FALL_MS + INCUBATION_MIN_MS +
      ((victims.length + 1) * 2654435761 >>> 0) % INCUBATION_SPREAD_MS,
    pitchSign: shove.x * Math.sin(facing) + shove.z * Math.cos(facing) >= 0 ? 1 : -1,
    color: getRobotColor(robot).clone(),
    risen: false,
  });
}

function updateVictims(now: number) {
  for (const victim of victims) {
    if (victim.robot.isDisposed()) continue;
    const fall = Math.min(1, Math.max(0, (now - victim.fallStart) / FALL_MS));
    const rise = Math.min(1, Math.max(0, (now - victim.riseStart) / FALL_MS));
    victim.robot.rotation.x = victim.pitchSign * FALL_PITCH * fall * fall * (1 - rise * rise);
    if (!victim.risen && now >= victim.riseStart) {
      victim.risen = true;
      setRobotColor(victim.robot, ZOMBIE_SKIN);
      setMarcherInstrumentPose(victim.robot, 'rest');
      chasers.push({ robot: victim.robot, heading: victim.robot.rotation.y, stridePhase: 0 });
    }
  }
}

function stopGame(message?: string) {
  if (!active) return;
  active = false;
  setSceneManipulationLocked(false);
  clearSticks();
  clearTargetMarker();
  clearGhostDrums();
  scheduleByRobot = new Map();
  playerSchedule = [];
  // Stand everyone up and hand them back to their schedules: releasing a
  // held marcher re-applies its scheduled pose at the paused beat. The band
  // pose, not a hardcoded one, comes back on the de-zombified.
  const bandPose: InstrumentPose = getInstrumentPose();
  const release = (robot: TransformNode, color: Color3 | undefined) => {
    if (robot.isDisposed()) return;
    robot.rotation.x = 0;
    if (color) {
      setRobotColor(robot, color);
      setMarcherInstrumentPose(robot, bandPose);
    }
    setRobotHeld(robot, false);
  };
  if (player) release(player.robot, undefined);
  for (const { robot } of chasers) release(robot, savedColors.get(robot));
  for (const victim of victims) release(victim.robot, victim.color);
  for (const referee of referees) referee.robot.dispose();
  referees = [];
  stripeMaterial?.dispose();
  stripeMaterial = null;
  burstMaterial?.dispose();
  burstMaterial = null;
  player = null;
  playerHorn = null;
  chasers = [];
  victims = [];
  bystanders = [];
  savedColors = new Map();
  if (wasPlaying) playAll();
  wasPlaying = false;
  startedPOV = false;
  if (message) callbacks?.status(message);
}

function update() {
  if (!active || !player || !callbacks) return;
  const now = performance.now();
  if (player.robot.isDisposed() || !callbacks.isPOVActive()) {
    stopGame('Zombie outbreak ended.');
    return;
  }
  const controllers = getActiveControllers();
  const connected = new Set<string>();
  for (const [handedness, controller] of controllers) {
    if (!controller.grip) continue;
    connected.add(handedness);
    ensureStick(handedness, controller.grip);
  }
  for (const [handedness, stick] of sticks) {
    if (!connected.has(handedness)) {
      stick.mesh.dispose();
      sticks.delete(handedness);
    }
  }
  checkDrumHits(now);
  // The called drum's ring pulses so it reads at a glance mid-chase.
  if (targetMaterial) targetMaterial.alpha = 0.55 + 0.3 * Math.sin(now / 110);
  const deltaSeconds = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
  // Steer with the sticks: the march follows where the controllers point
  // (averaged when both are connected), leaving the head free to look
  // around at the horde. Without controllers (desktop) the POV look steers.
  // Directions convert from world into field-local space, so tabletop/room
  // transforms of the field never skew the march.
  const fieldParent = player.robot.parent;
  if (fieldParent instanceof TransformNode) {
    const inverse = Matrix.Invert(fieldParent.getWorldMatrix());
    const pointing = Vector3.Zero();
    for (const { grip } of sticks.values()) {
      grip.computeWorldMatrix(true);
      pointing.addInPlace(Vector3.TransformNormal(Vector3.Forward(), grip.getWorldMatrix()));
    }
    if (sticks.size > 0) {
      const local = Vector3.TransformNormal(pointing, inverse);
      local.y = 0;
      // Opposed sticks cancel out; the march then keeps its last heading.
      if (local.lengthSquared() > 1e-6) player.heading = Math.atan2(local.x, local.z);
    } else {
      const camera = scene.activeCamera;
      if (camera instanceof TargetCamera) {
        const look = Vector3.TransformNormal(camera.getDirection(Vector3.Forward()), inverse);
        look.y = 0;
        if (look.lengthSquared() > 1e-6) player.heading = Math.atan2(look.x, look.z);
      }
    }
  }
  // The player advances only while a called step is still underway.
  const travel = Math.min(stepDistanceLeft, PLAYER_STEP_YARDS_PER_SECOND * deltaSeconds);
  stepDistanceLeft -= travel;
  moveRunner(player, deltaSeconds > 0 ? travel / deltaSeconds : 0, deltaSeconds);
  // The ghost drum marches on at its own cadence; the player chases it.
  gameCount = Math.min(lastScheduledCount, gameCount + GHOST_CADENCE_COUNTS_PER_SECOND * deltaSeconds);
  const playerPosition = fieldPosition(player.robot);
  const ghostPose = sampleSchedule(playerSchedule, gameCount);
  ghostDrums.forEach((ghost, index) => {
    if (ghost.isDisposed()) return;
    const at = gameCount + index * GHOST_TRAIL_SPACING_COUNTS;
    const pose = at <= lastScheduledCount ? sampleSchedule(playerSchedule, at) : null;
    // Trail drums past the end of the show wink out instead of piling up.
    ghost.setEnabled(!!pose);
    if (pose) {
      ghost.position.copyFrom(pose.position);
      ghost.rotation.y = pose.rotationY;
    }
  });
  // Aligned with the ghost, the horde holds formation; strayed, it hunts.
  onDrill = !ghostPose || Vector3.Distance(playerPosition, ghostPose.position) <= DRILL_ALIGN_YARDS;
  if (ghostPose && lastScheduledCount >= 1 && gameCount >= lastScheduledCount && onDrill) {
    stopGame(`You marched the whole show and the horde never got you — ${victims.length} marchers ` +
      'turned. Toggle zombie mode to run again.');
    return;
  }
  updateReferees(now);
  for (const chaser of chasers) {
    if (chaser.robot.isDisposed()) continue;
    const gap = playerPosition.subtract(fieldPosition(chaser.robot));
    gap.y = 0;
    if (gap.length() <= OUTBREAK_TOUCH_YARDS) {
      const survived = Math.round((now - startTime) / 1000);
      stopGame(`The horde got you after ${survived}s — ${victims.length} marchers turned. ` +
        'Toggle zombie mode to run again.');
      return;
    }
    if (onDrill) {
      // In formation: the zombie marches its own captured drill path at the
      // ghost's count, with no knockdowns.
      const sample = sampleSchedule(scheduleByRobot.get(chaser.robot) ?? [], gameCount);
      if (sample) {
        const toTarget = sample.position.subtract(fieldPosition(chaser.robot));
        toTarget.y = 0;
        const distance = toTarget.length();
        if (distance > 0.01) {
          chaser.heading = Math.atan2(toTarget.x, toTarget.z);
          moveRunner(chaser,
            Math.min(ZOMBIE_RUN_YARDS_PER_SECOND, distance / Math.max(deltaSeconds, 1e-3)), deltaSeconds);
        } else {
          chaser.robot.rotation.y = sample.rotationY;
          animateHeldMarcherWalk(chaser.robot, chaser.stridePhase, 0);
        }
      } else {
        animateHeldMarcherWalk(chaser.robot, chaser.stridePhase, 0);
      }
      continue;
    }
    // A whistled-at zombie runs from the referee until the scare wears off.
    if (chaser.scaredUntil !== undefined && now < chaser.scaredUntil && chaser.scaredFrom) {
      const flee = fieldPosition(chaser.robot).subtract(chaser.scaredFrom);
      flee.y = 0;
      if (flee.lengthSquared() > 1e-12) chaser.heading = Math.atan2(flee.x, flee.z);
    } else {
      chaser.heading = Math.atan2(gap.x, gap.z);
    }
    moveRunner(chaser, ZOMBIE_RUN_YARDS_PER_SECOND, deltaSeconds);
    for (const standing of bystanders) {
      if (standing.isDisposed()) continue;
      if (Vector3.Distance(fieldPosition(standing), fieldPosition(chaser.robot)) > OUTBREAK_TOUCH_YARDS) continue;
      if (getMarcherInstrument(standing) === 'trumpet') {
        cureZombie(chaser);
        break;
      }
      knockVictim(standing, chaser, now);
    }
  }
  updateVictims(now);
}

// Attempts to start the survival game; false falls zombie mode back to the
// scripted cinematic outbreak (no quad player, or an unforced request
// outside immersive VR).
function tryStartGame(force = false): boolean {
  if (active) return true;
  if (!callbacks) return false;
  // The Settings toggle's request becomes the game only in immersive VR;
  // the Outbreak! button forces it on any platform — on desktop the POV
  // look steers and the 1-4 keys strike the drums.
  if (!force && scene.activeCamera?.getClassName() !== 'WebXRCamera') return false;
  if (getARScale() < getARScaleRange().max) return false;
  const snapshots = captureMarcherSchedules().filter(snapshot => !snapshot.robot.isDisposed());
  const quad = snapshots.find(snapshot => snapshot.instrument === 'tenors');
  const clarinets = snapshots.filter(snapshot => snapshot.instrument === 'clarinet');
  if (!quad || !clarinets.length) return false;
  callbacks.selectMarcher(quad.robot);
  if (!callbacks.isPOVActive()) {
    callbacks.startPOV();
    startedPOV = callbacks.isPOVActive();
    if (!startedPOV) return false;
  }
  wasPlaying = isAnyPlaying();
  pauseAll();
  savedColors = new Map();
  playerHorn = quad.robot.getChildMeshes(false).find(mesh => mesh.name === 'marcherHorn') as Mesh ?? null;
  player = { robot: quad.robot, heading: quad.robot.rotation.y, stridePhase: 0 };
  setRobotHeld(quad.robot, true);
  chasers = clarinets.map((snapshot) => {
    savedColors.set(snapshot.robot, getRobotColor(snapshot.robot).clone());
    setRobotColor(snapshot.robot, ZOMBIE_SKIN);
    setMarcherInstrumentPose(snapshot.robot, 'rest');
    setRobotHeld(snapshot.robot, true);
    return { robot: snapshot.robot, heading: snapshot.robot.rotation.y, stridePhase: 0 };
  });
  victims = [];
  bystanders = snapshots
    .filter(snapshot => snapshot.robot !== quad.robot &&
      snapshot.instrument !== 'clarinet' && snapshot.robot.isEnabled())
    .map(snapshot => snapshot.robot);
  const fieldRoot = quad.robot.parent;
  referees = fieldRoot instanceof TransformNode
    ? REFEREE_POSTS.map(([x, z]) => createReferee(fieldRoot, x, z)) : [];
  // The drill is the course: the ghost trail rides the player's captured
  // schedule from the transport's current beat, and every marcher's
  // schedule drives the horde while the player stays aligned.
  scheduleByRobot = new Map(snapshots.map(snapshot => [snapshot.robot, snapshot.counts]));
  playerSchedule = quad.counts;
  lastScheduledCount = playerSchedule.length - 1;
  gameCount = Math.max(0, Math.min(getDrillTransportState().beat, lastScheduledCount));
  onDrill = true;
  createGhostDrums(fieldRoot instanceof TransformNode ? fieldRoot : null);
  startTime = performance.now();
  lastHitTime = 0;
  stepDistanceLeft = 0;
  // The first call is an inner drum, so the opening escape note does not
  // wheel the run hard to one side.
  targetZoneIndex = 1;
  targetHits = 0;
  createTargetMarker();
  active = true;
  setSceneManipulationLocked(true);
  const desktop = scene.activeCamera?.getClassName() !== 'WebXRCamera';
  callbacks.status('Zombie outbreak: you are the quad player. ' +
    (desktop
      ? 'March where you look, and the keys 1-4 strike the drums — hit the glowing one to step. '
      : 'Your drumsticks steer: march where they point, look around freely, and strike the ' +
        'glowing drum to step. ') +
    'Follow the fading trail of ghost drums — march your drill and the horde marches theirs, ' +
    'but stray from the path and they come for you.');
  return true;
}

scene.onBeforeRenderObservable.add(update);
scene.onDisposeObservable.addOnce(() => {
  wasPlaying = false;
  stopGame();
  window.removeEventListener('keydown', onDrumKey);
});

export function initZombieOutbreakGame(gameCallbacks: GameCallbacks) {
  callbacks = gameCallbacks;
  window.addEventListener('keydown', onDrumKey);
  registerZombieOutbreakGame({
    tryStart: tryStartGame,
    stop: () => stopGame('Zombie outbreak stopped.'),
    isActive: () => active,
  });
}
