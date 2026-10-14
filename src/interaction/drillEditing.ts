export interface DrillPoint { x: number; y: number; z: number }
export interface FormationTransform {
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

export function snapDrillPoint(point: DrillPoint, interval: number): DrillPoint {
  if (!Number.isFinite(interval) || interval <= 0) throw new RangeError("Grid interval must be positive.");
  return { x: Math.round(point.x / interval) * interval, y: point.y,
    z: Math.round(point.z / interval) * interval };
}

export function transformFormationPoint(
  point: DrillPoint, center: DrillPoint, transform: FormationTransform
): DrillPoint {
  if (![transform.x, transform.z, transform.rotation, transform.scale].every(Number.isFinite) ||
    transform.scale <= 0) throw new RangeError("Formation transform must be finite with a positive scale.");
  const x = (point.x - center.x) * transform.scale;
  const z = (point.z - center.z) * transform.scale;
  const sin = Math.sin(transform.rotation);
  const cos = Math.cos(transform.rotation);
  return { x: center.x + x * cos + z * sin + transform.x,
    y: point.y, z: center.z - x * sin + z * cos + transform.z };
}
