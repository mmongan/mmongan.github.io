import type { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';

export interface MarcherFootContact {
  beat: number;
  left: boolean;
  position: Vector3;
  yaw: number;
}

export function gaitContactBeats(
  last: number,
  phase: (segment: number, beat: number) => number,
  beatAtPhase: (segment: number, step: number) => number
): number[] {
  const beats = new Set<number>([0]);
  for (let segment = 0; segment < last; segment++) {
    const start = phase(segment, segment), end = phase(segment, segment + 1);
    if (segment > 0 && Math.abs(start - phase(segment - 1, segment)) > 1e-9) beats.add(segment);
    for (let step = Math.ceil(start - 1e-9); step < end - 1e-9; step++) {
      let beat = beatAtPhase(segment, step);
      // Inverting MIDI pulse time can round just before the new stance.
      if (phase(segment, beat) < step) beat += Number.EPSILON * Math.max(1, Math.abs(beat)) * 4;
      if (beat >= segment - 1e-9 && beat < segment + 1 && beat < last) {
        beats.add(Math.max(0, beat));
      }
    }
  }
  return [...beats].sort((a, b) => a - b);
}
