const DRILL_ROWS = 8, DRILL_COLS = 10, FORMATION_SPACING_YARDS = 1.25, DRILL_BLOCK_START_Z = -30;
const DRILL_CIRCLE_RADIUS_YARDS = 15, DRILL_CIRCLE_CENTER_Z = 10;
const MARCH_STEP_YARDS = 0.625, COLLISION_MARKER_RADIUS_YARDS = 0.35;
const OBSTACLE_CLEARANCE_YARDS = COLLISION_MARKER_RADIUS_YARDS * 1.6;
const DYNAMIC_CLEARANCE_YARDS = COLLISION_MARKER_RADIUS_YARDS * 1.6;
const RELAX_ITERATIONS = 400;

function dist2(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }
function dist(a, b) { return Math.sqrt(dist2(a, b)); }

const starts = [];
for (let row = 0; row < DRILL_ROWS; row++)
  for (let col = 0; col < DRILL_COLS; col++) {
    const x = (col - (DRILL_COLS - 1) / 2) * FORMATION_SPACING_YARDS;
    const z = DRILL_BLOCK_START_Z + row * FORMATION_SPACING_YARDS;
    starts.push({ x, z });
  }
const count = starts.length;
const cx = 0, cz = DRILL_CIRCLE_CENTER_Z;
const targetsRaw = [];
for (let i = 0; i < count; i++) {
  const angle = (i / count) * Math.PI * 2;
  targetsRaw.push({ x: Math.cos(angle) * DRILL_CIRCLE_RADIUS_YARDS, z: cz + Math.sin(angle) * DRILL_CIRCLE_RADIUS_YARDS });
}
const order = starts.map((p, i) => ({ i, angle: Math.atan2(p.z - cz, p.x - cx) })).sort((a, b) => a.angle - b.angle);
const targets = new Array(count), ranks = new Array(count);
order.forEach((e, i) => { targets[e.i] = targetsRaw[i]; ranks[e.i] = i; });

// Common step count N for every robot: based on the longest straight-line
// distance at the standard march pace, so nobody is asked to take
// unnaturally huge steps -- everyone else just takes correspondingly
// smaller steps to also finish in exactly N steps.
const maxDist = Math.max(...starts.map((s, i) => dist(s, targets[i])));
const N = Math.max(1, Math.round(maxDist / MARCH_STEP_YARDS));
console.log("common step count N:", N);

const allObstacles = [];
for (let i = 0; i < count; i++) { allObstacles.push(starts[i]); allObstacles.push(targets[i]); }

// Initialize every robot's path as N+1 straight-line samples (index 0 =
// start, index N = target, matching indices = matching time across ALL
// robots since everyone marches for exactly N steps starting at count 0).
const paths = starts.map((start, idx) => {
  const target = targets[idx];
  const pts = [];
  for (let n = 0; n <= N; n++) pts.push({ x: start.x + (target.x - start.x) * (n / N), z: start.z + (target.z - start.z) * (n / N) });
  return pts;
});

const startTime = Date.now();
for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
  // Smoothing pass (keep each path taut/continuous).
  for (let idx = 0; idx < count; idx++) {
    const pts = paths[idx];
    for (let n = 1; n < N; n++) {
      const prev = pts[n - 1], next = pts[n + 1];
      pts[n].x += ((prev.x + next.x) / 2 - pts[n].x) * 0.5;
      pts[n].z += ((prev.z + next.z) / 2 - pts[n].z) * 0.5;
    }
  }
  // Static obstacle avoidance (other robots' starts/targets).
  for (let idx = 0; idx < count; idx++) {
    const pts = paths[idx];
    for (let n = 1; n < N; n++) {
      const p = pts[n];
      for (let o = 0; o < allObstacles.length; o++) {
        if (o === idx * 2 || o === idx * 2 + 1) continue; // skip own start/target
        const obstacle = allObstacles[o];
        const dx = p.x - obstacle.x, dz = p.z - obstacle.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < OBSTACLE_CLEARANCE_YARDS && d > 1e-6) {
          const push = (OBSTACLE_CLEARANCE_YARDS - d) * 0.5;
          p.x += (dx / d) * push;
          p.z += (dz / d) * push;
        }
      }
    }
  }
  // Dynamic avoidance: since every robot shares the same step index space
  // (no hold, same N for all), index n means the same moment in time for
  // everyone -- so two robots' points AT THE SAME INDEX are the only ones
  // that can ever collide with each other while both are moving.
  for (let n = 1; n < N; n++) {
    for (let i = 0; i < count; i++) {
      const pi = paths[i][n];
      for (let j = i + 1; j < count; j++) {
        const pj = paths[j][n];
        const dx = pi.x - pj.x, dz = pi.z - pj.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < DYNAMIC_CLEARANCE_YARDS && d > 1e-6) {
          const push = (DYNAMIC_CLEARANCE_YARDS - d) * 0.5;
          pi.x += (dx / d) * push * 0.5;
          pi.z += (dz / d) * push * 0.5;
          pj.x -= (dx / d) * push * 0.5;
          pj.z -= (dz / d) * push * 0.5;
        }
      }
    }
  }
}
console.log("elapsedMs:", Date.now() - startTime);

// Full verification.
let remaining = 0;
for (let i = 0; i < count; i++)
  for (let j = i + 1; j < count; j++) {
    let collided = false;
    for (let n = 0; n <= N; n++) {
      if (dist2(paths[i][n], paths[j][n]) < COLLISION_MARKER_RADIUS_YARDS * COLLISION_MARKER_RADIUS_YARDS) {
        collided = true;
        break;
      }
    }
    if (collided) remaining++;
  }
console.log("remaining colliding pairs:", remaining, "out of", (count * (count - 1)) / 2);
