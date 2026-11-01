// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS, END_ZONE_DEPTH_YARDS } from '../field/constants';
import type { FootballPosition } from './footballPlayGeometry';

export const SCRIMMAGE_EXIT_COUNTS = 48;
export const SCRIMMAGE_ENTRY_COUNTS = 48;
export const SCRIMMAGE_STAND_COUNTS = 2;
export const SCRIMMAGE_PLAY_START = SCRIMMAGE_EXIT_COUNTS + SCRIMMAGE_ENTRY_COUNTS;

export function scrimmageWalk(start: FootballPosition, end: FootballPosition, counts: number): FootballPosition[] {
  return Array.from({ length: counts + 1 }, (_, count) => {
    if (count === 0) return { ...start };
    if (count === counts) return { ...end };
    const t = count / counts;
    return { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t };
  });
}

export function scrimmageBandEndZone(position: FootballPosition, index: number): FootballPosition {
  const depth = FIELD_LENGTH_YARDS / 2 - END_ZONE_DEPTH_YARDS / 2 + index % 4 * .8;
  return { x: position.x, z: (position.z < 0 ? -1 : 1) * Math.max(Math.abs(position.z), depth) };
}

export function scrimmagePlayerRoute(route: ReadonlyArray<FootballPosition>, index: number): FootballPosition[] {
  const sideline = scrimmageBenchSeat(index);
  const hold = Array.from({ length: SCRIMMAGE_EXIT_COUNTS + SCRIMMAGE_STAND_COUNTS }, () => ({ ...sideline }));
  return [...hold, ...scrimmageWalk(sideline, route[0], SCRIMMAGE_ENTRY_COUNTS - SCRIMMAGE_STAND_COUNTS),
    ...route.slice(1)];
}

export function scrimmageBenchSeat(index: number): FootballPosition {
  return { x: (index < 11 ? -1 : 1) * (FIELD_WIDTH_YARDS / 2 + 2.5), z: (index % 11 - 5) * 1.1 };
}

export function scrimmageSeatedBlend(beat: number, playStart: number): number {
  if (playStart <= 0) return 0;
  if (!Number.isFinite(playStart)) return 1;
  const standStart = playStart - SCRIMMAGE_ENTRY_COUNTS;
  const t = Math.max(0, Math.min(1, (beat - standStart) / SCRIMMAGE_STAND_COUNTS));
  return 1 - t * t * (3 - 2 * t);
}
