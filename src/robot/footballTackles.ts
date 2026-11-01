// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FootballBallEvent, FootballPlayer, FootballPosition } from './footballPlayGeometry';

export interface FootballTackleEvent {
  defenderId: string;
  carrierId: string;
  count: number;
}
export const FOOTBALL_TACKLE_DURATION = 8;

export function footballTackleYaw(defender: FootballPosition, carrier: FootballPosition) {
  return Math.atan2(carrier.x - defender.x, carrier.z - defender.z) + Math.PI / 2;
}

export function footballTacklePose(event: FootballTackleEvent, beat: number) {
  const elapsed = beat - event.count;
  if (elapsed < 0 || elapsed >= FOOTBALL_TACKLE_DURATION) return null;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const fall = elapsed < 2 ? smooth(elapsed / 2) : elapsed < 4 ? 1 : 1 - smooth((elapsed - 4) / 4);
  return { fall, wrap: elapsed < 2 ? Math.sin(elapsed / 2 * Math.PI) : 0 };
}

export function validateFootballTackle(event: FootballTackleEvent,
  players: ReadonlyArray<Pick<FootballPlayer, 'id' | 'team'>>,
  position: (id: string, count: number) => FootballPosition | null,
  lastCount: number, events: ReadonlyArray<FootballTackleEvent>, ballEvents: ReadonlyArray<FootballBallEvent>) {
  if (!Number.isInteger(event.count) || event.count < 0 || event.count + FOOTBALL_TACKLE_DURATION > lastCount) {
    throw new Error('Choose a whole count with eight counts remaining for falling and recovery.');
  }
  if (players.find(player => player.id === event.defenderId)?.team !== 'defense' ||
    players.find(player => player.id === event.carrierId)?.team !== 'offense') {
    throw new Error('Choose a defensive tackler and an offensive ball carrier.');
  }
  let carrier = ballEvents[0]?.fromId;
  for (const ball of ballEvents) {
    if (event.count >= ball.endCount) carrier = ball.toId;
    else if (event.count >= ball.startCount) throw new Error('Schedule the tackle after the pass or handoff finishes.');
  }
  if (carrier !== event.carrierId) throw new Error('The selected offensive player does not have the ball at this count.');
  const a = position(event.defenderId, event.count), b = position(event.carrierId, event.count);
  const finite = (point: FootballPosition | null) => point && Number.isFinite(point.x) && Number.isFinite(point.z);
  if (!finite(a) || !finite(b)) throw new Error('Both players need valid field coordinates at contact.');
  if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > 1) {
    throw new Error('Edit routes to bring the defender within one yard of the carrier before the tackle.');
  }
  for (const id of [event.defenderId, event.carrierId]) {
    const start = position(id, event.count)!;
    for (let count = event.count + 1; count <= event.count + FOOTBALL_TACKLE_DURATION; count++) {
      const point = position(id, count);
      if (!finite(point) || !point || Math.hypot(point.x - start.x, point.z - start.z) > .001) {
        throw new Error('Both players must hold their route positions for eight counts during the tackle and recovery.');
      }
    }
  }
  if (events.some(other => Math.abs(other.count - event.count) < FOOTBALL_TACKLE_DURATION &&
    [other.defenderId, other.carrierId].some(id => id === event.defenderId || id === event.carrierId))) {
    throw new Error('Tackle events involving the same player cannot overlap.');
  }
}
