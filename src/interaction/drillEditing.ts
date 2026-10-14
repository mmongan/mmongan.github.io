export interface DrillPoint { x: number; y: number; z: number }
export interface FormationTransform {
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

export type FormationAlignment = "alignX" | "alignZ" | "distributeX" | "distributeZ";

export function snapDrillPoint(point: DrillPoint, interval: number, zInterval = interval): DrillPoint {
  if (![interval, zInterval].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError("Grid intervals must be finite and positive.");
  }
  return { x: Math.round(point.x / interval) * interval, y: point.y,
    z: Math.round(point.z / zInterval) * zInterval };
}

export function constrainDrillMovement(delta: DrillPoint, lockX: boolean, lockZ: boolean): DrillPoint {
  return { x: lockX ? 0 : delta.x, y: delta.y, z: lockZ ? 0 : delta.z };
}

export function alignFormationPoints(points: readonly DrillPoint[], action: FormationAlignment): DrillPoint[] {
  if (!points.length || points.some(point => ![point.x, point.y, point.z].every(Number.isFinite))) {
    throw new RangeError("Alignment requires finite marcher positions.");
  }
  const axis = action.endsWith("X") ? "x" : "z";
  const result = points.map(point => ({ x: point.x, y: point.y, z: point.z }));
  if (action.startsWith("align")) {
    const center = points.reduce((sum, point) => sum + point[axis], 0) / points.length;
    result.forEach(point => { point[axis] = center; });
  } else if (points.length > 2) {
    const order = points.map((point, index) => ({ value: point[axis], index }))
      .sort((a, b) => a.value - b.value || a.index - b.index);
    const start = order[0].value;
    const end = order[order.length - 1].value;
    order.forEach(({ index }, rank) => {
      result[index][axis] = start + (end - start) * rank / (points.length - 1);
    });
  }
  return result;
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
