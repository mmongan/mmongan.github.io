// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { footballMovement, type FootballMotion } from './footballMovement';
import { footballCatchPose, footballKickPose, footballReturnThrowYaw, footballSnapPose, footballThrowPose } from './footballBallFlight';
import { footballTacklePose, footballTackleYaw, type FootballTackleEvent } from './footballTackles';
import { scrimmageBenchSeat } from './scrimmageGeometry';
import type { FootballBallEvent, FootballPlayer } from './footballPlayGeometry';
import type { RobotCount } from './robot';

export interface FootballUpperPose {
  height: number;
  pitch: number;
  yaw: number;
  arms: [number, number, number, number, number, number];
  seated: number;
  seatYaw: number;
  fall: number;
  kick: number;
}

export function sampleFootballUpperPose(player: FootballPlayer, playerIndex: number,
  counts: readonly RobotCount[], prefix: readonly number[], motion: FootballMotion, beat: number,
  robotYaw: number, benchSeated: number, returning: boolean, events: readonly FootballBallEvent[],
  tackles: readonly FootballTackleEvent[], position: (id: string, count: number) => Vector3 | null): FootballUpperPose {
  const index = Math.min(Math.floor(beat), counts.length - 1);
  const from = counts[index].position, to = counts[Math.min(index + 1, counts.length - 1)].position;
  const movement = footballMovement(motion, beat, to.x - from.x, to.z - from.z);
  const phase = ((prefix[index] ?? 0) + (beat - index) * movement.stepsPerCount) * Math.PI;
  const bob = movement.stepsPerCount ? Math.abs(Math.sin(phase)) * .04 : 0;
  const holding = player.label === 'H' && beat >= motion.playStart && !returning;
  const seated = holding ? .65 : benchSeated;
  const benchYaw = holding ? 0 : scrimmageBenchSeat(playerIndex).x < 0 ? Math.PI / 2 : -Math.PI / 2;
  let height = .98 + (bob - movement.crouch) * (1 - seated) - .38 * seated;
  let pitch = movement.lean * (1 - seated) + .03 * seated;
  const snapEvent = benchSeated === 0 ? events.find(event => event.fromId === player.id && footballSnapPose(event, beat)) : null;
  const snap = snapEvent ? footballSnapPose(snapEvent, beat) : null;
  if (snap) {
    height -= .2 * snap.crouch;
    pitch = pitch * (1 - snap.crouch) + snap.lean;
  }
  const bodyYaw = movement.gait === 'ready'
    ? counts[index].facingY ?? counts[index].rotationY ?? movement.bodyYaw : movement.bodyYaw;
  let yaw = (seated > 0 ? benchYaw : bodyYaw) - robotYaw;
  const tackle = tackles.find(event => event.defenderId === player.id || event.carrierId === player.id);
  const pose = tackle ? footballTacklePose(tackle, beat) : null;
  if (pose && tackle) {
    const contactYaw = footballTackleYaw(position(tackle.defenderId, tackle.count)!, position(tackle.carrierId, tackle.count)!);
    const currentYaw = yaw + robotYaw;
    yaw += Math.atan2(Math.sin(contactYaw - currentYaw), Math.cos(contactYaw - currentYaw)) * pose.fall;
    pitch = pitch * (1 - pose.fall) + Math.PI / 2 * pose.fall;
    height = height * (1 - pose.fall) + .22 * pose.fall;
  }
  const throwEvent = seated === 0 && !pose && !snap
    ? events.find(event => event.fromId === player.id && footballThrowPose(event, beat)) : null;
  const throwing = throwEvent ? footballThrowPose(throwEvent, beat) : null;
  if (throwEvent?.kind === 'return') {
    const fraction = beat - index;
    yaw = footballReturnThrowYaw(throwEvent, beat, bodyYaw,
      from.x + (to.x - from.x) * fraction, from.z + (to.z - from.z) * fraction) - robotYaw;
  }
  const catchEvent = seated === 0 && !pose && !snap
    ? events.find(event => event.toId === player.id && footballCatchPose(event, beat)) : null;
  const heldPass = seated === 0 ? events.find(event => event.kind === 'pass' && event.toId === player.id &&
    beat >= event.endCount && !events.some(next =>
      next.startCount >= event.endCount && next.startCount <= beat && next !== event)) : null;
  const catching = heldPass ? footballCatchPose(heldPass, Math.min(beat, heldPass.endCount + .5))
    : catchEvent ? footballCatchPose(catchEvent, beat) : null;
  const arms = [0, 0, 0, 0, 0, 0] as FootballUpperPose['arms'];
  for (const side of [0, 1]) {
    const offset = side * 3;
    const normal = seated > 0 ? -.4 : movement.gait === 'block' ? movement.blockArm :
      Math.sin(phase + side * Math.PI) * movement.armSwing;
    arms[offset] = pose ? normal * (1 - pose.fall) + (.5 - pose.wrap * .9) * pose.fall : normal;
    if (snap && !pose) arms[offset] = arms[offset] * (1 - snap.crouch) + snap.arm;
    arms[offset + 2] = snap && !pose ? -.3 : seated === 0 && movement.gait === 'block' && !pose ? movement.blockElbow : -1.1;
    if (throwing) {
      arms[offset] += ((side === 1 ? throwing.arm : throwing.supportArm) - arms[offset]) * throwing.blend;
      arms[offset + 2] += ((side === 1 ? throwing.elbow : throwing.supportElbow) - arms[offset + 2]) * throwing.blend;
    } else if (catching) {
      arms[offset + 1] = (side === 0 ? 1 : -1) * catching.inward * catching.blend;
      arms[offset] += (catching.arm - arms[offset]) * catching.blend;
      arms[offset + 2] += (catching.elbow - arms[offset + 2]) * catching.blend;
    }
  }
  const kickEvent = events.find(event => (event.kind === 'kick' || event.kind === 'punt') &&
    event.fromId === player.id && beat >= event.startCount - 1 && beat <= event.startCount + 2);
  const kick = benchSeated === 0 && kickEvent ? footballKickPose(kickEvent.startCount, beat) : 0;
  if (kick > 0) {
    yaw += Math.atan2(Math.sin(-yaw - robotYaw), Math.cos(-yaw - robotYaw)) * kick;
    pitch = pitch * (1 - kick) - .12 * kick;
    for (const side of [0, 1]) arms[side * 3] = arms[side * 3] * (1 - kick) + (side === 0 ? .7 : -.4) * kick;
  }
  return { height, pitch, yaw, arms, seated, seatYaw: benchYaw - robotYaw, fall: pose?.fall ?? 0, kick };
}
