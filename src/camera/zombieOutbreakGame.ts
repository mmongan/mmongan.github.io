// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Zombie outbreak survival game: the immersive-VR form of zombie mode. You
// are a quad (tenor drum) player seen through the existing marcher POV, and
// the zombie clarinets chase YOU instead of the tubas. Steer by facing:
// you march wherever you look — headset in VR, POV look on desktop — and
// the carried quads swing with the look, keeping the drums and the called
// ring squarely in front; the controllers only strike. Escape is
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

import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import { getActiveControllers, isGripPressed, setSceneManipulationLocked } from '../interaction/controllers';
import { getARScale, getARScaleRange, setARScale } from '../xr/ar';
import {
  animateHeldMarcherWalk, captureMarcherSchedules, createPresentationMarcher, getDrillTransportState,
  getInstrumentPose, getMarcherEyePose, getMarcherInstrument, getRobotColor, isAnyPlaying, pauseAll,
  playAll, setMarcherInstrumentPose, setMarcherZombified, setRobotColor, setRobotHeld,
} from '../robot/robot';
import { absorbMarcherPOVEyeShift } from './marcherPOV';
import { getTenorTemplate } from '../robot/percussionModels';
import { getSharedAudioContext } from '../audio/midiPlayback';
import type { InstrumentPose } from '../robot/robot';
import { registerZombieOutbreakGame } from '../robot/zombieMode';
import { FIELD_LENGTH_YARDS, FIELD_WIDTH_YARDS } from '../field/constants';

type GameCallbacks = {
  selectMarcher: (robot: TransformNode) => void;
  startPOV: () => void;
  stopPOV: () => void;
  isPOVActive: () => boolean;
  status: (message: string) => void;
};

// tryStart outcomes: 'started' runs the game, 'declined' falls zombie mode
// back to the scripted cinematic, and 'retry' keeps the request pending
// (the XR session or POV camera is still settling), retried per frame.
export type ZombieGameStart = 'started' | 'retry' | 'declined';

type DrumStick = { mesh: Mesh; grip: TransformNode; material: StandardMaterial };

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
// During the game the player's quads ride farther forward and higher
// (instrument-local units) than the parade mount — a game-ergonomic pose,
// not the real carriage — putting the heads out in front at chest height
// where sticks land easily; the strike zones and the called-drum ring
// follow the horn's matrix automatically.
export const PLAYER_DRUM_FORWARD = 0.16;
export const PLAYER_DRUM_RAISE = 0.22;
// Grabbing the drums: holding a controller squeeze with the grip at the
// carriage — within this reach of any drum head, no handle, no precise
// timing; a squeeze held while reaching in works — grabs the whole
// carriage into that hand. While held the drums are rigid to the hand in
// world coordinates: the hand's motion carries them anywhere and the
// wrist turns them to any angle, even as the body keeps turning with the
// look, and the rings and strike zones ride along. Releasing bakes the
// pose back into the marcher's frame, so wherever you rack them they
// stay there in front of you through every turn. The grabbing hand's
// stick plays nothing until it lets go, and game over still restores the
// parade mount. Drum strikes never involve the squeeze, so drumming
// cannot grab.
export const DRUM_GRAB_YARDS = 0.3;
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
// Your timing is the horde's leash: every landed strike is scored by how
// close it fell to the beat, folded into a rolling precision. Dead-on
// drumming pins formation zombies to their exact drill paths; sloppy
// timing frees them to wander up to this far off their spots.
export const ZOMBIE_ROAM_YARDS = 6;
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
// The horn's parade-mount pose, restored when the game ends.
let playerHornHome: Vector3 | null = null;
let playerHornHomeRotation: Vector3 | null = null;
let chasers: Runner[] = [];
let victims: Victim[] = [];
let bystanders: TransformNode[] = [];
let savedColors = new Map<TransformNode, Color3>();
let wasPlaying = false;
let startedPOV = false;
// The field scale before the game forced 1:1, restored on stop.
let savedARScale: number | null = null;
let startTime = 0;
// Marching distance still owed from correct hits; zero means standing.
let stepDistanceLeft = 0;
// Tripped over a corpse: no steps play until the stumble wears off.
let stumbleUntil = 0;
// Corpses the player currently overlaps, so one contact trips only once.
const corpseContacts = new Set<TransformNode>();
// Bonked healthy marchers, staggering as bait until they recover or fall.
let decoys: { robot: TransformNode; until: number }[] = [];
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
// The beat ghost: a brighter gold drum at the exact route spot where the
// player should be standing when the next beat — the strike moment —
// lands. Its glow swells with the same beat pulse as the called rings.
let beatGhost: Mesh | null = null;
let beatGhostMaterial: StandardMaterial | null = null;
// The guide ghost: once the player strays past the alignment radius the
// trail can be anywhere, even behind them. This brighter ghost drum
// stands a few yards from the player in the exact direction of the
// current drill spot — so turning in place always finds a ghost pointing
// the way — and keeps leading until the trail takes over again.
export const GUIDE_GHOST_LEAD_YARDS = 3;
let guideGhost: Mesh | null = null;
let guideGhostMaterial: StandardMaterial | null = null;
// The turn arrow: facing is steering, so facing the wrong way IS marching
// the wrong way. When the heading strays past this angle from the drill
// direction — toward the spot when strayed, along the route when aligned
// — a floating gold arrow hovers ahead of the face and physically points
// the way to turn. Facing right (or a route hold) hides it.
export const TURN_ARROW_MIN_RAD = 0.35;
let turnArrow: TransformNode | null = null;
let turnArrowMaterial: StandardMaterial | null = null;
// The called drum: a glowing ring marks the one drum whose strike buys the
// escape sprint. Any drum steers; only the call grants speed. The next call
// advances by a deterministic hash of the hit count (never Math.random),
// always landing on a different drum.
// The call names drums AND hands, like a sticking: gold calls the right
// stick, cyan the left — the project's left/right color language (as on
// the marcher footprints). Some calls are double stops: two drums lit at
// once, one per hand, struck together within the pairing window for a
// double stride. Desktop keys are hand-agnostic and may complete a double
// with two quick presses. The sequence advances by a deterministic hash.
const CALL_RIGHT_COLOR = '#ffc83d';
const CALL_LEFT_COLOR = '#4fd9e0';
// The future footsteps: flat sole prints on the turf at each upcoming
// count of the drill — cyan left, gold right, the same left/right color
// language as the sticks and rings (odd counts land the left foot, as
// drill steps off on the left) — fading as they reach into the future.
// A count with no travel (a hold) leaves no print. They share the ghost
// trail's lifecycle and parent, so tabletop transforms carry them.
const FUTURE_FOOTPRINTS = 16;
const FOOT_OFFSET_YARDS = 0.12;
const FOOTPRINT_MIN_TRAVEL_YARDS = 0.05;
let footprints: { mesh: Mesh; material: StandardMaterial }[] = [];
export const DOUBLE_WINDOW_MS = 300;
interface CallHalf { zone: number; hand: 'left' | 'right' }
let currentCall: CallHalf[] = [{ zone: 1, hand: 'right' }];
let satisfiedHands = new Set<'left' | 'right'>();
let firstHalfAt = 0;
let targetHits = 0;
const lastHitByHand = { left: 0, right: 0, any: 0 };
// Rolling beat accuracy of landed strikes: 1 is metronome-perfect, 0 is a
// half-beat off. Starts neutral.
let strikePrecision = 0.5;
let targetMarkers: { mesh: Mesh; material: StandardMaterial; dimmed: boolean; baseScale: number }[] = [];
const sticks = new Map<string, DrumStick>();
// Plain hickory, worn only by a stick whose handedness is unknown.
const STICK_NEUTRAL_DIFFUSE = Color3.FromHexString('#d8ad67');
const STICK_NEUTRAL_EMISSIVE = Color3.FromHexString('#392511');
// The sticks match the player's hands permanently — left is always cyan,
// right is always gold, the same left/right language as the rings and the
// footprints. The colors never swap; the call brightens the called hand's
// glow instead of recoloring a stick.
function stickColor(handedness: string): Color3 | null {
  if (handedness === 'left') return Color3.FromHexString(CALL_LEFT_COLOR);
  if (handedness === 'right') return Color3.FromHexString(CALL_RIGHT_COLOR);
  return null;
}
let drumGrabHand: string | null = null;
// The horn's world pose expressed in the grabbing grip's frame, captured
// at grab time; carrying it by the grip's live world matrix keeps the
// drums rigid to the hand.
let drumGrabRelative: Matrix | null = null;
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
  existing?.material.dispose();
  // Each stick owns its material so it can wear its hand's fixed color.
  const material = new StandardMaterial(`zombieOutbreakStickMaterial-${handedness}`, scene);
  const color = stickColor(handedness);
  material.diffuseColor.copyFrom(color ?? STICK_NEUTRAL_DIFFUSE);
  material.emissiveColor.copyFrom(color?.scale(0.15) ?? STICK_NEUTRAL_EMISSIVE);
  const mesh = MeshBuilder.CreateCylinder(`zombieOutbreakStick-${handedness}`, {
    height: STICK_LENGTH, diameter: 0.012, tessellation: 8,
  }, scene);
  mesh.parent = grip;
  mesh.position.z = STICK_LENGTH / 2;
  mesh.rotation.x = Math.PI / 2;
  mesh.material = material;
  mesh.isPickable = false;
  // A rounded bead heads each stick, centered on the hit-test tip point.
  const bead = MeshBuilder.CreateSphere(`zombieOutbreakStickBead-${handedness}`, {
    diameter: 0.026, segments: 10,
  }, scene);
  bead.parent = mesh;
  bead.position.y = STICK_LENGTH / 2;
  bead.material = material;
  bead.isPickable = false;
  const stick = { mesh, grip, material };
  sticks.set(handedness, stick);
  return stick;
}

function clearSticks() {
  sticks.forEach(({ mesh, material }) => { mesh.dispose(); material.dispose(); });
  sticks.clear();
}

// Each stick keeps its hand's fixed color — left cyan, right gold, never
// swapped — and shows the call by brightness alone: the called hand's
// stick glows bright while its half is outstanding, dimming once it
// lands, when its hand has no call, or while it is busy holding the drums.
function updateStickColors() {
  for (const [handedness, stick] of sticks) {
    const hand = handedness === 'left' || handedness === 'right' ? handedness : null;
    const color = stickColor(handedness);
    if (!color) {
      stick.material.diffuseColor.copyFrom(STICK_NEUTRAL_DIFFUSE);
      stick.material.emissiveColor.copyFrom(STICK_NEUTRAL_EMISSIVE);
      continue;
    }
    const called = hand !== null && handedness !== drumGrabHand &&
      !satisfiedHands.has(hand) && currentCall.some(half => half.hand === hand);
    stick.material.diffuseColor.copyFrom(color);
    stick.material.emissiveColor.copyFrom(color.scale(called ? 0.55 : 0.15));
  }
}

// A floating gold arrow riding ahead of the player's face (a child of the
// marcher, so it stays in view through every turn), spun each frame to
// the wrapped heading error so it points the way to turn.
function createTurnArrow(robot: TransformNode) {
  turnArrowMaterial = new StandardMaterial('zombieTurnArrowMaterial', scene);
  turnArrowMaterial.emissiveColor = Color3.FromHexString('#ffd34f');
  turnArrowMaterial.disableLighting = true;
  turnArrowMaterial.alpha = 0.8;
  turnArrow = new TransformNode('zombieTurnArrow', scene);
  turnArrow.parent = robot;
  turnArrow.position.set(0, 1.8, 0.9);
  const shaft = MeshBuilder.CreateCylinder('zombieTurnArrowShaft', {
    height: 0.4, diameter: 0.045, tessellation: 10,
  }, scene);
  shaft.parent = turnArrow;
  shaft.rotation.x = Math.PI / 2;
  const head = MeshBuilder.CreateCylinder('zombieTurnArrowHead', {
    height: 0.2, diameterBottom: 0.14, diameterTop: 0, tessellation: 12,
  }, scene);
  head.parent = turnArrow;
  head.rotation.x = Math.PI / 2;
  head.position.z = 0.3;
  for (const mesh of [shaft, head]) {
    mesh.material = turnArrowMaterial;
    mesh.isPickable = false;
  }
  turnArrow.setEnabled(false);
}

function clearTurnArrow() {
  turnArrow?.dispose();
  turnArrow = null;
  turnArrowMaterial?.dispose();
  turnArrowMaterial = null;
}

// Manual drum placement: a squeeze held with the grip at the carriage —
// within reach of any drum head, whether pressed there or on the way in —
// grabs the drums into that hand. While held, the horn's world pose is
// the grab-time offset carried by the grip's live world matrix, mapped
// back into the marcher's frame each frame, so the drums stay rigid to
// the hand in world coordinates — any position, any angle — even as the
// body keeps turning with the look. Releasing bakes the held pose into
// plain Euler angles on the mount, so it rides the view again.
function updateDrumGrab(controllers: ReturnType<typeof getActiveControllers>) {
  if (!playerHorn || playerHorn.isDisposed()) return;
  const parent = playerHorn.parent;
  if (!(parent instanceof TransformNode)) return;
  if (drumGrabHand !== null) {
    const controller = controllers.get(drumGrabHand);
    if (!controller?.grip || !isGripPressed(controller) || !drumGrabRelative) {
      if (playerHorn.rotationQuaternion) {
        playerHorn.rotation.copyFrom(playerHorn.rotationQuaternion.toEulerAngles());
        playerHorn.rotationQuaternion = null;
      }
      drumGrabHand = null;
      drumGrabRelative = null;
    } else {
      const hornWorld = drumGrabRelative.multiply(controller.grip.computeWorldMatrix(true));
      const hornLocal = hornWorld.multiply(Matrix.Invert(parent.computeWorldMatrix(true)));
      const rotation = playerHorn.rotationQuaternion ?? new Quaternion();
      hornLocal.decompose(undefined, rotation, playerHorn.position);
      playerHorn.rotationQuaternion = rotation;
    }
  } else {
    playerHorn.computeWorldMatrix(true);
    const hornMatrix = playerHorn.getWorldMatrix();
    for (const [handedness, controller] of controllers) {
      if (!controller.grip || !isGripPressed(controller)) continue;
      const gripPosition = controller.grip.computeWorldMatrix(true).getTranslation();
      const nearDrums = DRUM_ZONES.some(zone => Vector3.Distance(
        gripPosition, Vector3.TransformCoordinates(zone.center, hornMatrix)) <= DRUM_GRAB_YARDS);
      if (!nearDrums) continue;
      drumGrabHand = handedness;
      drumGrabRelative = hornMatrix.multiply(Matrix.Invert(controller.grip.getWorldMatrix()));
      break;
    }
  }
}

// The glowing ring over the called drum, parented to the player's horn so
// it rides the carried quads through every turn.
function createTargetMarkers() {
  if (!playerHorn) return;
  targetMarkers = [0, 1].map((index) => {
    const material = new StandardMaterial(`zombieOutbreakTargetMaterial${index}`, scene);
    material.disableLighting = true;
    const mesh = MeshBuilder.CreateTorus(index === 0 ? 'zombieOutbreakDrumTarget' : 'zombieOutbreakDrumTarget2', {
      diameter: 1, thickness: 0.09, tessellation: 24,
    }, scene);
    mesh.parent = playerHorn;
    mesh.material = material;
    mesh.isPickable = false;
    return { mesh, material, dimmed: false, baseScale: 1 };
  });
  applyTargetCall();
}

// Lays the ring(s) on the called drum(s), tinted for the called hand; a
// satisfied half of a double stop dims until the pair completes.
function applyTargetCall() {
  targetMarkers.forEach((marker, index) => {
    if (marker.mesh.isDisposed()) return;
    const half = currentCall[index];
    marker.mesh.setEnabled(!!half);
    if (!half) return;
    const zone = DRUM_ZONES[half.zone];
    marker.mesh.position.copyFrom(zone.center);
    marker.mesh.position.y += 0.015;
    marker.baseScale = zone.radius * 2;
    marker.mesh.scaling.setAll(marker.baseScale);
    marker.material.emissiveColor =
      Color3.FromHexString(half.hand === 'right' ? CALL_RIGHT_COLOR : CALL_LEFT_COLOR);
    marker.dimmed = satisfiedHands.has(half.hand);
  });
}

// The next call in the deterministic sequence: roughly a quarter are double
// stops on two different drums (the left hand on the leftward drum).
function advanceCall() {
  targetHits += 1;
  satisfiedHands.clear();
  const hash = (targetHits * 2654435761) >>> 0;
  const first = hash % DRUM_ZONES.length;
  if (hash % 4 === 1) {
    const second = (first + 1 + ((hash >>> 8) % (DRUM_ZONES.length - 1))) % DRUM_ZONES.length;
    const [lo, hi] = first < second ? [first, second] : [second, first];
    currentCall = [{ zone: lo, hand: 'left' }, { zone: hi, hand: 'right' }];
  } else {
    currentCall = [{ zone: first, hand: hash % 2 === 0 ? 'right' : 'left' }];
  }
  applyTargetCall();
}

function clearTargetMarkers() {
  targetMarkers.forEach(({ mesh, material }) => {
    mesh.dispose();
    material.dispose();
  });
  targetMarkers = [];
}

// One strike on drum `zoneIndex`, from a stick tip or a desktop key: only
// the called (glowing) drum plays a marching step, and the call then jumps
// to a different drum. The cooldown debounces all strikes.
function strikeZone(zoneIndex: number, now: number, hand?: 'left' | 'right') {
  // A stumbling drummer's sticks play nothing until the stumble wears off,
  // and each hand debounces on its own so a double stop can land together.
  if (!player || now < stumbleUntil) return;
  const gate = hand ?? 'any';
  if (now - lastHitByHand[gate] < HIT_COOLDOWN_MS) return;
  lastHitByHand[gate] = now;
  // A half-played double stop that aged past the window starts over.
  if (satisfiedHands.size > 0 && now - firstHalfAt > DOUBLE_WINDOW_MS) satisfiedHands.clear();
  const half = currentCall.find(part => part.zone === zoneIndex &&
    (!hand || part.hand === hand) && !satisfiedHands.has(part.hand));
  if (!half) return;
  if (satisfiedHands.size === 0) firstHalfAt = now;
  satisfiedHands.add(half.hand);
  // Score the strike against the beat and fold it into the rolling
  // precision that leashes the formation zombies.
  const phase = gameCount % 1;
  const accuracy = 1 - Math.min(phase, 1 - phase) * 2;
  strikePrecision += (accuracy - strikePrecision) * 0.35;
  if (satisfiedHands.size < currentCall.length) {
    // Half a double stop: dim that ring and wait for its partner.
    applyTargetCall();
    return;
  }
  // The whole call lands: one stride per called drum. One distinct hit,
  // one distinct step — a strike landing while a step is still playing
  // out starts this call's steps fresh instead of banking distance, so
  // drumming ahead of your feet never blurs the march into a glide.
  stepDistanceLeft = PLAYER_STEP_YARDS * currentCall.length;
  advanceCall();
}

// Strike detection for the controller drumsticks: a stick tip inside one of
// your own drum heads.
function checkDrumHits(now: number) {
  if (!player || !playerHorn) return;
  playerHorn.computeWorldMatrix(true);
  const hornMatrix = playerHorn.getWorldMatrix();
  for (const [handedness, { grip }] of sticks) {
    // The hand holding the drums is adjusting, not drumming.
    if (handedness === drumGrabHand) continue;
    grip.computeWorldMatrix(true);
    const tip = Vector3.TransformCoordinates(new Vector3(0, 0, STICK_LENGTH), grip.getWorldMatrix());
    for (let index = 0; index < DRUM_ZONES.length; index++) {
      const zone = DRUM_ZONES[index];
      const center = Vector3.TransformCoordinates(zone.center, hornMatrix);
      if (Vector3.DistanceSquared(tip, center) > zone.radius * zone.radius) continue;
      // The striking hand rides along so the call's sticking is enforced.
      // Each stick strikes independently, letting a double stop land with
      // both hands in the same frame.
      strikeZone(index, now,
        handedness === 'left' ? 'left' : handedness === 'right' ? 'right' : undefined);
      break;
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
  beatGhostMaterial = new StandardMaterial('zombieBeatGhostMaterial', scene);
  beatGhostMaterial.emissiveColor = Color3.FromHexString('#ffe9a8');
  beatGhostMaterial.disableLighting = true;
  beatGhostMaterial.alpha = 0.5;
  beatGhost = template.clone('zombieBeatGhost', null) as Mesh;
  beatGhost.setEnabled(true);
  beatGhost.isVisible = true;
  beatGhost.isPickable = false;
  beatGhost.material = beatGhostMaterial;
  beatGhost.parent = parent;
  guideGhostMaterial = new StandardMaterial('zombieGuideGhostMaterial', scene);
  guideGhostMaterial.emissiveColor = Color3.FromHexString('#b9f3ff');
  guideGhostMaterial.disableLighting = true;
  guideGhostMaterial.alpha = 0.55;
  guideGhost = template.clone('zombieGuideGhost', null) as Mesh;
  guideGhost.setEnabled(false);
  guideGhost.isVisible = true;
  guideGhost.isPickable = false;
  guideGhost.material = guideGhostMaterial;
  guideGhost.parent = parent;
  for (let index = 0; index < FUTURE_FOOTPRINTS; index++) {
    const material = new StandardMaterial(`zombieFootprintMaterial${index}`, scene);
    material.disableLighting = true;
    material.alpha = 0;
    const mesh = MeshBuilder.CreateDisc(`zombieFootprint${index}`, {
      radius: 0.15, tessellation: 16, sideOrientation: Mesh.DOUBLESIDE,
    }, scene);
    mesh.rotation.x = Math.PI / 2;
    mesh.scaling.set(0.55, 1.1, 1);
    mesh.isPickable = false;
    mesh.material = material;
    mesh.parent = parent;
    mesh.setEnabled(false);
    footprints.push({ mesh, material });
  }
}

function clearGhostDrums() {
  ghostDrums.forEach(ghost => ghost.dispose());
  ghostDrums = [];
  ghostMaterials.forEach(material => material.dispose());
  ghostMaterials = [];
  beatGhost?.dispose();
  beatGhost = null;
  beatGhostMaterial?.dispose();
  beatGhostMaterial = null;
  guideGhost?.dispose();
  guideGhost = null;
  guideGhostMaterial?.dispose();
  guideGhostMaterial = null;
  footprints.forEach(({ mesh, material }) => { mesh.dispose(); material.dispose(); });
  footprints = [];
}

// The brass cure: a cured marcher — a hunting zombie that ran into a
// trumpet player, or a corpse lying near one — turns back into a normal
// uninfected marcher: uniform, skin, face, and instrument pose restored,
// upright, and released back to its scheduled drill spot among the
// bystanders, where it can be bitten again. Trumpet players stand unharmed.
function cureMarcher(robot: TransformNode) {
  const color = savedColors.get(robot) ?? victims.find(victim => victim.robot === robot)?.color;
  chasers = chasers.filter(chaser => chaser.robot !== robot);
  victims = victims.filter(victim => victim.robot !== robot);
  savedColors.delete(robot);
  corpseContacts.delete(robot);
  if (color) setRobotColor(robot, color);
  setMarcherZombified(robot, false);
  setMarcherInstrumentPose(robot, getInstrumentPose());
  robot.rotation.x = 0;
  setRobotHeld(robot, false);
  bystanders.push(robot);
}

const BONK_HEAD_HEIGHT_YARDS = 1.7;
export const BONK_RADIUS_YARDS = 0.35;
// Dead zombies are obstacles: marching over a corpse trips the drummer —
// owed steps are lost and the sticks are useless for a moment — so the
// clean line swings around the fallen, even when that leaves the drill
// path. A trumpet player standing near a corpse wakes it cured.
export const CORPSE_TRIP_YARDS = 0.9;
export const CORPSE_STUMBLE_MS = 1500;
export const CORPSE_CURE_YARDS = 1.5;
// Dirty tricks: clubbing a healthy bystander stumbles it for a few seconds,
// and hunting zombies within the lure range find the easy prey more
// tempting than the player. The decoy is knocked down when the horde
// reaches it (a trumpet decoy cures the biter instead), and recovers back
// into the formation if nothing arrives in time.
export const DECOY_STUMBLE_MS = 4000;
export const DECOY_LURE_YARDS = 12;

// A drumstick blow to the head fells a zombie for good: it drops where it
// stands through the victim fall animation and never rises (an infinite
// rise time); the game-over restore stands it back up.
function fellZombie(chaser: Runner, now: number) {
  const robot = chaser.robot;
  const original = savedColors.get(robot) ?? victims.find(victim => victim.robot === robot)?.color
    ?? getRobotColor(robot).clone();
  chasers = chasers.filter(other => other !== chaser);
  victims = victims.filter(victim => victim.robot !== robot);
  const from = player ? fieldPosition(player.robot) : fieldPosition(robot);
  const shove = fieldPosition(robot).subtract(from);
  const facing = robot.rotation.y;
  victims.push({
    robot, fallStart: now, riseStart: Number.POSITIVE_INFINITY,
    pitchSign: shove.x * Math.sin(facing) + shove.z * Math.cos(facing) >= 0 ? 1 : -1,
    color: original, risen: false,
  });
}

// Clubbing a healthy bandmate: it staggers in place as live bait.
function bonkDecoy(robot: TransformNode, now: number) {
  bystanders = bystanders.filter(standing => standing !== robot);
  setRobotHeld(robot, true);
  decoys.push({ robot, until: now + DECOY_STUMBLE_MS });
}

// Stick-tip melee: a tip inside a zombie's head zone fells it; inside a
// healthy bystander's head zone, it stumbles them into a decoy.
function checkStickBonks(now: number) {
  if (!player) return;
  const parent = player.robot.parent;
  if (!(parent instanceof TransformNode) || sticks.size === 0) return;
  const inverse = Matrix.Invert(parent.getWorldMatrix());
  for (const [handedness, { grip }] of sticks) {
    if (handedness === drumGrabHand) continue;
    grip.computeWorldMatrix(true);
    const tip = Vector3.TransformCoordinates(Vector3.TransformCoordinates(
      new Vector3(0, 0, STICK_LENGTH), grip.getWorldMatrix()), inverse);
    let struck = false;
    for (const chaser of chasers) {
      if (chaser.robot.isDisposed()) continue;
      const head = fieldPosition(chaser.robot).add(new Vector3(0, BONK_HEAD_HEIGHT_YARDS, 0));
      if (Vector3.DistanceSquared(tip, head) > BONK_RADIUS_YARDS * BONK_RADIUS_YARDS) continue;
      fellZombie(chaser, now);
      struck = true;
      break;
    }
    if (struck) continue;
    for (const standing of bystanders) {
      if (standing.isDisposed()) continue;
      const head = fieldPosition(standing).add(new Vector3(0, BONK_HEAD_HEIGHT_YARDS, 0));
      if (Vector3.DistanceSquared(tip, head) > BONK_RADIUS_YARDS * BONK_RADIUS_YARDS) continue;
      bonkDecoy(standing, now);
      break;
    }
  }
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
      setMarcherZombified(victim.robot, true);
      setMarcherInstrumentPose(victim.robot, 'rest');
      chasers.push({ robot: victim.robot, heading: victim.robot.rotation.y, stridePhase: 0 });
    }
  }
}

// End-of-run score line: felled zombies carry an infinite rise time and
// count as clubbed, not turned.
function runTally(): string {
  const turned = victims.filter(victim => Number.isFinite(victim.riseStart)).length;
  const clubbed = victims.length - turned;
  return `${turned} marchers turned${clubbed ? `, ${clubbed} zombies clubbed` : ''}`;
}

function stopGame(message?: string) {
  if (!active) return;
  active = false;
  setSceneManipulationLocked(false);
  if (savedARScale !== null) {
    setARScale(savedARScale);
    savedARScale = null;
  }
  clearSticks();
  clearTargetMarkers();
  clearGhostDrums();
  corpseContacts.clear();
  scheduleByRobot = new Map();
  playerSchedule = [];
  // Stand everyone up and hand them back to their schedules: releasing a
  // held marcher re-applies its scheduled pose at the paused beat. The band
  // pose, not a hardcoded one, comes back on the de-zombified.
  const bandPose: InstrumentPose = getInstrumentPose();
  const release = (robot: TransformNode, color: Color3 | undefined) => {
    if (robot.isDisposed()) return;
    robot.rotation.x = 0;
    setMarcherZombified(robot, false);
    if (color) {
      setRobotColor(robot, color);
      setMarcherInstrumentPose(robot, bandPose);
    }
    setRobotHeld(robot, false);
  };
  drumGrabHand = null;
  drumGrabRelative = null;
  clearTurnArrow();
  if (playerHorn && !playerHorn.isDisposed() && playerHornHome) {
    playerHorn.position.copyFrom(playerHornHome);
    if (playerHornHomeRotation) {
      playerHorn.rotationQuaternion = null;
      playerHorn.rotation.copyFrom(playerHornHomeRotation);
    }
  }
  playerHornHome = null;
  playerHornHomeRotation = null;
  if (player) release(player.robot, undefined);
  for (const { robot } of chasers) release(robot, savedColors.get(robot));
  for (const victim of victims) release(victim.robot, victim.color);
  for (const decoy of decoys) release(decoy.robot, undefined);
  decoys = [];
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
  updateDrumGrab(controllers);
  updateStickColors();
  checkDrumHits(now);
  checkStickBonks(now);
  const deltaSeconds = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
  // Steer by facing: the march heads wherever the player is looking — the
  // headset (or desktop POV look) is the rudder — converted from the
  // camera's world forward into field-local space so tabletop/room
  // transforms never skew the march. Because the marcher's body turns to
  // the heading even while standing, the carried quads (and the called
  // ring on them) swing with the look, always squarely in front; the
  // controllers only strike.
  const fieldParent = player.robot.parent;
  const camera = scene.activeCamera;
  if (camera instanceof TargetCamera && fieldParent instanceof TransformNode) {
    const look = Vector3.TransformNormal(camera.getDirection(Vector3.Forward()),
      Matrix.Invert(fieldParent.getWorldMatrix()));
    look.y = 0;
    if (look.lengthSquared() > 1e-6) player.heading = Math.atan2(look.x, look.z);
  }
  // Room-scale truth: the marcher's torso stays connected to the real
  // body. In XR the headset's physical movement — walking, side-stepping,
  // leaning — rides on top of the POV follower's teleports, so the camera
  // drifts away from the marcher's eye and the torso and carried drums end
  // up standing apart, crowding the view. Each frame the horizontal gap
  // between the headset and the marcher's eye walks the robot's field spot
  // under the camera, and the POV follower absorbs that eye shift so it
  // never re-teleports the camera by the camera's own motion (drum strides
  // still march the view through the follower as before). XR only: the
  // desktop POV camera sits exactly on the eye, with no body to follow.
  if (camera && camera.getClassName() === 'WebXRCamera' && fieldParent instanceof TransformNode) {
    const eye = getMarcherEyePose(player.robot);
    if (eye) {
      const drift = camera.globalPosition.subtract(eye.position);
      drift.y = 0;
      if (drift.lengthSquared() > 1e-10) {
        const fieldDrift = Vector3.TransformNormal(
          drift, Matrix.Invert(fieldParent.getWorldMatrix()));
        fieldDrift.y = 0;
        const position = fieldPosition(player.robot);
        const target = position.add(fieldDrift);
        clampToField(target);
        const applied = target.subtract(position);
        position.copyFrom(target);
        absorbMarcherPOVEyeShift(
          Vector3.TransformNormal(applied, fieldParent.getWorldMatrix()));
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
  // Dead zombies are obstacles: entering a corpse's patch mid-march trips
  // the drummer — owed steps are lost and the sticks go quiet for a moment
  // — so the line swings around the fallen even when it leaves the path.
  // A corpse lying near a trumpet player is woken cured.
  for (const victim of [...victims]) {
    if (Number.isFinite(victim.riseStart) || victim.robot.isDisposed()) continue;
    const corpse = fieldPosition(victim.robot);
    const inside = Vector3.Distance(corpse, playerPosition) <= CORPSE_TRIP_YARDS;
    if (inside && !corpseContacts.has(victim.robot) && travel > 1e-6 && now >= stumbleUntil) {
      stumbleUntil = now + CORPSE_STUMBLE_MS;
      stepDistanceLeft = 0;
    }
    if (inside) corpseContacts.add(victim.robot);
    else corpseContacts.delete(victim.robot);
    if (bystanders.some(standing => !standing.isDisposed() &&
      getMarcherInstrument(standing) === 'trumpet' &&
      Vector3.Distance(fieldPosition(standing), corpse) <= CORPSE_CURE_YARDS)) {
      cureMarcher(victim.robot);
    }
  }
  // Bonked decoys stagger in place until they recover into the formation.
  decoys = decoys.filter((decoy) => {
    if (decoy.robot.isDisposed()) return false;
    if (now >= decoy.until) {
      decoy.robot.rotation.x = 0;
      setRobotHeld(decoy.robot, false);
      bystanders.push(decoy.robot);
      return false;
    }
    // A drunken wobble that reads as easy prey.
    decoy.robot.rotation.x = 0.2 * Math.sin(now * 0.02);
    return true;
  });
  // The rings pulse on the ghost cadence, swelling toward each count and
  // peaking exactly on the beat — the moment to strike. A pure function of
  // the gameCount phase, so the flash and the trail share one clock.
  const beatSwell = (gameCount % 1) ** 3;
  targetMarkers.forEach((marker) => {
    if (marker.mesh.isDisposed()) return;
    marker.material.alpha = marker.dimmed ? 0.16 : 0.22 + 0.68 * beatSwell;
    marker.mesh.scaling.setAll(marker.baseScale * (marker.dimmed ? 1 : 1 + 0.28 * beatSwell));
  });
  // The beat ghost stands at the next whole count: the spot to be standing
  // on when the flash peaks. Its glow swells with the rings.
  const nextBeat = Math.floor(gameCount) + 1;
  const beatPose = nextBeat <= lastScheduledCount ? sampleSchedule(playerSchedule, nextBeat) : null;
  if (beatGhost && !beatGhost.isDisposed()) {
    beatGhost.setEnabled(!!beatPose);
    if (beatPose) {
      beatGhost.position.copyFrom(beatPose.position);
      beatGhost.rotation.y = beatPose.rotationY;
    }
  }
  if (beatGhostMaterial) beatGhostMaterial.alpha = 0.3 + 0.45 * beatSwell;
  // The future footsteps: one sole print per upcoming count, alternating
  // feet (odd counts left, stepping off on the left), set just off the
  // route's centreline across the direction of travel and turned to face
  // it, fading into the future. The nearest print swells with the beat —
  // it is where the next strike's step lands. Holds leave no prints.
  footprints.forEach((print, index) => {
    if (print.mesh.isDisposed()) return;
    const at = Math.floor(gameCount) + 1 + index;
    const pose = at <= lastScheduledCount ? sampleSchedule(playerSchedule, at) : null;
    const previous = pose ? sampleSchedule(playerSchedule, at - 1) : null;
    const travel = pose && previous ? pose.position.subtract(previous.position) : null;
    if (travel) travel.y = 0;
    const stepping = !!travel && travel.length() > FOOTPRINT_MIN_TRAVEL_YARDS;
    print.mesh.setEnabled(stepping);
    if (!stepping || !pose || !travel) return;
    const heading = Math.atan2(travel.x, travel.z);
    const left = at % 2 === 1;
    const lateral = (left ? 1 : -1) * FOOT_OFFSET_YARDS;
    print.mesh.position.set(
      pose.position.x - Math.cos(heading) * lateral,
      pose.position.y + 0.02,
      pose.position.z + Math.sin(heading) * lateral);
    print.mesh.rotation.y = heading;
    print.material.emissiveColor = Color3.FromHexString(left ? CALL_LEFT_COLOR : CALL_RIGHT_COLOR);
    print.material.alpha = Math.max(0.06, 0.5 * (1 - index / FUTURE_FOOTPRINTS)) +
      (index === 0 ? 0.25 * beatSwell : 0);
  });
  // Strayed past the alignment radius, the trail can be anywhere — even
  // behind the player. The guide ghost closes the gap: it stands a few
  // yards out in the exact direction of the current drill spot, so some
  // turn always finds a ghost drum, and it keeps leading the walk back
  // until the trail takes over. On the path it stands down.
  if (guideGhost && !guideGhost.isDisposed()) {
    const toSpot = ghostPose ? ghostPose.position.subtract(playerPosition) : null;
    if (toSpot) toSpot.y = 0;
    const gap = toSpot ? toSpot.length() : 0;
    const leading = !!toSpot && gap > DRILL_ALIGN_YARDS;
    guideGhost.setEnabled(leading);
    if (leading && toSpot) {
      const direction = toSpot.scale(1 / gap);
      guideGhost.position.copyFrom(playerPosition)
        .addInPlace(direction.scale(Math.min(GUIDE_GHOST_LEAD_YARDS, gap)));
      guideGhost.rotation.y = Math.atan2(direction.x, direction.z);
      if (guideGhostMaterial) guideGhostMaterial.alpha = 0.4 + 0.3 * beatSwell;
    }
  }
  // Facing is steering, so facing away from the drill is marching away
  // from it. When the heading strays past the threshold from the drill
  // direction — toward the spot when strayed, along the route when
  // aligned — the floating arrow ahead of the face spins to the wrapped
  // heading error, pointing the way to turn. Holds show nothing.
  if (turnArrow && !turnArrow.isDisposed()) {
    let target: Vector3 | null = null;
    if (ghostPose) {
      if (Vector3.Distance(playerPosition, ghostPose.position) > DRILL_ALIGN_YARDS) {
        target = ghostPose.position;
      } else {
        const ahead = sampleSchedule(playerSchedule, Math.min(lastScheduledCount, gameCount + 2));
        if (ahead && Vector3.Distance(playerPosition, ahead.position) > 0.75) target = ahead.position;
      }
    }
    let error = 0;
    if (target) {
      error = Math.atan2(target.x - playerPosition.x, target.z - playerPosition.z) - player.heading;
      while (error > Math.PI) error -= 2 * Math.PI;
      while (error < -Math.PI) error += 2 * Math.PI;
    }
    const show = target !== null && Math.abs(error) > TURN_ARROW_MIN_RAD;
    turnArrow.setEnabled(show);
    if (show) {
      turnArrow.rotation.y = error;
      if (turnArrowMaterial) turnArrowMaterial.alpha = 0.55 + 0.35 * beatSwell;
    }
  }
  // Aligned with the ghost, the horde holds formation; strayed, it hunts.
  onDrill = !ghostPose || Vector3.Distance(playerPosition, ghostPose.position) <= DRILL_ALIGN_YARDS;
  if (ghostPose && lastScheduledCount >= 1 && gameCount >= lastScheduledCount && onDrill) {
    stopGame(`You marched the whole show and the horde never got you — ${runTally()}. ` +
      'Toggle zombie mode to run again.');
    return;
  }
  updateReferees(now);
  for (const chaser of chasers) {
    if (chaser.robot.isDisposed()) continue;
    const gap = playerPosition.subtract(fieldPosition(chaser.robot));
    gap.y = 0;
    if (gap.length() <= OUTBREAK_TOUCH_YARDS) {
      const survived = Math.round((now - startTime) / 1000);
      stopGame(`The horde got you after ${survived}s — ${runTally()}. ` +
        'Toggle zombie mode to run again.');
      return;
    }
    if (onDrill) {
      // In formation: the zombie marches its own captured drill path at the
      // ghost's count, with no knockdowns. How tightly it holds the path is
      // the player's timing: sloppy strikes loosen the leash and the
      // zombies wander off their spots.
      const sample = sampleSchedule(scheduleByRobot.get(chaser.robot) ?? [], gameCount);
      if (sample) {
        const roam = (1 - strikePrecision) * ZOMBIE_ROAM_YARDS;
        if (roam > 0.05) {
          const wobble = now / 1500 + chaser.robot.uniqueId;
          sample.position.x += Math.sin(wobble) * roam;
          sample.position.z += Math.cos(wobble * 0.8) * roam;
        }
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
      // A stumbling decoy within lure range is easier prey than the player.
      let target = playerPosition;
      let closest = DECOY_LURE_YARDS;
      for (const decoy of decoys) {
        if (decoy.robot.isDisposed()) continue;
        const distance = Vector3.Distance(fieldPosition(decoy.robot), fieldPosition(chaser.robot));
        if (distance < closest) {
          closest = distance;
          target = fieldPosition(decoy.robot);
        }
      }
      const run = target.subtract(fieldPosition(chaser.robot));
      chaser.heading = Math.atan2(run.x, run.z);
    }
    moveRunner(chaser, ZOMBIE_RUN_YARDS_PER_SECOND, deltaSeconds);
    for (const standing of bystanders) {
      if (standing.isDisposed()) continue;
      if (Vector3.Distance(fieldPosition(standing), fieldPosition(chaser.robot)) > OUTBREAK_TOUCH_YARDS) continue;
      if (getMarcherInstrument(standing) === 'trumpet') {
        cureMarcher(chaser.robot);
        break;
      }
      knockVictim(standing, chaser, now);
    }
    // Reaching a staggering decoy knocks it down like any bystander — but a
    // trumpet decoy cures whatever bites it and keeps staggering.
    for (const decoy of [...decoys]) {
      if (decoy.robot.isDisposed()) continue;
      if (Vector3.Distance(fieldPosition(decoy.robot), fieldPosition(chaser.robot)) > OUTBREAK_TOUCH_YARDS) continue;
      if (getMarcherInstrument(decoy.robot) === 'trumpet') {
        cureMarcher(chaser.robot);
        break;
      }
      decoys = decoys.filter(other => other !== decoy);
      knockVictim(decoy.robot, chaser, now);
      break;
    }
  }
  updateVictims(now);
}

// Attempts to start the survival game; 'declined' falls zombie mode back
// to the scripted cinematic outbreak (no quad player, or an unforced
// request outside immersive VR).
function tryStartGame(force = false): ZombieGameStart {
  if (active) return 'started';
  if (!callbacks) return 'declined';
  // The Settings toggle's request becomes the game only in immersive VR;
  // the Outbreak! button and audience sign force it on any platform — on
  // desktop the POV look steers and the 1-4 keys strike the drums.
  if (!force && scene.activeCamera?.getClassName() !== 'WebXRCamera') return 'declined';
  const snapshots = captureMarcherSchedules().filter(snapshot => !snapshot.robot.isDisposed());
  const quad = snapshots.find(snapshot => snapshot.instrument === 'tenors');
  const clarinets = snapshots.filter(snapshot => snapshot.instrument === 'clarinet');
  if (!quad || !clarinets.length) return 'declined';
  // Outbreak! is locked into 1:1: the drill is marched with your body, so
  // starting scales a shrunk field (tabletop or Giant) up to full size —
  // remembering what it was — and the scene-manipulation lock keeps it
  // there for the whole run. Ending the game restores the saved scale.
  const fullScale = getARScaleRange().max;
  if (getARScale() < fullScale) {
    if (savedARScale === null) savedARScale = getARScale();
    setARScale(fullScale);
  }
  // Always ride the quad player's eyes: if POV is already following someone
  // else (say, the cinematic's doomed sousaphone from an earlier run),
  // restart it onto the quad rather than keeping the old target.
  callbacks.selectMarcher(quad.robot);
  if (callbacks.isPOVActive()) callbacks.stopPOV();
  callbacks.startPOV();
  startedPOV = callbacks.isPOVActive();
  // POV not engaging usually means the XR session is still settling right
  // after entry; keep the request pending instead of degrading to the
  // sideline or the cinematic.
  if (!startedPOV) return 'retry';
  wasPlaying = isAnyPlaying();
  pauseAll();
  savedColors = new Map();
  playerHorn = quad.robot.getChildMeshes(false).find(mesh => mesh.name === 'marcherHorn') as Mesh ?? null;
  if (playerHorn) {
    playerHornHome = playerHorn.position.clone();
    playerHornHomeRotation = playerHorn.rotation.clone();
    playerHorn.position.z += PLAYER_DRUM_FORWARD;
    playerHorn.position.y += PLAYER_DRUM_RAISE;
  }
  player = { robot: quad.robot, heading: quad.robot.rotation.y, stridePhase: 0 };
  createTurnArrow(quad.robot);
  setRobotHeld(quad.robot, true);
  chasers = clarinets.map((snapshot) => {
    savedColors.set(snapshot.robot, getRobotColor(snapshot.robot).clone());
    setRobotColor(snapshot.robot, ZOMBIE_SKIN);
    setMarcherZombified(snapshot.robot, true);
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
  lastHitByHand.left = 0;
  lastHitByHand.right = 0;
  lastHitByHand.any = 0;
  stepDistanceLeft = 0;
  stumbleUntil = 0;
  corpseContacts.clear();
  decoys = [];
  // The first call is an inner drum, so the opening escape note does not
  // wheel the run hard to one side.
  targetHits = 0;
  currentCall = [{ zone: 1, hand: 'right' }];
  satisfiedHands.clear();
  strikePrecision = 0.5;
  createTargetMarkers();
  active = true;
  setSceneManipulationLocked(true);
  const desktop = scene.activeCamera?.getClassName() !== 'WebXRCamera';
  callbacks.status('Zombie outbreak: you are the quad player. ' +
    (desktop
      ? 'March where you look, and the keys 1-4 strike the drums — hit the glowing one to step. '
      : 'March and face where you look — your drums swing with you. Strike the glowing drum ' +
        'to step (gold calls your right hand, cyan your left; two lit drums want both hands ' +
        'together for a double stride), and club a zombie over the head to drop it for good. ' +
        'Strike dead on the pulse: your timing is their leash — sloppy beats let the horde ' +
        'wander off its drill. ') +
    'Follow the fading trail of ghost drums — march your drill and the horde marches theirs, ' +
    'but stray from the path and they come for you.');
  return 'started';
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
