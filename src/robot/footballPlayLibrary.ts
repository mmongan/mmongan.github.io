// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FOOTBALL_PLAY_OPTIONS, generateFootballPlay, type FootballFormation, type FootballPlay,
  FOOTBALL_PLAY_PRESETS, type FootballPlayGeometry, type FootballPosition } from './footballPlayGeometry';
import { generateFootballPlaySequence, FOOTBALL_SEQUENCE_CONCEPTS } from './footballPlaySequence';
import { generateFootballSpecialTeams } from './footballSpecialTeams';

export const FOOTBALL_PLAY_LIBRARY = FOOTBALL_PLAY_OPTIONS.map(option => ({
  ...option,
  category: option.value === 'drive' || option.value === 'sequence' ? 'Sequences'
    : ['kickoff', 'punt', 'field-goal'].includes(option.value) ? 'Special teams'
    : ['edge-sack', 'blitz-sack', 'four-man-rush', 'linebacker-blitz'].includes(option.value) ? 'Defense' : 'Offense',
}));

function generateFootballRushPlay(formation: FootballFormation, play: FootballPlay): FootballPlayGeometry {
  const base = generateFootballPlay(formation, 'slants');
  const sack = play === 'edge-sack' || play === 'blitz-sack';
  const blitz = play === 'blitz-sack' || play === 'linebacker-blitz';
  const contactCount = 12;
  const quarterback = base.players.find(player => player.label === 'QB');
  if (!quarterback) throw new Error('Defensive rush play requires a quarterback.');
  const pocket = quarterback.positions[8];
  const interpolate = (from: FootballPosition, to: FootballPosition, t: number) => ({
    x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t,
  });
  const tackler = blitz ? 'defense-LB-M' : 'defense-DE-R';
  const players = base.players.map(player => {
    const start = player.positions[0];
    const rush = player.team === 'defense' && (/^(DE|DT)-/.test(player.label) || blitz && player.label === 'LB-M');
    const positions = Array.from({ length: 25 }, (_, count) => {
      if (player.label === 'QB') return interpolate(start, pocket, Math.min(1, count / 4));
      if (!rush) return { ...player.positions[Math.min(count, sack ? contactCount : 16)] };
      const edge = player.label.startsWith('DE');
      const side = start.x < 0 ? -1 : 1;
      const bend = edge ? { x: side * 5.5, z: -12 }
        : { x: start.x, z: -11 };
      const target = player.id === tackler && sack ? { x: pocket.x + .45, z: pocket.z }
        : { x: pocket.x + side * (edge ? 2.5 : 1.4), z: pocket.z + (edge ? .6 : 2) };
      if (count <= 4) return interpolate(start, bend, count / 4);
      return interpolate(bend, target, Math.min(1, (count - 4) / (contactCount - 4)));
    });
    return { ...player, rush, positions };
  });
  return {
    players,
    ballEvents: sack ? [base.ballEvents[0]] : [base.ballEvents[0], {
      kind: 'pass', startCount: 6, endCount: 8, fromId: quarterback.id, toId: 'offense-WR1',
    }],
    tackles: sack ? [{ defenderId: tackler, carrierId: quarterback.id, count: contactCount }] : [],
    sequence: [{ label: FOOTBALL_PLAY_PRESETS[play].label, startCount: 0, endCount: sack ? contactCount : 16,
      source: '' }],
  };
}

export function generateFootballLibraryPlay(formation: FootballFormation, play: FootballPlay): FootballPlayGeometry {
  if (['edge-sack', 'blitz-sack', 'four-man-rush', 'linebacker-blitz'].includes(play)) {
    return generateFootballRushPlay(formation, play);
  }
  if (play === 'sequence' || play === 'drive') return generateFootballPlaySequence(play === 'drive');
  if (play === 'kickoff' || play === 'punt' || play === 'field-goal') return generateFootballSpecialTeams(play);
  const concept = FOOTBALL_SEQUENCE_CONCEPTS.findIndex(concept => concept.id === play);
  if (concept >= 0 && play !== 'four-verticals') {
    const sequence = generateFootballPlaySequence();
    const segment = sequence.sequence![concept];
    return {
      players: sequence.players.map(player => ({ ...player,
        positions: player.positions.slice(segment.startCount, segment.endCount + 9) })),
      ballEvents: sequence.ballEvents.filter(event =>
        event.startCount >= segment.startCount && event.endCount <= segment.endCount)
        .map(event => ({ ...event, startCount: event.startCount - segment.startCount,
          endCount: event.endCount - segment.startCount })),
      tackles: sequence.tackles!.filter(event => event.count === segment.endCount)
        .map(event => ({ ...event, count: 16 })),
      sequence: [{ ...segment, startCount: 0, endCount: 16 }],
    };
  }
  return generateFootballPlay(formation, play);
}
