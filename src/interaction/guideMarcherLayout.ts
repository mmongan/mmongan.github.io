// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { FIELD_SURFACE_Y } from '../field/constants';

export interface GuideMarcherSettings {
  spacing: number;
  facing: 'along' | 'reverse' | 'fixed';
  facingAngle: number;
}

export function getGuideMarcherSettings(settings: Partial<GuideMarcherSettings>): GuideMarcherSettings {
  return { spacing: settings.spacing ?? 1.25, facing: settings.facing ?? 'along',
    facingAngle: settings.facingAngle ?? 0 };
}

function buildGuideSegments(points: readonly Vector3[]) {
  const segments = points.slice(1).map((end, index) => ({
    start: points[index], end, length: Math.hypot(end.x - points[index].x, end.z - points[index].z),
  })).filter(segment => segment.length > 1e-8);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  const closed = points.length > 2 && Vector3.DistanceSquared(points[0], points[points.length - 1]) < 1e-8;
  return { segments, total, closed };
}

function posesAtDistances(segments: ReturnType<typeof buildGuideSegments>['segments'],
  distances: readonly number[], settings: GuideMarcherSettings) {
  const poses: Array<{ position: Vector3; rotationY: number }> = [];
  let index = 0, offset = 0;
  for (const distance of distances) {
    while (index < segments.length - 1 && distance >= offset + segments[index].length - 1e-8) {
      offset += segments[index++].length;
    }
    const segment = segments[index];
    const position = Vector3.Lerp(segment.start, segment.end,
      Math.max(0, Math.min(1, (distance - offset) / segment.length)));
    const along = Math.atan2(segment.end.x - segment.start.x, segment.end.z - segment.start.z);
    const rotationY = settings.facing === 'fixed' ? settings.facingAngle * Math.PI / 180 :
      along + (settings.facing === 'reverse' ? Math.PI : 0);
    poses.push({ position, rotationY: Math.atan2(Math.sin(rotationY), Math.cos(rotationY)) });
  }
  return poses;
}

export function sampleGuideMarchers(points: readonly Vector3[], options: Partial<GuideMarcherSettings>) {
  const settings = getGuideMarcherSettings(options);
  if (!Number.isFinite(settings.spacing) || settings.spacing < 0.625 || settings.spacing > 10 ||
    !Number.isFinite(settings.facingAngle)) throw new Error('Invalid guide marcher settings.');
  const { segments, total, closed } = buildGuideSegments(points);
  const distances: number[] = [];
  for (let distance = 0; segments.length && distance <= total + 1e-8; distance += settings.spacing) {
    if (closed && distance >= total - 1e-8) break;
    distances.push(distance);
  }
  return posesAtDistances(segments, distances, settings);
}

/**
 * Exactly `count` poses spread evenly along the guide (open guides include
 * both endpoints; closed guides spread around the loop without duplicating
 * the start), facing by the guide's marcher settings. Used to form a whole
 * selection along a guide, where the slot count must match the marchers.
 */
export function sampleGuideFormation(points: readonly Vector3[], count: number,
  options: Partial<GuideMarcherSettings>) {
  const settings = getGuideMarcherSettings(options);
  if (!Number.isFinite(settings.facingAngle)) throw new Error('Invalid guide marcher settings.');
  const { segments, total, closed } = buildGuideSegments(points);
  if (!segments.length || count < 1 || total < 0.05) return [];
  const distances = Array.from({ length: count }, (_, index) =>
    closed ? total * index / count : count === 1 ? total / 2 : total * index / (count - 1));
  return posesAtDistances(segments, distances, settings);
}

/**
 * Arc-length position of the nearest point on the guide polyline, used to
 * order marchers along a guide before assigning formation slots.
 */
export function guideArcParameter(points: readonly Vector3[], reference: Vector3): number {
  const { segments } = buildGuideSegments(points);
  let best = 0, bestDistance = Infinity, offset = 0;
  for (const segment of segments) {
    const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1,
      ((reference.x - segment.start.x) * dx + (reference.z - segment.start.z) * dz) / lengthSquared)) : 0;
    const distance = Math.hypot(reference.x - segment.start.x - t * dx, reference.z - segment.start.z - t * dz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = offset + t * segment.length;
    }
    offset += segment.length;
  }
  return best;
}

export function sampleDestinationGuide(controlPoints: readonly Vector3[], count: number): Vector3[] {
  const points = controlPoints.map(point => new Vector3(point.x, FIELD_SURFACE_Y, point.z));
  const closed = points.length > 2 && Vector3.DistanceSquared(points[0], points[points.length - 1]) < 1e-6;
  if (closed) points.pop();
  const segmentCount = closed ? points.length : points.length - 1;
  const lengths = Array.from({ length: Math.max(0, segmentCount) }, (_, index) =>
    Vector3.Distance(points[index], points[(index + 1) % points.length]));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (points.length < 2 || !Number.isFinite(totalLength) || totalLength < 0.05) return [];
  return Array.from({ length: count }, (_, index) => {
    const distance = closed ? totalLength * index / count
      : count === 1 ? totalLength / 2 : totalLength * index / (count - 1);
    let remaining = distance;
    let segment = 0;
    while (segment < lengths.length - 1 && remaining > lengths[segment]) {
      remaining -= lengths[segment++];
    }
    const length = lengths[segment];
    return Vector3.Lerp(points[segment], points[(segment + 1) % points.length],
      length > 0 ? Math.min(1, remaining / length) : 0);
  });
}
