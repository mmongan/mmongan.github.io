// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FootballBallEvent, FootballPosition } from './footballPlayGeometry';

export function footballScrimmageSpot(events: readonly FootballBallEvent[], beat: number,
  position: (id: string, count: number) => FootballPosition | null) {
  const openings = events.filter(event => event.kind === 'snap' ||
    event.kind === 'kick' && !!event.startPosition);
  const event = [...openings].reverse().find(event => event.startCount <= beat) ?? openings[0];
  if (!event) return null;
  const point = event.startPosition ?? position(event.fromId, event.startCount);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
    throw new Error('The line of scrimmage requires a valid snap position.');
  }
  return { z: point.z, count: event.startCount, kickoff: event.kind === 'kick' };
}
