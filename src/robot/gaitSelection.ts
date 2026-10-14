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

// 8-to-5 is 0.625 yd per count. Below half that, two counts per step keeps the
// stride near standard (16-to-5 becomes a half-time 8-to-5); above ~5-to-5 the
// marcher must double time to stay marchable (4-to-5 becomes a double-time 8-to-5).
export const IN_PLACE_STEP_YARDS = 0.05;
export const HALF_TIME_BELOW_YARDS = 0.36;
export const DOUBLE_TIME_ABOVE_YARDS = 1.05;
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

// Yaw convention matches Babylon/robot.ts: yaw = atan2(dx, dz).
export function selectAutoGait(
  facingYaw: number,
  travelX: number,
  travelZ: number,
  style: AutoGaitStyle = "Field March"
): AutoGaitSelection {
  const stepYards = Math.hypot(travelX, travelZ);
  const highLift = HIGH_LIFT_STYLES.has(style);
  if (stepYards < IN_PLACE_STEP_YARDS) {
    const gait = highLift ? "High Mark Time" : "Mark Time";
    return { gait, stepsPerCount: 1, legYawOffset: 0, relation: "in-place", strideYards: 0, label: gait };
  }

  const stepsPerCount = stepYards < HALF_TIME_BELOW_YARDS ? 0.5 : stepYards > DOUBLE_TIME_ABOVE_YARDS ? 2 : 1;
  const strideYards = stepYards / stepsPerCount;
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
