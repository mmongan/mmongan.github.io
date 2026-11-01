// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { FootballTeam } from './footballPlayGeometry';

const teams = new WeakMap<TransformNode, FootballTeam>();
export function setFootballTeam(robot: TransformNode, team: FootballTeam | null) {
  if (team === null) teams.delete(robot);
  else teams.set(robot, team);
}
export function getFootballTeam(robot: TransformNode) { return teams.get(robot); }
export function footballChartSymbol(robot: TransformNode) {
  const team = teams.get(robot);
  return team === 'offense' ? 'O' : team === 'defense' ? 'X' : null;
}
