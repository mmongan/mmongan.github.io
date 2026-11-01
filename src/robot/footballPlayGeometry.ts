export type FootballTeam = 'offense' | 'defense';
export type FootballFormation = 'shotgun' | 'spread' | 'i-form';
export type FootballPlay = 'slants' | 'sweep' | 'four-verticals';
export type FootballBallEventKind = 'snap' | 'handoff' | 'pass';

export interface FootballPosition {
  x: number;
  z: number;
}

export type OffensivePlayerRole =
  | 'LT' | 'LG' | 'C' | 'RG' | 'RT'
  | 'QB' | 'RB' | 'FB' | 'TE' | 'WR1' | 'WR2' | 'WR3';

export type DefensivePlayerRole =
  | 'DE-L' | 'DT-L' | 'DT-R' | 'DE-R'
  | 'LB-L' | 'LB-M' | 'LB-R'
  | 'CB-L' | 'CB-R' | 'FS' | 'SS';

export interface FootballFormationPreset {
  label: string;
  positions: Partial<Record<OffensivePlayerRole, FootballPosition>>;
}

export interface FootballPlayPreset {
  label: string;
  target: 'WR1' | 'WR3' | 'RB';
}

export interface FootballPlayer {
  id: string;
  label: OffensivePlayerRole | DefensivePlayerRole;
  team: FootballTeam;
  positions: FootballPosition[];
}

export interface FootballBallEvent {
  startCount: number;
  endCount: number;
  fromId: string;
  toId: string;
  kind: FootballBallEventKind;
}

export interface FootballPlayGeometry {
  players: FootballPlayer[];
  ballEvents: FootballBallEvent[];
}

export const FOOTBALL_FORMATIONS = ['shotgun', 'spread', 'i-form'] as const satisfies readonly FootballFormation[];
export const FOOTBALL_PLAYS = ['slants', 'sweep', 'four-verticals'] as const satisfies readonly FootballPlay[];

export const FOOTBALL_FORMATION_OPTIONS: ReadonlyArray<{ value: FootballFormation; label: string }> = [
  { value: 'shotgun', label: 'Shotgun' },
  { value: 'spread', label: 'Shotgun Spread (2x2)' },
  { value: 'i-form', label: 'I-Formation' },
];

export const FOOTBALL_PLAY_OPTIONS: ReadonlyArray<{ value: FootballPlay; label: string }> = [
  { value: 'slants', label: 'Slants' },
  { value: 'sweep', label: 'Sweep' },
  { value: 'four-verticals', label: 'Four Verticals' },
];

export const FOOTBALL_SCRIMMAGE_DEFAULT = { formation: 'spread', play: 'four-verticals' } as const;
export const FOUR_VERTICALS_SOURCE = 'https://www.footballplaybookdesigner.com/library/article/four-verticals';

export const FOOTBALL_FORMATION_PRESETS: Record<FootballFormation, FootballFormationPreset> = {
  shotgun: {
    label: 'Shotgun',
    positions: {
      LT: { x: -2.8, z: -10 }, LG: { x: -1.4, z: -10 }, C: { x: 0, z: -10 },
      RG: { x: 1.4, z: -10 }, RT: { x: 2.8, z: -10 },
      QB: { x: 0, z: -16 }, RB: { x: -3, z: -18 },
      TE: { x: 4.2, z: -10 }, WR1: { x: -22, z: -10 },
      WR2: { x: -14, z: -11 }, WR3: { x: 22, z: -11 },
    },
  },
  spread: {
    label: 'Shotgun Spread (2x2)',
    positions: {
      LT: { x: -2.8, z: -10 }, LG: { x: -1.4, z: -10 }, C: { x: 0, z: -10 },
      RG: { x: 1.4, z: -10 }, RT: { x: 2.8, z: -10 },
      QB: { x: 0, z: -14.5 }, RB: { x: 5, z: -18 },
      TE: { x: 9, z: -11 }, WR1: { x: -24, z: -10 },
      WR2: { x: -9, z: -11 }, WR3: { x: 24, z: -10 },
    },
  },
  'i-form': {
    label: 'I-Formation',
    positions: {
      LT: { x: -2.8, z: -10 }, LG: { x: -1.4, z: -10 }, C: { x: 0, z: -10 },
      RG: { x: 1.4, z: -10 }, RT: { x: 2.8, z: -10 },
      QB: { x: 0, z: -11 }, FB: { x: 0, z: -14 }, RB: { x: 0, z: -18 },
      TE: { x: 4.2, z: -10 }, WR1: { x: -22, z: -10 },
      WR3: { x: 22, z: -11 },
    },
  },
};

export const FOOTBALL_PLAY_PRESETS: Record<FootballPlay, FootballPlayPreset> = {
  slants: { label: 'Slants', target: 'WR1' },
  sweep: { label: 'Sweep', target: 'RB' },
  'four-verticals': { label: 'Four Verticals', target: 'WR3' },
};

const DEFENSE: Record<DefensivePlayerRole, FootballPosition> = {
  'DE-L': { x: -4, z: -8.5 }, 'DT-L': { x: -1.5, z: -8.5 },
  'DT-R': { x: 1.5, z: -8.5 }, 'DE-R': { x: 4, z: -8.5 },
  'LB-L': { x: -12, z: -1 }, 'LB-M': { x: -4, z: -1 },
  'LB-R': { x: 4, z: -1 }, 'CB-L': { x: -22, z: -7 },
  'CB-R': { x: 22, z: -7 }, FS: { x: -1, z: 4 },
  SS: { x: 12, z: 1 },
};

const OFFENSE_ROLES: readonly OffensivePlayerRole[] = [
  'LT', 'LG', 'C', 'RG', 'RT', 'QB', 'RB', 'TE', 'WR1', 'WR2', 'WR3',
];
const DEFENSE_ROLES: readonly DefensivePlayerRole[] = [
  'DE-L', 'DT-L', 'DT-R', 'DE-R', 'LB-L', 'LB-M', 'LB-R', 'CB-L', 'CB-R', 'FS', 'SS',
];

type RouteKeyframe = { count: number; x: number; z: number };

function routeAt(start: FootballPosition, frames: RouteKeyframe[], count: number): FootballPosition {
  let left = frames[0];
  for (let index = 1; index < frames.length; index++) {
    const right = frames[index];
    if (count <= right.count) {
      const progress = (count - left.count) / (right.count - left.count);
      return {
        x: left.x + (right.x - left.x) * progress,
        z: left.z + (right.z - left.z) * progress,
      };
    }
    left = right;
  }
  return { x: start.x, z: start.z };
}

function routeFrames(role: OffensivePlayerRole, play: FootballPlay, start: FootballPosition,
  quarterback: FootballPosition): RouteKeyframe[] {
  if (['LT', 'LG', 'C', 'RG', 'RT'].includes(role)) {
    const slot = OFFENSE_ROLES.indexOf(role);
    return [
      { count: 0, ...start },
      { count: 2, x: start.x + (slot - 2) * 0.08, z: start.z + 0.4 },
      { count: 8, x: start.x + (slot - 2) * 0.16, z: start.z + 1.5 },
      { count: 16, x: start.x + (slot - 2) * 0.2, z: start.z + 1.8 },
    ];
  }

  if (role === 'QB') {
    const movement = play === 'sweep' ? 0.2 : 0.6;
    return [
      { count: 0, ...start },
      { count: 2, x: start.x - 0.15, z: start.z - 0.7 },
      { count: 8, x: start.x - 0.2, z: start.z - movement },
      { count: 16, x: start.x + 0.2, z: start.z - movement + 0.3 },
    ];
  }

  if (role === 'RB' && play === 'sweep') {
    return [
      { count: 0, ...start },
      { count: 2, x: quarterback.x + .4, z: quarterback.z - .7 },
      { count: 3, x: quarterback.x + .5, z: quarterback.z - .7 },
      { count: 5, x: start.x + 7, z: start.z - 0.2 },
      { count: 10, x: start.x + 13, z: start.z + 1.5 },
      { count: 16, x: start.x + 16, z: start.z + 5 },
    ];
  }

  if (role === 'RB' || role === 'FB' && play !== 'four-verticals') {
    return [
      { count: 0, ...start },
      { count: 4, x: start.x + 0.5, z: start.z - 0.4 },
      { count: 10, x: start.x + 1.2, z: start.z + 0.5 },
      { count: 16, x: start.x + 1.8, z: start.z + 1.4 },
    ];
  }

  if (role === 'TE' || role === 'FB') {
    const endX = play === 'sweep' ? start.x + 3 : start.x - 5;
    const endZ = play === 'four-verticals' ? start.z + 19 : start.z + 10;
    return [
      { count: 0, ...start },
      { count: 3, x: start.x + 0.2, z: start.z + 1 },
      { count: 9, x: (start.x + endX) / 2, z: start.z + 5 },
      { count: 16, x: endX, z: endZ },
    ];
  }

  const receiverIndex = Number(role.charAt(role.length - 1));
  if (play === 'slants') {
    const inward = role === 'WR3' ? -1 : 1;
    const endX = start.x + inward * (role === 'WR2' ? 8 : 13);
    return [
      { count: 0, ...start },
      { count: 3, x: start.x + inward * 0.8, z: start.z + 3 },
      { count: 8, x: start.x + inward * 5, z: start.z + 10 },
      { count: 16, x: endX, z: start.z + 19 + receiverIndex },
    ];
  }

  if (play === 'four-verticals') {
    const laneOffset = role === 'WR1' ? 1 : role === 'WR2' ? -1 : 0.5;
    return [
      { count: 0, ...start },
      { count: 3, x: start.x + laneOffset * 0.3, z: start.z + 4 },
      { count: 9, x: start.x + laneOffset, z: start.z + 14 },
      { count: 16, x: start.x + laneOffset * 1.5, z: start.z + 27 + receiverIndex },
    ];
  }

  const direction = role === 'WR3' ? -1 : role === 'WR1' ? 1 : 0;
  return [
    { count: 0, ...start },
    { count: 4, x: start.x + direction * 0.6, z: start.z + 0.3 },
    { count: 10, x: start.x + direction * 1.5, z: start.z + 0.7 },
    { count: 16, x: start.x + direction * 2, z: start.z + 1 },
  ];
}

function defensiveRoute(role: DefensivePlayerRole, start: FootballPosition): RouteKeyframe[] {
  const index = DEFENSE_ROLES.indexOf(role);
  const lateral = ((index % 3) - 1) * 0.7;
  const depth = role.startsWith('DE') || role.startsWith('DT')
    ? -3 : 1.2 + (index % 4) * 0.35;
  return [
    { count: 0, ...start },
    { count: 4, x: start.x + lateral * 0.35, z: start.z + 0.25 },
    { count: 10, x: start.x + lateral, z: start.z + depth * 0.65 },
    { count: 16, x: start.x + lateral * 1.3, z: start.z + depth },
  ];
}

function fourVerticalsRoute(role: OffensivePlayerRole, start: FootballPosition): RouteKeyframe[] {
  if (['LT', 'LG', 'C', 'RG', 'RT'].includes(role)) {
    return [{ count: 0, ...start }, { count: 3, x: start.x, z: start.z - 1.5 },
      { count: 16, x: start.x, z: start.z - 1.5 }];
  }
  if (role === 'QB') {
    return [{ count: 0, ...start }, { count: 3, x: start.x, z: start.z - 2 },
      { count: 12, x: start.x, z: start.z - 2 }, { count: 16, x: start.x, z: start.z - 1.5 }];
  }
  if (role === 'RB') {
    return [{ count: 0, ...start }, { count: 3, x: 3.5, z: -15.5 },
      { count: 7, x: 3.5, z: -15.5 }, { count: 12, x: 7, z: -9 },
      { count: 16, x: 8, z: -5 }];
  }
  return [{ count: 0, ...start }, { count: 3, x: start.x, z: start.z + 4 },
    { count: 9, x: start.x, z: start.z + 15 }, { count: 16, x: start.x, z: start.z + 28 }];
}

// Illustrative 4-3 Cover 2 response, not an adaptive coverage or blocking solver.
function coverTwoRoute(role: DefensivePlayerRole, start: FootballPosition): RouteKeyframe[] {
  const end = role.startsWith('DE') || role.startsWith('DT')
    ? { x: start.x, z: -11.5 }
    : role === 'FS' ? { x: -13, z: 19 }
    : role === 'SS' ? { x: 13, z: 19 }
    : role.startsWith('CB') ? { x: start.x, z: -3 }
    : { x: role === 'LB-L' ? -8 : role === 'LB-R' ? 8 : 0, z: 1 };
  return [{ count: 0, ...start }, { count: 8, ...end }, { count: 16, ...end }];
}

function ballEvents(play: FootballPlay): FootballBallEvent[] {
  const events: FootballBallEvent[] = [
    { startCount: 0, endCount: 1, fromId: 'offense-C', toId: 'offense-QB', kind: 'snap' },
  ];
  if (play === 'sweep') {
    events.push({ startCount: 2, endCount: 3, fromId: 'offense-QB', toId: 'offense-RB', kind: 'handoff' });
  } else {
    events.push({
      startCount: 12, endCount: 14, fromId: 'offense-QB',
      toId: `offense-${FOOTBALL_PLAY_PRESETS[play].target}`, kind: 'pass',
    });
  }
  return events;
}

export function generateFootballPlay(formation: FootballFormation, play: FootballPlay): FootballPlayGeometry {
  const preset = FOOTBALL_FORMATION_PRESETS[formation];
  if (!preset || !FOOTBALL_PLAYS.includes(play)) {
    throw new Error('Choose a supported football formation and play.');
  }

  const quarterback = preset.positions.QB;
  const sourcedPlay = formation === 'spread' && play === 'four-verticals';
  if (!quarterback) throw new Error('Football formation is missing its quarterback.');
  const offense = OFFENSE_ROLES.map((originalRole): FootballPlayer => {
    const role = formation === 'i-form' && originalRole === 'WR2' ? 'FB' : originalRole;
    const start = preset.positions[role];
    if (!start) throw new Error(`Football formation is missing ${role}.`);
    const frames = sourcedPlay ? fourVerticalsRoute(role, start) : routeFrames(role, play, start, quarterback);
    return {
      id: `offense-${role}`,
      label: role,
      team: 'offense',
      positions: Array.from({ length: 17 }, (_, count) => routeAt(start, frames, count)),
    };
  });
  const defense = DEFENSE_ROLES.map((role): FootballPlayer => {
    const start = sourcedPlay && (role === 'FS' || role === 'SS')
      ? { x: role === 'FS' ? -13 : 13, z: 3 } : DEFENSE[role];
    const frames = sourcedPlay ? coverTwoRoute(role, start) : defensiveRoute(role, start);
    return {
      id: `defense-${role}`,
      label: role,
      team: 'defense',
      positions: Array.from({ length: 17 }, (_, count) => routeAt(start, frames, count)),
    };
  });

  return { players: [...offense, ...defense], ballEvents: ballEvents(play) };
}
