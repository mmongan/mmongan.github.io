import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { FIELD_LENGTH_YARDS, FIELD_SURFACE_Y, FIELD_WIDTH_YARDS } from '../field/constants';

export type FieldStencil = 'circleStencil' | 'squareStencil' | 'triangleStencil' |
  'pentagonStencil' | 'hexagonStencil' | 'starStencil';
export type FieldCutter = 'circleCutter' | 'squareCutter' | 'triangleCutter' |
  'pentagonCutter' | 'hexagonCutter' | 'starCutter';
export type FieldDrawingTool = 'pencil' | 'eraser' | 'ruler' | 'protractor' | 'compass' | 'wire' | FieldStencil | FieldCutter;

export function isFieldShapeTool(value: string): value is FieldStencil | FieldCutter {
  return /^(circle|square|triangle|pentagon|hexagon|star)(Stencil|Cutter)$/.test(value);
}

export function buildToolGuide(tool: FieldDrawingTool, start: Vector3, end: Vector3): Vector3[] {
  const a = new Vector3(start.x, FIELD_SURFACE_Y + 0.025, start.z);
  const b = new Vector3(end.x, a.y, end.z);
  if (tool === 'pencil' || tool === 'ruler' || tool === 'wire') return [a, b];
  if (tool === 'eraser') return [];
  const delta = b.subtract(a);
  const radius = delta.length();
  if (radius < 0.05) return [];
  const angle = Math.atan2(delta.z, delta.x);
  const sides: Record<string, number | undefined> = {
    square: 4, triangle: 3, pentagon: 5, hexagon: 6, star: 10,
  };
  const shape = tool.replace(/Stencil$|Cutter$/, '');
  const vertices = sides[shape];
  if (vertices) {
    return Array.from({ length: vertices + 1 }, (_, index) => {
      const theta = angle + Math.PI * 2 * index / vertices;
      const r = shape === 'star' && index % 2 === 1 ? radius * 0.42 : radius;
      return new Vector3(a.x + Math.cos(theta) * r, a.y, a.z + Math.sin(theta) * r);
    });
  }
  const sweep = tool === 'protractor' ? Math.PI : Math.PI * 2;
  const intervals = Math.min(256, Math.max(24, Math.ceil(radius * sweep / 0.2)));
  return Array.from({ length: intervals + 1 }, (_, index) => {
    const theta = angle + sweep * index / intervals;
    return new Vector3(a.x + Math.cos(theta) * radius, a.y, a.z + Math.sin(theta) * radius);
  });
}

export function isGuideOnField(points: readonly Vector3[]): boolean {
  return points.length >= 2 && points.every(point =>
    Number.isFinite(point.x + point.y + point.z) &&
    Math.abs(point.x) <= FIELD_WIDTH_YARDS / 2 && Math.abs(point.z) <= FIELD_LENGTH_YARDS / 2);
}

function orientation(a: Vector3, b: Vector3, c: Vector3) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function pointSegmentDistance(point: Vector3, a: Vector3, b: Vector3) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = dx * dx + dz * dz;
  const t = length > 0 ? Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.z - a.z) * dz) / length)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
}

export function guideTouchesSweep(points: readonly Vector3[], from: Vector3, to: Vector3, radius: number) {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const intersects = orientation(from, to, a) * orientation(from, to, b) < 0 &&
      orientation(a, b, from) * orientation(a, b, to) < 0;
    if (intersects || Math.min(pointSegmentDistance(from, a, b), pointSegmentDistance(to, a, b),
      pointSegmentDistance(a, from, to), pointSegmentDistance(b, from, to)) <= radius) return true;
  }
  return false;
}
