import * as BABYLON from 'babylonjs';
import { COLLISION_MARKER_RADIUS_YARDS } from './collisionMarkers';
import { FIELD_SURFACE_Y } from '../field/constants';

export const MARCH_STEP_YARDS = 0.625;
export const FORMATION_SPACING_YARDS = 1.25;

const DRILL_ROWS = 8;
const DRILL_COLS = 10;
const DRILL_BLOCK_START_Z = -30;
const DRILL_CIRCLE_RADIUS_YARDS = 15;
const DRILL_CIRCLE_CENTER_Z = 10;
const DRILL_PATH_OBSTACLE_CLEARANCE_YARDS = COLLISION_MARKER_RADIUS_YARDS * 1.6;
const DRILL_PATH_DYNAMIC_CLEARANCE_YARDS = COLLISION_MARKER_RADIUS_YARDS * 1.6;
const DRILL_PATH_RELAX_ITERATIONS = 400;
const DRILL_PATH_OBSTACLE_MARGIN_YARDS = 6;

function generateBlockPoints(): BABYLON.Vector3[] {
  const points: BABYLON.Vector3[] = [];
  for (let row = 0; row < DRILL_ROWS; row++) {
    for (let col = 0; col < DRILL_COLS; col++) {
      const x = (col - (DRILL_COLS - 1) / 2) * FORMATION_SPACING_YARDS;
      const z = DRILL_BLOCK_START_Z + row * FORMATION_SPACING_YARDS;
      points.push(new BABYLON.Vector3(x, FIELD_SURFACE_Y, z));
    }
  }
  return points;
}

function generateCirclePoints(count: number): BABYLON.Vector3[] {
  const points: BABYLON.Vector3[] = [];
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2;
    const x = Math.cos(angle) * DRILL_CIRCLE_RADIUS_YARDS;
    const z = DRILL_CIRCLE_CENTER_Z + Math.sin(angle) * DRILL_CIRCLE_RADIUS_YARDS;
    points.push(new BABYLON.Vector3(x, FIELD_SURFACE_Y, z));
  }
  return points;
}

// Keep the same atan2(dz, dx) convention as circle point generation so
// angular pairing remains ordered and paths do not cross through the block.
function assignTargets(startPoints: BABYLON.Vector3[], targetPoints: BABYLON.Vector3[]): BABYLON.Vector3[] {
  const circleCenter = new BABYLON.Vector3(0, FIELD_SURFACE_Y, DRILL_CIRCLE_CENTER_Z);
  const startOrder = startPoints
    .map((point, index) => ({ index, angle: Math.atan2(point.z - circleCenter.z, point.x - circleCenter.x) }))
    .sort((a, b) => a.angle - b.angle);

  const targets: BABYLON.Vector3[] = new Array(startPoints.length);
  startOrder.forEach((entry, index) => {
    targets[entry.index] = targetPoints[index];
  });
  return targets;
}

// All routes share one count budget, so avoidance is resolved at matching
// indices rather than by changing individual robots' departure times.
function buildSynchronizedPaths(startPoints: BABYLON.Vector3[], targetPoints: BABYLON.Vector3[]): BABYLON.Vector3[][] {
  const count = startPoints.length;
  const maxDistance = startPoints.reduce(
    (max, start, index) => Math.max(max, BABYLON.Vector3.Distance(start, targetPoints[index])),
    0
  );
  const stepCount = Math.max(1, Math.round(maxDistance / MARCH_STEP_YARDS));
  const paths = startPoints.map((start, index) => {
    const points: BABYLON.Vector3[] = [];
    for (let step = 0; step <= stepCount; step++) {
      points.push(BABYLON.Vector3.Lerp(start, targetPoints[index], step / stepCount));
    }
    return points;
  });

  const staticObstacles = [...startPoints, ...targetPoints];
  const minX = Math.min(...startPoints.map((point) => point.x), ...targetPoints.map((point) => point.x)) -
    DRILL_PATH_OBSTACLE_MARGIN_YARDS;
  const maxX = Math.max(...startPoints.map((point) => point.x), ...targetPoints.map((point) => point.x)) +
    DRILL_PATH_OBSTACLE_MARGIN_YARDS;

  for (let iteration = 0; iteration < DRILL_PATH_RELAX_ITERATIONS; iteration++) {
    for (let index = 0; index < count; index++) {
      const points = paths[index];
      for (let step = 1; step < stepCount; step++) {
        const previous = points[step - 1];
        const next = points[step + 1];
        const point = points[step];
        point.x += ((previous.x + next.x) / 2 - point.x) * 0.5;
        point.z += ((previous.z + next.z) / 2 - point.z) * 0.5;
      }
    }

    for (let index = 0; index < count; index++) {
      const points = paths[index];
      for (let step = 1; step < stepCount; step++) {
        const point = points[step];
        if (point.x < minX || point.x > maxX) continue;
        for (let obstacleIndex = 0; obstacleIndex < staticObstacles.length; obstacleIndex++) {
          if (obstacleIndex === index || obstacleIndex === count + index) continue;
          const obstacle = staticObstacles[obstacleIndex];
          const dx = point.x - obstacle.x;
          const dz = point.z - obstacle.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance < DRILL_PATH_OBSTACLE_CLEARANCE_YARDS && distance > 1e-6) {
            const push = (DRILL_PATH_OBSTACLE_CLEARANCE_YARDS - distance) * 0.5;
            point.x += (dx / distance) * push;
            point.z += (dz / distance) * push;
          }
        }
      }
    }

    for (let step = 1; step < stepCount; step++) {
      for (let first = 0; first < count; first++) {
        const firstPoint = paths[first][step];
        for (let second = first + 1; second < count; second++) {
          const secondPoint = paths[second][step];
          const dx = firstPoint.x - secondPoint.x;
          const dz = firstPoint.z - secondPoint.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance < DRILL_PATH_DYNAMIC_CLEARANCE_YARDS && distance > 1e-6) {
            const push = ((DRILL_PATH_DYNAMIC_CLEARANCE_YARDS - distance) * 0.5) / 2;
            firstPoint.x += (dx / distance) * push;
            firstPoint.z += (dz / distance) * push;
            secondPoint.x -= (dx / distance) * push;
            secondPoint.z -= (dz / distance) * push;
          }
        }
      }
    }
  }

  return paths;
}

export function generateMarchingDrillPaths(): BABYLON.Vector3[][] {
  const startPoints = generateBlockPoints();
  const targets = assignTargets(startPoints, generateCirclePoints(startPoints.length));
  return buildSynchronizedPaths(startPoints, targets);
}