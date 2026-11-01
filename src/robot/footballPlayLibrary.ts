// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FOOTBALL_PLAY_OPTIONS, generateFootballPlay, type FootballFormation, type FootballPlay,
  type FootballPlayGeometry } from './footballPlayGeometry';
import { generateFootballPlaySequence, FOOTBALL_SEQUENCE_CONCEPTS } from './footballPlaySequence';
import { generateFootballSpecialTeams } from './footballSpecialTeams';

export const FOOTBALL_PLAY_LIBRARY = FOOTBALL_PLAY_OPTIONS.map(option => ({
  ...option,
  category: option.value === 'drive' || option.value === 'sequence' ? 'Sequences'
    : ['kickoff', 'punt', 'field-goal'].includes(option.value) ? 'Special teams' : 'Offense',
}));

export function generateFootballLibraryPlay(formation: FootballFormation, play: FootballPlay): FootballPlayGeometry {
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
