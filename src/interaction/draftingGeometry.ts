import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { FIELD_SURFACE_Y } from '../field/constants';

export type DraftingTool = 'tSquare' | 'setSquare' | 'dividers' | 'tape' | 'spline' | 'offset' | 'annotation' | 'yarn' | 'stickyNote';

export function constrainedDraftLine(start: Vector3, end: Vector3, angle: number | null) {
  const delta = end.subtract(start);
  const heading = Math.atan2(delta.z, delta.x);
  const increment = angle === null ? Math.PI / 2 : angle * Math.PI / 180;
  const snapped = Math.round(heading / increment) * increment;
  const direction = new Vector3(Math.cos(snapped), 0, Math.sin(snapped));
  const length = Math.max(0, Vector3.Dot(delta, direction));
  return [new Vector3(start.x, FIELD_SURFACE_Y + 0.025, start.z),
    new Vector3(start.x + direction.x * length, FIELD_SURFACE_Y + 0.025, start.z + direction.z * length)];
}

export function measureDraftLine(points: readonly Vector3[]) {
  let yards = 0;
  for (let index = 1; index < points.length; index++) {
    yards += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  }
  return { yards, steps: yards / 0.625 };
}

export function divideDraftLine(points: readonly Vector3[], spacing: number): Vector3[] {
  if (points.length < 2 || !Number.isFinite(spacing) || spacing < 0.05) return [];
  const length = measureDraftLine(points).yards;
  if (length < 0.05 || length / spacing > 512) return [];
  const result = [points[0].clone()];
  let travelled = 0, next = spacing;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index];
    const segment = Math.hypot(end.x - start.x, end.z - start.z);
    if (segment < 1e-8) continue;
    while (next <= travelled + segment + 1e-8) {
      result.push(Vector3.Lerp(start, end, Math.min(1, (next - travelled) / segment)));
      next += spacing;
    }
    travelled += segment;
  }
  return result;
}

export function sampleDraftSpline(controls: readonly Vector3[]): Vector3[] {
  if (controls.length !== 3) return [];
  return Array.from({ length: 65 }, (_, index) => {
    const t = index / 64, u = 1 - t;
    return new Vector3(
      u * u * controls[0].x + 2 * u * t * controls[1].x + t * t * controls[2].x,
      FIELD_SURFACE_Y + 0.025,
      u * u * controls[0].z + 2 * u * t * controls[1].z + t * t * controls[2].z
    );
  });
}

export function offsetDraftLine(points: readonly Vector3[], distance: number): Vector3[] {
  if (points.length < 2 || !Number.isFinite(distance)) return [];
  const unique = points.filter((point, index) => index === 0 ||
    Math.hypot(point.x - points[index - 1].x, point.z - points[index - 1].z) > 1e-6);
  if (unique.length < 2) return [];
  const closed = Vector3.Distance(unique[0], unique[unique.length - 1]) < 1e-6;
  const vertices = closed ? unique.slice(0, -1) : unique;
  const normal = (from: Vector3, to: Vector3) => {
    const delta = to.subtract(from); delta.y = 0; delta.normalize();
    return new Vector3(-delta.z, 0, delta.x);
  };
  const result = vertices.map((point, index) => {
    const before = index > 0 ? vertices[index - 1] : closed ? vertices[vertices.length - 1] : null;
    const after = index < vertices.length - 1 ? vertices[index + 1] : closed ? vertices[0] : null;
    const a = before ? normal(before, point) : normal(point, after!);
    const b = after ? normal(point, after) : a;
    const bisector = a.add(b);
    const denominator = Vector3.Dot(bisector, b);
    // Bound miters at acute turns rather than generating arbitrarily long spikes.
    const offset = denominator > 1e-6 ? bisector.scale(distance / denominator) : b.scale(distance);
    if (offset.length() > Math.abs(distance) * 4) offset.normalize().scaleInPlace(Math.abs(distance) * 4);
    return new Vector3(point.x + offset.x, FIELD_SURFACE_Y + 0.025, point.z + offset.z);
  });
  if (closed) result.push(result[0].clone());
  return result;
}
