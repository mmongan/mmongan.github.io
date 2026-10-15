import type { DrillPoint } from './drillEditing';

export type ShapeSegmentKind = "line" | "curve" | "doubleCurve" | "move" | "close";
export interface DrillShapeSegment {
  kind: ShapeSegmentKind;
  end: DrillPoint;
  control: DrillPoint;
  control2: DrillPoint;
}
export interface DrillShape {
  start: DrillPoint;
  segments: DrillShapeSegment[];
}
export interface ScreenPoint { x: number; y: number }

export function selectionWasDragged(start: ScreenPoint, end: ScreenPoint, path: readonly ScreenPoint[]): boolean {
  return [end, ...path].some(p => Math.hypot(p.x - start.x, p.y - start.y) >= 5);
}

export function insideSelection(point: ScreenPoint, polygon: readonly ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-7 && point.x >= Math.min(a.x, b.x) &&
      point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const copy = (point: DrillPoint): DrillPoint => ({ x: point.x, y: point.y, z: point.z });
const mix = (a: DrillPoint, b: DrillPoint, t: number): DrillPoint => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
});
const distance = (a: DrillPoint, b: DrillPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function shapeStrokes(shape: DrillShape): DrillPoint[][] {
  const all = [shape.start, ...shape.segments.flatMap(segment => [segment.end, segment.control, segment.control2])];
  if (all.some(point => ![point.x, point.y, point.z].every(Number.isFinite))) {
    throw new RangeError("Shape coordinates must be finite.");
  }
  const strokes: DrillPoint[][] = [];
  let current = copy(shape.start);
  let stroke = [current];
  for (const segment of shape.segments) {
    const end = segment.kind === "close" ? shape.start : segment.end;
    if (segment.kind === "move") {
      if (stroke.length > 1) strokes.push(stroke);
      current = copy(end);
      stroke = [current];
      continue;
    }
    if (segment.kind === "curve" || segment.kind === "doubleCurve") {
      for (let i = 1; i <= 64; i++) {
        const t = i / 64;
        const first = mix(current, segment.control, t);
        if (segment.kind === "curve") {
          stroke.push(mix(first, mix(segment.control, end, t), t));
        } else {
          const second = mix(segment.control, segment.control2, t);
          const third = mix(segment.control2, end, t);
          stroke.push(mix(mix(first, second, t), mix(second, third, t), t));
        }
      }
    } else {
      stroke.push(copy(end));
    }
    current = copy(end);
  }
  if (stroke.length > 1) strokes.push(stroke);
  return strokes;
}

export function sampleDrillShape(shape: DrillShape, count: number): DrillPoint[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("Select at least one marcher.");
  const strokes = shapeStrokes(shape);
  const edges = strokes.flatMap(stroke => stroke.slice(1).map((end, index) => ({
    start: stroke[index], end, length: distance(stroke[index], end),
  }))).filter(edge => edge.length > 1e-9);
  const total = edges.reduce((sum, edge) => sum + edge.length, 0);
  if (!edges.length) throw new RangeError("Add a nonzero line or curve before applying the shape.");
  const closed = shape.segments[shape.segments.length - 1]?.kind === "close";
  return Array.from({ length: count }, (_, index) => {
    let remaining = count === 1 ? total / 2 : total * index / (closed ? count : count - 1);
    for (const edge of edges) {
      if (remaining <= edge.length) return mix(edge.start, edge.end, remaining / edge.length);
      remaining -= edge.length;
    }
    return copy(edges[edges.length - 1].end);
  });
}
