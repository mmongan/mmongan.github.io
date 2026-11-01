// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FootballPosition } from './footballPlayGeometry';

export interface FootballBodyFootprint extends FootballPosition {
  yaw: number;
  fall: number;
  scale: number;
  lean?: number;
  minZ?: number;
  maxZ?: number;
}

function segment(body: FootballBodyFootprint) {
  const lean = body.lean ?? 0;
  const reach = ((.05 + Math.abs(lean) * .5) * (1 - body.fall) + .9 * body.fall) * body.scale;
  const offset = (-.03 + lean * .5) * (1 - body.fall) * body.scale;
  const dx = Math.sin(body.yaw) * reach, dz = Math.cos(body.yaw) * reach;
  const x = body.x + Math.sin(body.yaw) * offset, z = body.z + Math.cos(body.yaw) * offset;
  return [{ x: x - dx, z: z - dz }, { x: x + dx, z: z + dz }] as const;
}

export function footballBodyZRange(body: FootballBodyFootprint) {
  const [a, b] = segment(body);
  // Planted cleats extend farther than the torso capsule at a pre-snap gait boundary.
  const footReach = .85 * body.scale;
  return { min: Math.min(a.z - .53 * body.scale, b.z - .53 * body.scale, body.z - footReach),
    max: Math.max(a.z + .53 * body.scale, b.z + .53 * body.scale, body.z + footReach) };
}

function nearest(point: FootballPosition, a: FootballPosition, b: FootballPosition) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared)) : 0;
  return { x: a.x + dx * t, z: a.z + dz * t };
}

export function footballBodyGap(a: FootballBodyFootprint, b: FootballBodyFootprint) {
  const [a0, a1] = segment(a), [b0, b1] = segment(b);
  const ax = a1.x - a0.x, az = a1.z - a0.z;
  const bx = b1.x - b0.x, bz = b1.z - b0.z;
  const cross = ax * bz - az * bx;
  if (Math.abs(cross) > 1e-12) {
    const dx = b0.x - a0.x, dz = b0.z - a0.z;
    const t = (dx * bz - dz * bx) / cross, u = (dx * az - dz * ax) / cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { x: 0, z: 0, distance: 0 };
  }
  const pairs = [[a0, nearest(a0, b0, b1)], [a1, nearest(a1, b0, b1)],
    [nearest(b0, a0, a1), b0], [nearest(b1, a0, a1), b1]];
  const deltas = pairs.map(([left, right]) => ({
    x: right.x - left.x, z: right.z - left.z,
    distance: Math.hypot(right.x - left.x, right.z - left.z),
  }));
  return deltas.reduce((best, delta) => delta.distance < best.distance ? delta : best);
}

export function separateFootballBodies(input: readonly FootballBodyFootprint[]): FootballPosition[] {
  const bodies = input.map(body => ({ ...body }));
  if (bodies.some(body => ![body.x, body.z, body.yaw, body.fall, body.scale].every(Number.isFinite) ||
    !Number.isFinite(body.lean ?? 0) ||
    body.minZ !== undefined && !Number.isFinite(body.minZ) ||
    body.maxZ !== undefined && !Number.isFinite(body.maxZ) ||
    body.minZ !== undefined && body.maxZ !== undefined && body.minZ > body.maxZ ||
    body.scale <= 0 || body.fall < 0 || body.fall > 1)) {
    throw new Error('Football body clearance requires finite poses and positive player scales.');
  }
  const radii = bodies.map(body => {
    const lean = body.lean ?? 0;
    return (.53 + (.05 + Math.abs(lean) * .5) * (1 - body.fall) + .9 * body.fall +
      Math.abs(-.03 + lean * .5) * (1 - body.fall)) * body.scale;
  });
  const constrain = (body: FootballBodyFootprint) => {
    body.z = Math.max(body.minZ ?? -Infinity, Math.min(body.maxZ ?? Infinity, body.z));
  };
  bodies.forEach(constrain);
  for (let iteration = 0; iteration < 2048; iteration++) {
    let separated = true;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const radius = radii[i] + radii[j];
        if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 >= radius * radius) continue;
        const gap = footballBodyGap(a, b);
        // Capsules enclose shoulder pads, swinging limbs and the horizontal fallen rig.
        const clearance = .53 * (a.scale + b.scale);
        if (gap.distance >= clearance - 1e-6) continue;
        separated = false;
        let dx = gap.x, dz = gap.z;
        let push = (clearance - gap.distance + 1e-5) / 2;
        if (Math.abs(Math.sin(a.yaw - b.yaw)) < .05) {
          // Parallel/head-on paths slide alongside each other instead of swapping sides at contact.
          const lateral = (b.x - a.x) * Math.cos(a.yaw) - (b.z - a.z) * Math.sin(a.yaw);
          const sign = lateral < -1e-9 ? -1 : 1;
          dx = Math.cos(a.yaw) * sign; dz = -Math.sin(a.yaw) * sign;
          const [a0, a1] = segment(a), [b0, b1] = segment(b);
          const projection = (point: FootballPosition) => point.x * Math.sin(a.yaw) + point.z * Math.cos(a.yaw);
          const lateralProjection = (point: FootballPosition) => point.x * dx + point.z * dz;
          const left = [projection(a0), projection(a1)], right = [projection(b0), projection(b1)];
          const alongGap = Math.max(0, Math.min(...right) - Math.max(...left), Math.min(...left) - Math.max(...right));
          const required = Math.sqrt(Math.max(0, clearance * clearance - alongGap * alongGap));
          const acrossGap = Math.min(lateralProjection(b0), lateralProjection(b1)) -
            Math.max(lateralProjection(a0), lateralProjection(a1));
          push = Math.max(push, (required - acrossGap + 1e-5) / 2);
        } else if (gap.distance < 1e-9) {
          dx = b.x - a.x; dz = b.z - a.z;
          if (Math.hypot(dx, dz) < 1e-9) { dx = Math.cos(a.yaw); dz = -Math.sin(a.yaw); }
        }
        const length = Math.hypot(dx, dz);
        dx *= push / length; dz *= push / length;
        a.x -= dx; a.z -= dz; b.x += dx; b.z += dz;
        constrain(a); constrain(b);
      }
    }
    if (separated) return bodies.map(({ x, z }) => ({ x, z }));
  }
  throw new Error('Could not separate the football bodies at this count. Spread the crowded routes apart.');
}
