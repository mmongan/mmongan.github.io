// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

type ThrowFrame = readonly [time: number, arm: number, elbow: number, supportArm: number, supportElbow: number];

export const FOOTBALL_THROW_CLIP: readonly ThrowFrame[] = [
  [0, -2.2, -1.8, -.6, -1.5],
  [.35, -2.6, -.45, -.6, -1.5],
  [.8, -.8, -1.8, -.3, -1.5],
  [2, -.8, -1.8, -.3, -1.5],
];

export const FOOTBALL_CATCH_CLIP = {
  reach: { arm: -.75, elbow: -.85, inward: .4 },
  carry: { arm: -.6, elbow: -1.3, inward: .75 },
} as const;

const throwSegments = FOOTBALL_THROW_CLIP.slice(0, -1).map((from, index) => {
  const to = FOOTBALL_THROW_CLIP[index + 1];
  return {
    start: from[0],
    duration: to[0] - from[0],
    channels: [1, 2, 3, 4].map(component => {
      const delta = to[component] - from[component];
      return [from[component], 3 * delta, -2 * delta] as const;
    }),
  };
});

const smooth = (t: number) => t * t * (3 - 2 * t);

export function sampleFootballThrowClip(elapsed: number) {
  if (elapsed <= -1 || elapsed >= 2) return null;
  const index = elapsed < .35 ? 0 : elapsed < .8 ? 1 : 2;
  const segment = throwSegments[index];
  const t = elapsed < 0 ? 0 : (elapsed - segment.start) / segment.duration;
  const mix = (component: number) => {
    const [constant, quadratic, cubic] = segment.channels[component];
    return constant + t * t * (quadratic + t * cubic);
  };
  return {
    blend: elapsed < 0 ? smooth(elapsed + 1) : elapsed < .8 ? 1 : 1 - smooth((elapsed - .8) / 1.2),
    arm: mix(0), elbow: mix(1), supportArm: mix(2), supportElbow: mix(3),
  };
}

export function sampleFootballCatchClip(elapsed: number) {
  if (elapsed <= -1 || elapsed >= 1.5) return null;
  const tuck = smooth(Math.max(0, Math.min(1, elapsed / .5)));
  const { reach, carry } = FOOTBALL_CATCH_CLIP;
  return {
    blend: elapsed < 0 ? smooth(elapsed + 1) : elapsed <= .5 ? 1 : 1 - smooth(elapsed - .5),
    arm: reach.arm + (carry.arm - reach.arm) * tuck,
    elbow: reach.elbow + (carry.elbow - reach.elbow) * tuck,
    inward: reach.inward + (carry.inward - reach.inward) * tuck,
  };
}
