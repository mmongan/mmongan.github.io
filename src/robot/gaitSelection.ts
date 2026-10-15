// Picks the marching gait a marcher should use for one count from how its body
// faces, which way it travels, and how far it moves in that count. Drill files
// (and OpenMarch) store only positions and facings, so gait is derived, the
// same way a drill writer reads it off a chart.

export type AutoGaitStyle = "Field March" | "High Step" | "Parade" | "Knee-Ankle March";

export type AutoGaitName =
  | AutoGaitStyle
  | "Mark Time"
  | "High Mark Time"
  | "Backward March"
  | "Backward High Step"
  | "Crab Walk";

export type TravelRelation = "in-place" | "forward" | "sideways" | "backward";

export interface AutoGaitSelection {
  // Gait whose leg pose/lift the marcher should animate with.
  gait: AutoGaitName;
  // Footfalls per count: 0.5 = half time, 1 = normal, 2 = double time.
  stepsPerCount: 0.5 | 1 | 2;
  // Leg/foot direction relative to the body, so crab-walk feet point along travel.
  legYawOffset: number;
  relation: TravelRelation;
  // Stride per footfall in yards, after cadence is applied.
  strideYards: number;
  label: string;
}

// Cadence must fit the fixed-length legs: at most a standard 8-to-5 stride.
export const IN_PLACE_STEP_YARDS = 0.05;
export const MAX_MARCHING_STRIDE_YARDS = 0.625;
export const HALF_TIME_BELOW_YARDS = 0.18;
export const DOUBLE_TIME_ABOVE_YARDS = MAX_MARCHING_STRIDE_YARDS;
// Travel within 50° of facing reads as forward, beyond 130° as backward,
// and anything in between as a sideways slide/crab walk.
export const FORWARD_MAX_ANGLE = (50 * Math.PI) / 180;
export const BACKWARD_MIN_ANGLE = (130 * Math.PI) / 180;

const HIGH_LIFT_STYLES: ReadonlySet<AutoGaitStyle> = new Set(["High Step", "Knee-Ankle March"]);

export function isAutoGaitStyle(name: string): name is AutoGaitStyle {
  return name === "Field March" || name === "High Step" || name === "Parade" || name === "Knee-Ankle March";
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function buildGaitStepPhaseOffsets(stepsPerCount: ReadonlyArray<number>): number[] {
  const offsets = [0];
  for (const steps of stepsPerCount) offsets.push(offsets[offsets.length - 1] + steps);
  return offsets;
}

export function gaitPhaseAtBeat(beat: number, stepsPerCount: number) {
  const phase = beat * stepsPerCount;
  const stepNumber = Math.floor(phase);
  return { stepNumber, progress: phase - stepNumber };
}

// Yaw convention matches Babylon/robot.ts: yaw = atan2(dx, dz).
export function selectAutoGait(
  facingYaw: number,
  travelX: number,
  travelZ: number,
  style: AutoGaitStyle = "Field March",
  quarterNotesPerPulse = 1,
  cadenceTravelYards?: number
): AutoGaitSelection {
  const stepYards = Math.hypot(travelX, travelZ);
  const highLift = HIGH_LIFT_STYLES.has(style);
  const pulseYards = Math.max(stepYards, cadenceTravelYards ?? stepYards) * quarterNotesPerPulse;
  const stepsPerCount = pulseYards <= HALF_TIME_BELOW_YARDS ? 0.5 : pulseYards > DOUBLE_TIME_ABOVE_YARDS ? 2 : 1;
  if (stepYards < IN_PLACE_STEP_YARDS) {
    const gait = highLift ? "High Mark Time" : "Mark Time";
    // A short move can share a footfall with a longer neighboring move.
    const markCadence = pulseYards > DOUBLE_TIME_ABOVE_YARDS ? 2 : 1;
    return { gait, stepsPerCount: markCadence, legYawOffset: 0, relation: "in-place", strideYards: 0, label: gait };
  }

  const strideYards = stepYards * quarterNotesPerPulse / stepsPerCount;
  const cadence = stepsPerCount === 0.5 ? "Half Time " : stepsPerCount === 2 ? "Double Time " : "";
  const relative = wrapAngle(Math.atan2(travelX, travelZ) - facingYaw);
  const turn = Math.abs(relative);

  if (turn <= FORWARD_MAX_ANGLE) {
    return {
      gait: style, stepsPerCount, legYawOffset: 0, relation: "forward", strideYards,
      label: `${cadence}${style}`,
    };
  }
  if (turn >= BACKWARD_MIN_ANGLE) {
    const gait = highLift ? "Backward High Step" : "Backward March";
    return {
      gait, stepsPerCount, legYawOffset: 0, relation: "backward", strideYards,
      label: `${cadence}${gait}`,
    };
  }
  return {
    gait: "Crab Walk", stepsPerCount, legYawOffset: relative, relation: "sideways", strideYards,
    label: `${cadence}Crab Walk ${relative > 0 ? "Right" : "Left"}`,
  };
}
