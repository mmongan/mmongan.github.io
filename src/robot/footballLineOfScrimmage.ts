// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FootballBallEvent, FootballPosition, FootballTeam } from './footballPlayGeometry';
import { footballBodyZRange, type FootballBodyFootprint } from './footballBodyClearance';

export function footballPresnapSpot(events: readonly FootballBallEvent[], beat: number,
  position: (id: string, count: number) => FootballPosition | null) {
  const event = events.find(event => event.kind === 'snap' &&
    beat >= event.startCount - 1 && beat < event.startCount + 1);
  return event ? footballScrimmageSpot([event], beat, position) : null;
}

export function footballPresnapBody(body: FootballBodyFootprint, team: FootballTeam,
  spot: { z: number; count: number }, beat: number): FootballBodyFootprint {
  const t = Math.max(0, Math.min(1, beat - spot.count));
  const blend = 1 - t * t * (3 - 2 * t);
  const range = footballBodyZRange(body);
  return team === 'offense'
    ? { ...body, maxZ: body.z + Math.min(0, spot.z - .08 - range.max) * blend }
    : { ...body, minZ: body.z + Math.max(0, spot.z + .08 - range.min) * blend };
}

export function footballScrimmageSpot(events: readonly FootballBallEvent[], beat: number,
  position: (id: string, count: number) => FootballPosition | null) {
  const openings = events.filter(event => event.kind === 'snap' ||
    event.kind === 'kick' && !!event.startPosition || event.kind === 'return' && !!event.targetPosition);
  const event = [...openings].reverse().find(event =>
    (event.kind === 'return' ? event.endCount : event.startCount) <= beat) ?? openings[0];
  if (!event) return null;
  const point = event.kind === 'return' ? event.targetPosition
    : event.startPosition ?? position(event.fromId, event.startCount);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
    throw new Error('The line of scrimmage requires a valid snap position.');
  }
  return { z: point.z, count: event.kind === 'return' ? event.endCount : event.startCount,
    kickoff: event.kind === 'kick' };
}
