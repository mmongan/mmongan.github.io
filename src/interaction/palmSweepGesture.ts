// Detects a quick sideways sweep of an open, palm-down tracked hand.

export interface PalmSweepState {
  samples: { time: number; x: number; y: number; z: number }[];
  cooldownUntil: number;
}

export const PALM_SWEEP_WINDOW_SECONDS = 0.35;
export const PALM_SWEEP_MIN_DISTANCE_METERS = 0.18;
export const PALM_SWEEP_MAX_RISE_METERS = 0.12;
export const PALM_SWEEP_COOLDOWN_SECONDS = 1;

export function createPalmSweepState(): PalmSweepState {
  return { samples: [], cooldownUntil: 0 };
}

// Feed one frame (world meters, seconds). Returns true on the frame a sweep
// completes; the hand must stay open and palm-down throughout.
export function updatePalmSweep(
  state: PalmSweepState, time: number, palmDownOpen: boolean, x: number, y: number, z: number
): boolean {
  if (!palmDownOpen || ![time, x, y, z].every(Number.isFinite)) {
    state.samples.length = 0;
    return false;
  }
  state.samples.push({ time, x, y, z });
  while (state.samples.length > 1 && time - state.samples[0].time > PALM_SWEEP_WINDOW_SECONDS) {
    state.samples.shift();
  }
  if (time < state.cooldownUntil) return false;
  const first = state.samples[0];
  const horizontal = Math.hypot(x - first.x, z - first.z);
  const rise = Math.max(...state.samples.map(sample => Math.abs(sample.y - first.y)));
  if (horizontal < PALM_SWEEP_MIN_DISTANCE_METERS || rise > PALM_SWEEP_MAX_RISE_METERS) return false;
  state.samples.length = 0;
  state.cooldownUntil = time + PALM_SWEEP_COOLDOWN_SECONDS;
  return true;
}
