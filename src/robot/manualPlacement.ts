import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { Observable } from '@babylonjs/core/Misc/observable.pure';

const marchers = new Map<TransformNode, () => AbstractMesh[]>();
export const onManualPlacementBlocked = new Observable<void>();

export function registerManualPlacementMarcher(robot: TransformNode, meshes: () => AbstractMesh[]) {
  marchers.set(robot, meshes);
  robot.onDisposeObservable.addOnce(() => marchers.delete(robot));
}

export interface ManualMarcherPose {
  robot: TransformNode;
  position: Vector3;
  rotationY?: number;
}

function bounds(robot: TransformNode) {
  robot.computeWorldMatrix(true);
  const meshes = marchers.get(robot)?.() ?? [];
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  meshes.forEach((mesh) => {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(box.minimumWorld);
    max.maximizeInPlace(box.maximumWorld);
  });
  const boxes = meshes.map((mesh) => {
    const box = mesh.getBoundingInfo().boundingBox;
    const axes = box.directions.map((axis) => axis.clone().normalize());
    const center = box.centerWorld.clone();
    const extents = axes.map((axis) => Math.max(...box.vectorsWorld.map((point) =>
      Math.abs(Vector3.Dot(point.subtract(center), axis)))));
    return { center, axes, extents };
  });
  const origin = robot.getAbsolutePosition();
  const radius = Math.hypot(
    Math.max(Math.abs(min.x - origin.x), Math.abs(max.x - origin.x)),
    Math.max(Math.abs(min.y - origin.y), Math.abs(max.y - origin.y)),
    Math.max(Math.abs(min.z - origin.z), Math.abs(max.z - origin.z))
  );
  return { robot, boxes, min, max, radius };
}

type Bounds = ReturnType<typeof bounds>;

// Continuous separating-axis test: a thin instrument cannot tunnel through
// another part even when a pointer/controller jumps across it in one frame.
function intersects(a: Bounds, b: Bounds, endA = a, endB = b, paddingA = 0, paddingB = 0) {
  const padding = paddingA + paddingB;
  for (const axis of ['x', 'y', 'z'] as const) {
    if (Math.min(a.min[axis], endA.min[axis]) - padding >= Math.max(b.max[axis], endB.max[axis]) ||
      Math.max(a.max[axis], endA.max[axis]) + padding <= Math.min(b.min[axis], endB.min[axis])) return false;
  }
  return a.boxes.some((first, i) => b.boxes.some((second, j) => {
    const offset = second.center.subtract(first.center);
    const velocity = endB.boxes[j].center.subtract(second.center)
      .subtract(endA.boxes[i].center.subtract(first.center));
    const axes = [...first.axes, ...second.axes,
      ...first.axes.flatMap((one) => second.axes.map((two) => Vector3.Cross(one, two)))];
    let entry = 0, exit = 1;
    for (const rawAxis of axes) {
      if (rawAxis.lengthSquared() < 1e-12) continue;
      const axis = rawAxis.normalizeToNew();
      const radius = padding + first.axes.reduce((sum, direction, n) =>
        sum + first.extents[n] * Math.abs(Vector3.Dot(direction, axis)), 0) +
        second.axes.reduce((sum, direction, n) =>
          sum + second.extents[n] * Math.abs(Vector3.Dot(direction, axis)), 0);
      const distance = Vector3.Dot(offset, axis);
      const speed = Vector3.Dot(velocity, axis);
      if (Math.abs(speed) < 1e-12) {
        if (Math.abs(distance) >= radius) return false;
      } else {
        const t1 = (-radius - distance) / speed;
        const t2 = (radius - distance) / speed;
        entry = Math.max(entry, Math.min(t1, t2));
        exit = Math.min(exit, Math.max(t1, t2));
        if (entry > exit) return false;
      }
    }
    return exit > 1e-9 && entry < 1 - 1e-9;
  }));
}

// Authored playback never calls this. Only explicit editing gestures use it.
export function tryManualMarcherPoses(
  poses: readonly ManualMarcherPose[],
  sweep = true,
  ignored: ReadonlySet<TransformNode> = new Set(),
  validateOnly = false
): boolean {
  poses = poses.map((pose) => ({ ...pose, position: pose.position.clone() }));
  const moving = new Set(poses.map(({ robot }) => robot));
  const previous = poses.map(({ robot }) => ({
    robot, position: robot.position.clone(), rotationY: robot.rotation.y,
  }));
  const obstacles = [...marchers.keys()]
    .filter((robot) => robot.isEnabled() && !moving.has(robot) && !ignored.has(robot))
    .map(bounds);
  const pairs = (current: Bounds[], start = current, padding = poses.map(() => 0)) => {
    const collisions = new Set<string>();
    current.forEach((first, i) => {
      obstacles.forEach((second, j) => {
        if (intersects(start[i], second, first, second, padding[i])) collisions.add(`${i}:o${j}`);
      });
      for (let j = i + 1; j < current.length; j++) {
        if (intersects(start[i], start[j], first, current[j], padding[i], padding[j])) collisions.add(`${i}:m${j}`);
      }
    });
    return collisions;
  };
  // An imported drill may already overlap. Allow leaving that contact, but
  // never entering a new one or passing back through a contact already left.
  let startBounds = poses.map(({ robot }) => bounds(robot));
  const leaving = sweep ? pairs(startBounds) : new Set<string>();
  let steps = 1;
  const angles = poses.map((pose, i) => {
    const angle = (pose.rotationY ?? previous[i].rotationY) - previous[i].rotationY;
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  });
  if (sweep) poses.forEach((pose, i) => {
    steps = Math.max(steps, Math.ceil(Math.abs(angles[i]) / (Math.PI / 180)));
  });
  let accepted = false;
  try {
    for (let step = 1; step <= steps; step++) {
      poses.forEach((pose, i) => {
        Vector3.LerpToRef(previous[i].position, pose.position, step / steps, pose.robot.position);
        pose.robot.rotation.y = previous[i].rotationY + angles[i] * step / steps;
      });
      const current = poses.map(({ robot }) => bounds(robot));
      // Inflation covers the curved motion of every part during a yaw step.
      const padding = angles.map((angle, i) => sweep ? startBounds[i].radius * Math.abs(angle) / steps : 0);
      const collisions = sweep ? pairs(current, startBounds, padding) : pairs(current);
      const endpoint = pairs(current);
      if ([...collisions].some((pair) => !leaving.has(pair)) ||
        (step === steps && endpoint.size > 0)) {
        if (!validateOnly) onManualPlacementBlocked.notifyObservers();
        return false;
      }
      for (const pair of leaving) if (!endpoint.has(pair)) leaving.delete(pair);
      startBounds = current;
    }
    accepted = true;
    return true;
  } finally {
    if (!accepted || validateOnly) previous.forEach(({ robot, position, rotationY }) => {
      robot.position.copyFrom(position);
      robot.rotation.y = rotationY;
      robot.computeWorldMatrix(true);
    });
  }
}

export function tryManualMarcherPose(robot: TransformNode, position: Vector3, rotationY = robot.rotation.y, sweep = true) {
  return tryManualMarcherPoses([{ robot, position, rotationY }], sweep);
}

export function canPlaceManualMarcherPose(robot: TransformNode, position: Vector3, rotationY = robot.rotation.y, sweep = true) {
  return tryManualMarcherPoses([{ robot, position, rotationY }], sweep, new Set(), true);
}
