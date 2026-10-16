import { FIELD_LENGTH_YARDS, FIELD_SURFACE_Y, FIELD_WIDTH_YARDS } from '../field/constants';

export interface FieldProjectionPose {
  x: number;
  z: number;
  width: number;
  rotation: number;
}

export function buildFieldProjectionGeometry(pose: FieldProjectionPose, aspect: number) {
  if (![pose.x, pose.z, pose.width, pose.rotation, aspect].every(Number.isFinite) || pose.width <= 0 || aspect <= 0) {
    throw new Error('Projection requires a finite position/rotation and a positive image size.');
  }
  const angle = pose.rotation * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
  let polygon = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const x = (u - 0.5) * pose.width, z = (0.5 - v) * pose.width / aspect;
    return { x: pose.x + x * cos + z * sin, z: pose.z - x * sin + z * cos, u, v: 1 - v };
  });
  for (const [axis, limit, sign] of [
    ['x', -FIELD_WIDTH_YARDS / 2, 1], ['x', FIELD_WIDTH_YARDS / 2, -1],
    ['z', -FIELD_LENGTH_YARDS / 2, 1], ['z', FIELD_LENGTH_YARDS / 2, -1],
  ] as const) {
    const clipped: typeof polygon = [];
    polygon.forEach((point, index) => {
      const previous = polygon[(index + polygon.length - 1) % polygon.length];
      const inside = (point[axis] - limit) * sign >= 0;
      const wasInside = (previous[axis] - limit) * sign >= 0;
      if (inside !== wasInside) {
        const t = (limit - previous[axis]) / (point[axis] - previous[axis]);
        clipped.push({
          x: previous.x + t * (point.x - previous.x), z: previous.z + t * (point.z - previous.z),
          u: previous.u + t * (point.u - previous.u), v: previous.v + t * (point.v - previous.v),
        });
      }
      if (inside) clipped.push(point);
    });
    polygon = clipped;
  }
  const positions: number[] = [], uvs: number[] = [], normals: number[] = [], indices: number[] = [];
  polygon.forEach(point => {
    positions.push(point.x, FIELD_SURFACE_Y + 0.012, point.z);
    uvs.push(point.u, point.v); normals.push(0, 1, 0);
  });
  for (let index = 1; index < polygon.length - 1; index++) indices.push(0, index, index + 1);
  return { positions, uvs, normals, indices };
}
