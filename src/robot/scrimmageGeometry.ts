// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS } from '../field/constants';
import type { FootballPosition } from './footballPlayGeometry';

export const SCRIMMAGE_EXIT_COUNTS = 48;
export const SCRIMMAGE_ENTRY_COUNTS = 48;
export const SCRIMMAGE_STAND_COUNTS = 2;
export const SCRIMMAGE_RETURN_COUNTS = 48;
export const SCRIMMAGE_SIT_COUNTS = 2;
export const SCRIMMAGE_BAND_RETURN_COUNTS = 48;
export const SCRIMMAGE_PLAY_START = SCRIMMAGE_EXIT_COUNTS + SCRIMMAGE_ENTRY_COUNTS;

export function scrimmageWalk(start: FootballPosition, end: FootballPosition, counts: number): FootballPosition[] {
  return Array.from({ length: counts + 1 }, (_, count) => {
    if (count === 0) return { x: start.x, z: start.z };
    if (count === counts) return { x: end.x, z: end.z };
    const t = count / counts;
    return { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t };
  });
}

export function scrimmageBandExitPosition(position: FootballPosition, index: number): FootballPosition {
  const depth = FIELD_LENGTH_YARDS / 2 + 2.5 + index % 4 * .8;
  return { x: position.x, z: (position.z < 0 ? -1 : 1) * Math.max(Math.abs(position.z), depth) };
}

export function scrimmageBandRoute(start: FootballPosition, index: number, playCounts: number): FootballPosition[] {
  const end = scrimmageBandExitPosition(start, index);
  const returnStart = SCRIMMAGE_PLAY_START + playCounts + SCRIMMAGE_RETURN_COUNTS + SCRIMMAGE_SIT_COUNTS;
  return [...scrimmageWalk(start, end, SCRIMMAGE_EXIT_COUNTS),
    ...Array.from({ length: returnStart - SCRIMMAGE_EXIT_COUNTS }, () => ({ ...end })),
    ...scrimmageWalk(end, start, SCRIMMAGE_BAND_RETURN_COUNTS).slice(1)];
}

export function scrimmagePlayerRoute(route: ReadonlyArray<FootballPosition>, index: number): FootballPosition[] {
  const sideline = scrimmageBenchSeat(index);
  const hold = Array.from({ length: SCRIMMAGE_EXIT_COUNTS + SCRIMMAGE_STAND_COUNTS }, () => ({ ...sideline }));
  return [...hold, ...scrimmageWalk(sideline, route[0], SCRIMMAGE_ENTRY_COUNTS - SCRIMMAGE_STAND_COUNTS),
    ...route.slice(1), ...scrimmagePlayerReturn(route[route.length - 1], index).slice(1)];
}

export function scrimmagePlayerReturn(start: FootballPosition, index: number): FootballPosition[] {
  const seat = scrimmageBenchSeat(index);
  return [...scrimmageWalk(start, seat, SCRIMMAGE_RETURN_COUNTS),
    ...Array.from({ length: SCRIMMAGE_SIT_COUNTS + SCRIMMAGE_BAND_RETURN_COUNTS }, () => ({ ...seat }))];
}

export function scrimmageBenchSeat(index: number): FootballPosition {
  return { x: (index < 11 ? -1 : 1) * (FIELD_WIDTH_YARDS / 2 + 2.5), z: (index % 11 - 5) * 1.1 };
}

export function scrimmageSeatedBlend(beat: number, playStart: number, returnStart?: number): number {
  if (playStart <= 0) return 0;
  if (!Number.isFinite(playStart)) return 1;
  if (returnStart !== undefined && beat >= returnStart + SCRIMMAGE_RETURN_COUNTS) {
    const t = Math.max(0, Math.min(1, (beat - returnStart - SCRIMMAGE_RETURN_COUNTS) / SCRIMMAGE_SIT_COUNTS));
    return t * t * (3 - 2 * t);
  }
  const standStart = playStart - SCRIMMAGE_ENTRY_COUNTS;
  const t = Math.max(0, Math.min(1, (beat - standStart) / SCRIMMAGE_STAND_COUNTS));
  return 1 - t * t * (3 - 2 * t);
}
