// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import type { FootballBallEvent } from './footballPlayGeometry';
import { FIELD_SURFACE_Y } from '../field/constants';
import { sampleFootballThrowClip, sampleFootballCatchClip } from './footballAnimationLibrary';

export function footballFlightEndpoints(event: FootballBallEvent,
  anchor: (id: string, count: number) => Vector3 | null) {
  const from = event.startPosition
    ? new Vector3(event.startPosition.x, FIELD_SURFACE_Y + event.startPosition.height, event.startPosition.z)
    : anchor(event.launchId ?? event.fromId, event.startCount);
  const to = event.targetPosition
    ? new Vector3(event.targetPosition.x, FIELD_SURFACE_Y + event.targetPosition.height, event.targetPosition.z)
    : anchor(event.toId, event.endCount);
  if (!from || !to) return null;
  if (!event.startPosition && event.startHeight !== undefined) from.y = FIELD_SURFACE_Y + event.startHeight;
  if (!event.targetPosition && event.endHeight !== undefined) to.y = FIELD_SURFACE_Y + event.endHeight;
  return { from, to };
}

export function footballFlightPoint(event: FootballBallEvent, from: Vector3, to: Vector3, fraction: number) {
  const t = Math.max(0, Math.min(1, fraction));
  if (t === 0) return from.clone();
  if (t === 1) return to.clone();
  const point = Vector3.Lerp(from, to, t);
  point.y += 4 * t * (1 - t) * (event.flightHeight ?? (event.kind === 'pass' ? 4 : 0));
  return point;
}

export function footballKickPose(kickCount: number, beat: number) {
  const t = beat - kickCount;
  if (t < -1 || t > 2) return 0;
  return t < 0 ? (t + 1) * .5 : t < .5 ? .5 + t : Math.max(0, (2 - t) / 1.5);
}

export function footballSnapPose(event: FootballBallEvent, beat: number) {
  if (event.kind !== 'snap' || beat < event.startCount - 1 || beat >= event.endCount + 1) return null;
  const progress = Math.max(0, Math.min(1, (beat - event.startCount) / (event.endCount - event.startCount)));
  const recovery = Math.max(0, Math.min(1, beat - event.endCount));
  const crouch = 1 - recovery * recovery * (3 - 2 * recovery);
  return { crouch, lean: .35 * crouch, arm: (.5 + .65 * Math.sin(progress * Math.PI / 2)) * crouch };
}

export function footballThrowPose(event: FootballBallEvent, beat: number) {
  if (event.kind !== 'pass' && event.kind !== 'return') return null;
  return sampleFootballThrowClip(beat - event.startCount);
}

export function footballReturnThrowYaw(event: FootballBallEvent, beat: number, yaw: number, x: number, z: number) {
  const pose = footballThrowPose(event, beat);
  if (event.kind !== 'return' || !event.targetPosition || !pose) return yaw;
  const target = Math.atan2(event.targetPosition.x - x, event.targetPosition.z - z);
  return yaw + Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw)) * pose.blend;
}

export function footballCatchPose(event: FootballBallEvent, beat: number) {
  if (event.kind !== 'pass') return null;
  return sampleFootballCatchClip(beat - event.endCount);
}
