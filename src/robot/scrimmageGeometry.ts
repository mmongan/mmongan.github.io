import { FIELD_WIDTH_YARDS } from '../field/constants';
import type { FootballPosition } from './footballPlayGeometry';

export const SCRIMMAGE_EXIT_COUNTS = 48;
export const SCRIMMAGE_ENTRY_COUNTS = 48;
export const SCRIMMAGE_PLAY_START = SCRIMMAGE_EXIT_COUNTS + SCRIMMAGE_ENTRY_COUNTS;

export function scrimmageWalk(start: FootballPosition, end: FootballPosition, counts: number): FootballPosition[] {
  return Array.from({ length: counts + 1 }, (_, count) => {
    if (count === 0) return { ...start };
    if (count === counts) return { ...end };
    const t = count / counts;
    return { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t };
  });
}

export function scrimmageSideline(position: FootballPosition, index: number): FootballPosition {
  return { x: (position.x < 0 ? -1 : 1) * (FIELD_WIDTH_YARDS / 2 + 4 + index % 4),
    z: position.z };
}

export function scrimmagePlayerRoute(route: ReadonlyArray<FootballPosition>, index: number): FootballPosition[] {
  const sideline = scrimmageSideline(route[0], index);
  const hold = Array.from({ length: SCRIMMAGE_EXIT_COUNTS }, () => ({ ...sideline }));
  return [...hold, ...scrimmageWalk(sideline, route[0], SCRIMMAGE_ENTRY_COUNTS), ...route.slice(1)];
}
