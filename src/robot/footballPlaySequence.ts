// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateFootballPlay, type FootballPlayGeometry, type FootballPosition } from './footballPlayGeometry';

export const FOOTBALL_SEQUENCE_CONCEPTS = [
  { id: 'slant-flat', label: 'Slant / Flat', target: 'WR3', throwCount: 5 },
  { id: 'stick', label: 'Stick', target: 'TE', throwCount: 6 },
  { id: 'smash', label: 'Smash', target: 'TE', throwCount: 10 },
  { id: 'flood', label: 'Flood', target: 'TE', throwCount: 10 },
  { id: 'mesh', label: 'Mesh', target: 'WR2', throwCount: 10 },
  { id: 'four-verticals', label: 'Four Verticals', target: 'WR3', throwCount: 12 },
] as const;
export const FOOTBALL_SEQUENCE_RESET_COUNTS = 32;

function sampledRoute(start: FootballPosition, points: readonly [number, number, number][]) {
  const frames = [[0, start.x, start.z], ...points];
  return Array.from({ length: 17 }, (_, count) => {
    const next = frames.findIndex(frame => frame[0] >= count);
    if (next <= 0) return { x: frames[0][1], z: frames[0][2] };
    const a = frames[next - 1], b = frames[next], t = (count - a[0]) / (b[0] - a[0]);
    return { x: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t };
  });
}

export function generateFootballPlaySequence(advanceDownfield = false): FootballPlayGeometry {
  const base = generateFootballPlay('spread', 'four-verticals');
  const players = base.players.map(player => ({ ...player, positions: [player.positions[0]] }));
  const ballEvents: FootballPlayGeometry['ballEvents'] = [];
  const tackles: NonNullable<FootballPlayGeometry['tackles']> = [];
  const sequence: NonNullable<FootballPlayGeometry['sequence']> = [];
  let lineOfScrimmage = -30;
  FOOTBALL_SEQUENCE_CONCEPTS.forEach((concept, index) => {
    const startCount = index * (16 + FOOTBALL_SEQUENCE_RESET_COUNTS);
    sequence.push({ label: advanceDownfield ? `${concept.label} / ${lineOfScrimmage < 0 ? 'Own' : 'Opponent'} ${50 - Math.abs(lineOfScrimmage)}` : concept.label,
      startCount, endCount: startCount + 16,
      source: `https://www.footballplaybookdesigner.com/library/article/${concept.id}` });
    const routes = base.players.map(player => {
      const start = player.positions[0], role = player.label;
      if (concept.id === 'four-verticals' || player.team === 'defense' ||
        !['WR1', 'WR2', 'WR3', 'TE', 'RB'].includes(role)) return player.positions;
      const side = start.x < 0 ? -1 : 1;
      let points: [number, number, number][];
      if (concept.id === 'slant-flat') {
        points = role.startsWith('WR') && role !== 'WR2'
          ? [[3, start.x, start.z + 3], [8, start.x - side * 7, start.z + 8], [16, start.x - side * 12, start.z + 14]]
          : role === 'TE' || role === 'WR2'
            ? [[4, side * 17, -10], [16, side * 22, -10]]
            : [[7, start.x, start.z], [16, 8, -5]];
      } else if (concept.id === 'stick') {
        points = role === 'TE' ? [[5, 9, -6], [16, 9, -6]]
          : role === 'RB' ? [[4, 16, -10], [16, 21, -10]]
          : role === 'WR1' || role === 'WR2' ? [[5, start.x, start.z + 5], [16, start.x, start.z + 5]]
          : [[16, start.x, start.z + 28]];
      } else if (concept.id === 'smash') {
        points = role === 'WR1' || role === 'WR3'
          ? [[5, start.x, start.z + 5], [16, start.x, start.z + 5]]
          : role === 'TE' || role === 'WR2'
            ? [[6, start.x, start.z + 10], [16, side * 23, start.z + 23]]
            : [[7, start.x, start.z], [16, 8, -5]];
      } else if (concept.id === 'flood') {
        points = role === 'TE' ? [[6, 9, -1], [16, 23, 2]]
          : role === 'RB' ? [[4, 15, -10], [16, 22, -10]]
          : role === 'WR1' ? [[6, -24, 0], [16, -6, 3]]
          : role === 'WR2' ? [[16, -9, 17]]
          : [[16, 24, 18]];
      } else {
        points = role === 'WR2' ? [[4, -9, -6], [10, 0, -6], [16, 9, -6]]
          : role === 'TE' ? [[4, 9, -5.2], [10, 0, -5.2], [16, -9, -5.2]]
          : role === 'RB' ? [[7, start.x, start.z], [16, 20, -10]]
          : [[16, start.x, start.z + 28]];
      }
      return sampledRoute(start, points);
    });
    if (advanceDownfield) {
      routes.forEach((route, playerIndex) => {
        routes[playerIndex] = route.map(point => ({
          x: point.x, z: Math.min(58, point.z + lineOfScrimmage + 10),
        }));
      });
      if (index === 0) players.forEach((player, playerIndex) => { player.positions = [{ ...routes[playerIndex][0] }]; });
    }
    const carrierIndex = base.players.findIndex(player => player.id === `offense-${concept.target}`);
    const defenderIndex = base.players.findIndex(player => player.id === 'defense-CB-R');
    const contact = routes[carrierIndex][16];
    const approach = routes[defenderIndex][12];
    if (!advanceDownfield || index < FOOTBALL_SEQUENCE_CONCEPTS.length - 1) {
      routes[defenderIndex] = routes[defenderIndex].map((point, count) => {
      if (count <= 12) return point;
      const t = (count - 12) / 4;
      return { x: approach.x + (contact.x + .45 - approach.x) * t,
        z: approach.z + (contact.z - approach.z) * t };
      });
      tackles.push({ defenderId: 'defense-CB-R', carrierId: `offense-${concept.target}`, count: startCount + 16 });
    }
    if (advanceDownfield) lineOfScrimmage = contact.z;
    players.forEach((player, playerIndex) => {
      const route = routes[playerIndex];
      if (index > 0) {
        const from = player.positions[player.positions.length - 1];
        for (let count = 1; count <= FOOTBALL_SEQUENCE_RESET_COUNTS - 8; count++) {
          const t = count / (FOOTBALL_SEQUENCE_RESET_COUNTS - 8);
          player.positions.push({ x: from.x + (route[0].x - from.x) * t,
            z: from.z + (route[0].z - from.z) * t });
        }
      }
      player.positions.push(...route.slice(1));
      player.positions.push(...Array.from({ length: 8 }, () => ({ ...route[16] })));
    });
    ballEvents.push({ startCount, endCount: startCount + 1, fromId: 'offense-C', toId: 'offense-QB', kind: 'snap' },
      { startCount: startCount + concept.throwCount, endCount: startCount + concept.throwCount + 2,
        fromId: 'offense-QB', toId: `offense-${concept.target}`, kind: 'pass' });
  });
  const result: FootballPlayGeometry = { players, ballEvents, sequence, tackles };
  if (advanceDownfield) {
    const carrier = players.find(player => player.id === 'offense-WR3')!;
    const pass = ballEvents[ballEvents.length - 1];
    const count = carrier.positions.findIndex((point, count) => count >= pass.endCount && point.z >= 50);
    if (count < 0) throw new Error('Generated touchdown drive did not reach the end zone after the completion.');
    result.outcomes = [{ kind: 'touchdown', count, playerId: carrier.id }];
  }
  return result;
}
