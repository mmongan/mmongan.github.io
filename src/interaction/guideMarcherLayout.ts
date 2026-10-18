import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';

export interface GuideMarcherSettings {
  spacing: number;
  facing: 'along' | 'reverse' | 'fixed';
  facingAngle: number;
}

export function getGuideMarcherSettings(settings: Partial<GuideMarcherSettings>): GuideMarcherSettings {
  return { spacing: settings.spacing ?? 1.25, facing: settings.facing ?? 'along',
    facingAngle: settings.facingAngle ?? 0 };
}

export function sampleGuideMarchers(points: readonly Vector3[], options: Partial<GuideMarcherSettings>) {
  const settings = getGuideMarcherSettings(options);
  if (!Number.isFinite(settings.spacing) || settings.spacing < 0.625 || settings.spacing > 10 ||
    !Number.isFinite(settings.facingAngle)) throw new Error('Invalid guide marcher settings.');
  const segments = points.slice(1).map((end, index) => ({
    start: points[index], end, length: Math.hypot(end.x - points[index].x, end.z - points[index].z),
  })).filter(segment => segment.length > 1e-8);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  const closed = points.length > 2 && Vector3.DistanceSquared(points[0], points[points.length - 1]) < 1e-8;
  const poses: Array<{ position: Vector3; rotationY: number }> = [];
  let index = 0, offset = 0;
  for (let distance = 0; segments.length && distance <= total + 1e-8; distance += settings.spacing) {
    if (closed && distance >= total - 1e-8) break;
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
