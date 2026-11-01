// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FootballTeam } from './footballPlayGeometry';

export type FootballGait = 'ready' | 'jog' | 'sprint' | 'backpedal' | 'shuffle' | 'block';
export interface FootballMotion {
  team: FootballTeam;
  role: string;
  playStart: number;
  playWindows?: ReadonlyArray<{ startCount: number; endCount: number }>;
}

export function footballMovement(motion: FootballMotion, count: number, dx: number, dz: number) {
  const distance = Math.hypot(dx, dz);
  const travelYaw = distance > 1e-6 ? Math.atan2(dx, dz) : motion.team === 'offense' ? 0 : Math.PI;
  const window = motion.playWindows?.find(window => count >= window.startCount && count < window.endCount);
  const play = motion.playWindows ? !!window : count >= motion.playStart;
  const stanceBlend = play ? Math.min(1, Math.max(0, count - (window?.startCount ?? motion.playStart))) : 1;
  const lineman = ['LT', 'LG', 'C', 'RG', 'RT', 'LS'].includes(motion.role) ||
    motion.team === 'defense' && /^(DE|DT)-/.test(motion.role);
  let gait: FootballGait;
  if (!play) gait = distance > 1e-6 ? 'jog' : 'ready';
  else if (lineman) gait = 'block';
  else if (distance < 1e-6) gait = 'ready';
  else if (motion.role === 'QB' && dz < 0 || motion.team === 'defense' && dz > Math.abs(dx)) gait = 'backpedal';
  else if (Math.abs(dx) > Math.abs(dz) * 1.5 && (motion.team === 'defense' || motion.role === 'QB')) gait = 'shuffle';
  else gait = distance > .8 ? 'sprint' : 'jog';
  const bodyYaw = gait === 'backpedal' || gait === 'shuffle' || gait === 'block' || gait === 'ready'
    ? motion.team === 'offense' ? 0 : Math.PI : travelYaw;
  return {
    gait, bodyYaw,
    stepsPerCount: distance < 1e-6 ? 0 : Math.max(gait === 'sprint' ? 2 : 1, Math.ceil(distance / .6)),
    lean: (gait === 'sprint' ? .24 : gait === 'jog' ? .1 : gait === 'block' ? .4 : -.06) * stanceBlend,
    crouch: gait === 'block' ? .16 : gait === 'shuffle' ? .09 : 0,
    armSwing: gait === 'sprint' ? .85 : gait === 'jog' ? .5 : gait === 'backpedal' ? .3 : .12,
    blockArm: -1.15 * stanceBlend,
    blockElbow: -1.1 + .75 * stanceBlend,
  };
}
