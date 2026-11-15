// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Zombie clarinets: a deterministic halftime horror easter egg. Enabling the
// Settings toggle snapshots the band, then precomputes one whole outbreak on
// the ordinary count grid: from count 8 every clarinet lurches out of line
// toward the nearest sousaphone player; a tuba keeps marching its authored
// route until a zombie shambles within scare range, then drops out of line
// and runs (slower — the sousaphone is heavy), clamped to the field, until
// caught and eaten; any other marcher a zombie runs into has their route
// frozen there and tips over, lies still for an incubation of 8–24 counts
// (pseudo-random but hashed from the marcher's index, so the "randomness" is
// reproducible), then rises green with their instrument lowered and joins the
// hunt, cascading the infection through the band. Everything plays back
// through the ordinary schedule/transport systems (no second simulation or
// clock): eaten tubas exist only before their catch beat, fallen marchers
// stand back up when the transport scrubs before their knockdown, and risen
// zombies revert to uniformed marchers when it scrubs before their rise — the
// outbreak stays a pure function of the beat and replays identically.
// Turning the toggle off restores the saved schedules, uniform colors,
// instrument poses, and upright roots exactly. Session-only: nothing is
// persisted, drafted, or exported.

import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import {
  captureBakedMarcherSchedules, getDrillTransportState, restoreMarcherSchedule,
  setMarcherInstrumentPose, setRobotColor,
} from './robot';
import type { InstrumentPose, MarcherScheduleSnapshot, RobotCount } from './robot';
import { FIELD_LENGTH_YARDS, FIELD_WIDTH_YARDS } from '../field/constants';
import { zombieModeToggle } from '../ui/dom';

// The outbreak begins at drill count 8.
export const ZOMBIE_START_COUNT = 8;
// Zombies out-shamble a fleeing sousaphone, so every chase ends.
export const ZOMBIE_STEP_YARDS = 1.0;
export const TUBA_FLEE_STEP_YARDS = 0.65;
// A tuba player abandons the drill when a zombie closes within this range.
export const ZOMBIE_SCARE_YARDS = 10;
// Arm's reach: close enough to bite without standing inside the prey.
export const ZOMBIE_CATCH_YARDS = 0.9;
// Brushing a shambling zombie knocks an ordinary marcher flat.
export const ZOMBIE_KNOCKDOWN_YARDS = 0.8;
// The fallen lie still this long before rising, hashed per marcher.
export const ZOMBIE_INCUBATION_MIN_COUNTS = 8;
export const ZOMBIE_INCUBATION_SPREAD_COUNTS = 17;
// Counts spent feasting before hunting the next tuba.
const ZOMBIE_FEAST_COUNTS = 8;
const ZOMBIE_CHASE_COUNT_CAP = 2000;
const ZOMBIE_FALL_PITCH = Math.PI * 0.46;
const ZOMBIE_SKIN = new Color3(0.47, 0.66, 0.33);

interface InfectedMarcher {
  robot: TransformNode;
  knockCount: number;
  riseCount: number;
  pitchSign: number;
  originalColor: Color3;
  originalPose: InstrumentPose;
  // The visual state currently applied, so color/pose flips happen only on
  // transitions rather than every frame.
  turned: boolean;
}

interface ZombieState {
  scene: Scene;
  saved: MarcherScheduleSnapshot[];
  eaten: { robot: TransformNode; count: number }[];
  infected: InfectedMarcher[];
  povStarted: boolean;
}

let state: ZombieState | null = null;
// Set by initZombieMode: the outbreak reuses the existing marcher POV system
// (selection plus setMarcherPOVEnabled) — never a second camera follower.
let povHooks: { start: (robot: TransformNode) => void; stop: () => void } | null = null;

export function isZombieModeActive(): boolean {
  return state !== null;
}

// Schedules clamp to their final count, so halted marchers keep a position.
function scheduledPosition(snapshot: MarcherScheduleSnapshot, count: number): Vector3 {
  const counts = snapshot.counts;
  return counts[Math.min(counts.length - 1, Math.max(0, count))].position;
}

// A copy of the authored schedule where index always equals count number,
// padding past the authored end with holds, so simulated counts append at
// the right beats even behind a schedule shorter than the outbreak.
function paddedCounts(snapshot: MarcherScheduleSnapshot, through: number): RobotCount[] {
  return Array.from({ length: through + 1 }, (_, count) => {
    const authored = snapshot.counts[count];
    if (authored) return { ...authored, position: authored.position.clone() };
    const last = snapshot.counts[snapshot.counts.length - 1];
    return { position: last.position.clone(), rotationY: last.facingY ?? last.rotationY };
  });
}

function clampToField(position: Vector3) {
  position.x = Math.max(-FIELD_WIDTH_YARDS / 2, Math.min(FIELD_WIDTH_YARDS / 2, position.x));
  position.z = Math.max(-FIELD_LENGTH_YARDS / 2, Math.min(FIELD_LENGTH_YARDS / 2, position.z));
}

// Reproducible per-marcher incubation: random-feeling, identical on replay.
function incubationCounts(index: number): number {
  return ZOMBIE_INCUBATION_MIN_COUNTS +
    (((index + 1) * 2654435761 + 97) >>> 0) % ZOMBIE_INCUBATION_SPREAD_COUNTS;
}

interface Hunter {
  snapshot: MarcherScheduleSnapshot;
  counts: RobotCount[];
  position: Vector3;
  activeFrom: number;
  feastUntil: number;
  done: boolean;
}

// Returns an error message, or null when the outbreak started.
export function enableZombieMode(scene: Scene): string | null {
  if (state) return null;
  const snapshots = captureBakedMarcherSchedules()
    .filter(snapshot => !snapshot.robot.isDisposed());
  const clarinets = snapshots.filter(snapshot => snapshot.instrument === 'clarinet');
  const tubaSnapshots = snapshots.filter(snapshot => snapshot.instrument === 'sousaphone');
  if (!clarinets.length || !tubaSnapshots.length) {
    return 'Zombie clarinets need at least one clarinet and one sousaphone player on the field.';
  }
  const start = ZOMBIE_START_COUNT;
  // Precompute the whole outbreak count by count before touching any
  // schedule, so the change is atomic and the result deterministic.
  const hunters: Hunter[] = clarinets.map(snapshot => ({
    snapshot, counts: paddedCounts(snapshot, start),
    position: scheduledPosition(snapshot, start).clone(),
    activeFrom: start, feastUntil: -1, done: false,
  }));
  const tubas = tubaSnapshots.map(snapshot => ({
    snapshot, counts: null as RobotCount[] | null,
    position: scheduledPosition(snapshot, start).clone(),
    fleeing: false, eatenAt: -1,
  }));
  const bystanders = snapshots
    .filter(snapshot => snapshot.instrument !== 'clarinet' && snapshot.instrument !== 'sousaphone')
    .map((snapshot, index) => ({
      snapshot, index, knockedAt: -1, riseAt: -1, pitchSign: 1,
    }));
  for (let count = start; count < start + ZOMBIE_CHASE_COUNT_CAP; count++) {
    // Zombies lurch toward the nearest surviving tuba, pausing to feast.
    // The infected lie where they fell until their rise count.
    const active = hunters.filter(hunter => count >= hunter.activeFrom);
    for (const hunter of hunters) {
      if (hunter.done) continue;
      // Self-align so each simulated count lands at its own beat, however
      // and whenever this hunter joined the outbreak.
      while (hunter.counts.length < count + 1) {
        const held = hunter.counts[hunter.counts.length - 1];
        hunter.counts.push({ position: held.position.clone(), rotationY: held.rotationY });
      }
      const hold = () => {
        const held = hunter.counts[hunter.counts.length - 1];
        hunter.counts.push({ position: held.position.clone(), rotationY: held.rotationY });
      };
      if (count < hunter.activeFrom || count < hunter.feastUntil) {
        hold();
        continue;
      }
      const living = tubas.filter(tuba => tuba.eatenAt < 0);
      if (!living.length) {
        hunter.done = true; // The schedule ends: the sated zombie halts.
        continue;
      }
      const prey = living.reduce((nearest, tuba) =>
        Vector3.Distance(hunter.position, tuba.position) <
          Vector3.Distance(hunter.position, nearest.position) ? tuba : nearest);
      const gap = prey.position.subtract(hunter.position);
      gap.y = 0;
      const distance = gap.length();
      const heading = distance > 1e-9
        ? Math.atan2(gap.x, gap.z)
        : hunter.counts[hunter.counts.length - 1].rotationY;
      if (distance <= ZOMBIE_CATCH_YARDS) {
        prey.eatenAt = count + 1;
        hunter.feastUntil = count + 1 + ZOMBIE_FEAST_COUNTS;
        hunter.counts.push({ position: hunter.position.clone(), rotationY: heading });
        continue;
      }
      const step = Math.min(ZOMBIE_STEP_YARDS, distance - ZOMBIE_CATCH_YARDS / 2);
      hunter.position.addInPlace(gap.scale(step / distance));
      hunter.counts.push({ position: hunter.position.clone(), rotationY: heading });
    }
    // Tubas march their authored route until scared, then run for their lives.
    for (const tuba of tubas) {
      if (tuba.eatenAt >= 0) continue;
      const hunterNear = active.length ? active.reduce((nearest, hunter) =>
        Vector3.Distance(tuba.position, hunter.position) <
          Vector3.Distance(tuba.position, nearest.position) ? hunter : nearest) : null;
      const threat = hunterNear ? Vector3.Distance(tuba.position, hunterNear.position) : Infinity;
      if (!tuba.fleeing && threat <= ZOMBIE_SCARE_YARDS) {
        tuba.fleeing = true;
        tuba.counts = paddedCounts(tuba.snapshot, count);
      }
      if (!tuba.fleeing) {
        tuba.position = scheduledPosition(tuba.snapshot, count + 1).clone();
        continue;
      }
      const away = tuba.position.subtract(hunterNear!.position);
      away.y = 0;
      const length = away.length();
      if (length > 1e-9) away.scaleInPlace(TUBA_FLEE_STEP_YARDS / length);
      else away.set(0, 0, TUBA_FLEE_STEP_YARDS);
      const next = tuba.position.add(away);
      clampToField(next);
      const travel = next.subtract(tuba.position);
      const heading = travel.lengthSquared() > 1e-12
        ? Math.atan2(travel.x, travel.z)
        : tuba.counts![tuba.counts!.length - 1].rotationY;
      tuba.position = next;
      tuba.counts!.push({ position: next.clone(), rotationY: heading });
    }
    // Anyone still marching the drill that a zombie runs into falls over,
    // frozen at that count — and after an incubation, rises to join the hunt.
    for (const bystander of bystanders) {
      if (bystander.knockedAt >= 0) continue;
      const position = scheduledPosition(bystander.snapshot, count);
      const culprit = active.find(hunter =>
        Vector3.Distance(hunter.position, position) <= ZOMBIE_KNOCKDOWN_YARDS);
      if (!culprit) continue;
      bystander.knockedAt = count;
      bystander.riseAt = count + incubationCounts(bystander.index);
      const counts = paddedCounts(bystander.snapshot, count);
      // Tip away from the shove: forward when hit from behind, else backward.
      const shove = position.subtract(culprit.position);
      const facing = counts[count].rotationY;
      bystander.pitchSign = shove.x * Math.sin(facing) + shove.z * Math.cos(facing) >= 0 ? 1 : -1;
      hunters.push({
        snapshot: bystander.snapshot, counts, position: position.clone(),
        activeFrom: bystander.riseAt, feastUntil: -1, done: false,
      });
    }
    const waiting = hunters.some(hunter =>
      !hunter.done && (count < hunter.activeFrom || count < hunter.feastUntil));
    if (tubas.every(tuba => tuba.eatenAt >= 0) && !waiting) break;
  }
  const rewrittenTubas = tubas.filter(tuba => tuba.counts);
  const infected = bystanders.filter(bystander => bystander.knockedAt >= 0);
  state = {
    scene,
    saved: [
      ...clarinets,
      ...rewrittenTubas.map(tuba => tuba.snapshot),
      ...infected.map(bystander => bystander.snapshot),
    ],
    eaten: tubas.filter(tuba => tuba.eatenAt >= 0)
      .map(tuba => ({ robot: tuba.snapshot.robot, count: tuba.eatenAt })),
    infected: infected.map(bystander => ({
      robot: bystander.snapshot.robot,
      knockCount: bystander.knockedAt, riseCount: bystander.riseAt,
      pitchSign: bystander.pitchSign,
      originalColor: bystander.snapshot.color.clone(),
      originalPose: bystander.snapshot.instrumentPose,
      turned: false,
    })),
    povStarted: false,
  };
  hunters.forEach((hunter) => {
    // The infected keep their uniform at first; the per-frame stage turns
    // them green at their rise beat (and back, when scrubbed earlier).
    const risen = hunter.activeFrom === start;
    restoreMarcherSchedule(hunter.snapshot.robot, {
      instrument: hunter.snapshot.instrument,
      instrumentPose: risen ? 'rest' : hunter.snapshot.instrumentPose,
      color: risen ? ZOMBIE_SKIN : hunter.snapshot.color,
      stepSizeYards: hunter.snapshot.stepSizeYards, counts: hunter.counts,
    }, scene);
  });
  rewrittenTubas.forEach(({ snapshot, counts }) => {
    // Fleeing drops any fixed facing: a running tuba faces where it runs.
    restoreMarcherSchedule(snapshot.robot, {
      instrument: snapshot.instrument, instrumentPose: snapshot.instrumentPose,
      color: snapshot.color, stepSizeYards: snapshot.stepSizeYards, counts: counts!,
    }, scene);
  });
  // Live the outbreak as prey: the view drops into the first tuba the horde
  // will catch, through the existing marcher POV system.
  const doomed = state.eaten.reduce((first, tuba) =>
    tuba.count < first.count ? tuba : first, { robot: tubaSnapshots[0].robot, count: Infinity });
  if (povHooks) {
    povHooks.start(doomed.robot);
    state.povStarted = true;
  }
  return null;
}

export function disableZombieMode() {
  if (!state) return;
  const { scene, saved, eaten, infected, povStarted } = state;
  state = null;
  if (povStarted) povHooks?.stop();
  eaten.forEach(({ robot }) => {
    if (!robot.isDisposed()) robot.setEnabled(true);
  });
  infected.forEach(({ robot }) => {
    if (!robot.isDisposed()) robot.rotation.x = 0;
  });
  saved.forEach((snapshot) => {
    if (!snapshot.robot.isDisposed()) restoreMarcherSchedule(snapshot.robot, snapshot, scene);
  });
}

// Per-frame stage. Eaten tubas exist only before their catch beat; the
// infected fall at their knockdown beat, lie through their incubation, and
// rise green at their rise beat — all gated on the transport beat, so seeks
// and reverse playback stay exact. Replacing the show disposes every saved
// robot, which simply ends the outbreak.
export function updateZombieMode() {
  if (!state) return;
  if (state.saved.every(snapshot => snapshot.robot.isDisposed())) {
    state = null;
    if (zombieModeToggle) zombieModeToggle.checked = false;
    return;
  }
  const beat = getDrillTransportState().beat;
  state.eaten.forEach(({ robot, count }) => {
    if (robot.isDisposed()) return;
    const alive = beat < count;
    if (robot.isEnabled() !== alive) robot.setEnabled(alive);
  });
  state.infected.forEach((victim) => {
    const { robot, knockCount, riseCount, pitchSign } = victim;
    if (robot.isDisposed()) return;
    // One count to topple, pivoting at the feet; one count to rise again.
    const fall = Math.min(1, Math.max(0, beat - knockCount));
    const rise = Math.min(1, Math.max(0, beat - riseCount));
    robot.rotation.x = pitchSign * ZOMBIE_FALL_PITCH * fall * fall * (1 - rise * rise);
    const turned = beat >= riseCount;
    if (turned !== victim.turned) {
      victim.turned = turned;
      setRobotColor(robot, turned ? ZOMBIE_SKIN : victim.originalColor);
      setMarcherInstrumentPose(robot, turned ? 'rest' : victim.originalPose);
    }
  });
}

export function initZombieMode(options: {
  scene: Scene;
  allowed: () => boolean;
  notify: (message: string) => void;
  startPOV: (robot: TransformNode) => void;
  stopPOV: () => void;
}) {
  povHooks = { start: options.startPOV, stop: options.stopPOV };
  const toggle = zombieModeToggle;
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    if (!toggle.checked) {
      disableZombieMode();
      return;
    }
    if (!options.allowed()) {
      toggle.checked = false;
      options.notify('Finish football mode and release held marchers before unleashing the zombies.');
      return;
    }
    const error = enableZombieMode(options.scene);
    if (error) {
      toggle.checked = false;
      options.notify(error);
    }
  });
  options.scene.onDisposeObservable.addOnce(() => {
    state = null;
    toggle.checked = false;
  });
}
