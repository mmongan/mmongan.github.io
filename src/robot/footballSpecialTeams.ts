// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateFootballPlay, type FootballPlayGeometry, type FootballPosition } from './footballPlayGeometry';

export function generateFootballSpecialTeams(play: 'kickoff' | 'punt' | 'field-goal'): FootballPlayGeometry {
  const data = generateFootballPlay('spread', 'four-verticals');
  const positions = (from: FootballPosition, to: FootballPosition, start: number, end: number) =>
    Array.from({ length: 25 }, (_, count) => {
      const t = Math.max(0, Math.min(1, (count - start) / (end - start)));
      return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
    });
  if (play === 'kickoff') {
    data.players.forEach((player, index) => {
      const offense = player.team === 'offense';
      const slot = index % 11;
      const start = { x: (slot - 5) * 4.4, z: offense ? -16 : 0 };
      const end = { x: start.x * .7, z: offense ? 25 : -4 };
      if (player.id === 'offense-QB') {
        player.label = 'K';
        player.positions = [
          ...positions({ x: 0, z: -19 }, { x: 0, z: -15.55 }, 0, 4).slice(0, 5),
          ...positions({ x: 0, z: -15.55 }, { x: 0, z: 16 }, 4, 24).slice(5),
        ];
      } else if (player.id === 'defense-FS') {
        player.label = 'KR';
        player.positions = [...positions({ x: 0, z: 43 }, { x: 0, z: 43 }, 0, 12).slice(0, 13),
          ...positions({ x: 0, z: 43 }, { x: 4, z: 18 }, 12, 24).slice(13)];
      } else player.positions = positions(start, end, 4, 24);
    });
    data.ballEvents = [{
      kind: 'kick', fromId: 'offense-QB', toId: 'defense-FS', startCount: 4, endCount: 12,
      startPosition: { x: 0, z: -15, height: .14 }, endHeight: 1.05, flightHeight: 15,
    }];
  } else if (play === 'punt') {
    data.players.forEach(player => {
      const start = { ...player.positions[0] };
      if (player.id === 'offense-QB') {
        player.label = 'P'; start.x = 0; start.z = -24;
        player.positions = positions(start, { x: 0, z: -22 }, 2, 6);
      } else if (player.id === 'offense-C') {
        player.label = 'LS';
        player.positions = positions(start, { x: start.x, z: 10 }, 6, 24);
      } else if (player.id === 'defense-FS') {
        player.label = 'PR'; start.x = 0; start.z = 32;
        player.positions = positions(start, { x: 6, z: 10 }, 14, 24);
      } else player.positions = positions(start, { x: start.x * .8,
        z: player.team === 'offense' ? 16 : start.z - 5 }, 6, 24);
    });
    data.ballEvents = [
      { kind: 'snap', fromId: 'offense-C', toId: 'offense-QB', startCount: 0, endCount: 2 },
      { kind: 'punt', fromId: 'offense-QB', toId: 'defense-FS', startCount: 6, endCount: 14,
        startHeight: .3, flightHeight: 18 },
    ];
  } else {
    data.players.forEach(player => {
      const start = { x: player.positions[0].x, z: player.positions[0].z + 35 };
      if (player.id === 'offense-QB') {
        player.label = 'H'; start.x = 0; start.z = 18;
      } else if (player.id === 'offense-WR3') {
        player.label = 'K'; start.x = -3; start.z = 14;
      } else if (player.id === 'offense-C') player.label = 'LS';
      const end = player.label === 'K' ? { x: -.12, z: 17.55 } : start;
      player.positions = positions(start, end, 2, 6);
    });
    data.ballEvents = [
      { kind: 'snap', fromId: 'offense-C', toId: 'offense-QB', startCount: 0, endCount: 2, endHeight: .14 },
      { kind: 'kick', fromId: 'offense-WR3', toId: 'offense-QB', startCount: 6, endCount: 14,
        launchId: 'offense-QB', startHeight: .14, targetPosition: { x: 0, z: 60, height: 5 },
        flightHeight: 12 },
    ];
    data.outcomes = [{ kind: 'fieldGoal', count: 14 }];
  }
  return data;
}
