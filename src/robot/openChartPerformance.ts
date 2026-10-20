import { OPEN_CHART_SAMPLE, OPEN_CHART_SAMPLE_SIZE, type OpenChartPerformance } from "./openChartFormat";
import type { MarcherScheduleSnapshot, ResolvedCountGait } from "./robot";

export function packOpenChartPerformance(
  schedule: MarcherScheduleSnapshot, gaitNames: readonly string[]
): OpenChartPerformance {
  const movementDescriptions: string[] = [];
  const movementDescriptionIndex = (description: string) => {
    let index = movementDescriptions.indexOf(description);
    if (index < 0) { index = movementDescriptions.length; movementDescriptions.push(description); }
    return index;
  };
  const samples = new Float64Array(schedule.counts.length * OPEN_CHART_SAMPLE_SIZE);
  const f = OPEN_CHART_SAMPLE;
  schedule.counts.forEach((count, index) => {
    if (count.bakedGait === undefined || count.stepPhase === undefined) {
      throw new Error("OpenChart export requires a baked gait and step phase at every count.");
    }
    const gait = count.bakedGait;
    const offset = index * OPEN_CHART_SAMPLE_SIZE;
    samples[offset + f.height] = count.position.y;
    samples[offset + f.heading] = count.rotationY;
    const facing = count.facingY ?? schedule.fixedFacingY ?? gait?.bodyYaw ?? count.rotationY;
    samples[offset + f.facing] = facing;
    samples[offset + f.style] = count.styleIndex ?? schedule.gaitIndex;
    samples[offset + f.gait] = gait?.gaitIndex ?? -1;
    samples[offset + f.steps] = gait?.stepsPerCount ?? 1;
    samples[offset + f.bodyYaw] = gait?.bodyYaw ?? facing;
    samples[offset + f.legYaw] = gait?.legYawOffset ?? 0;
    samples[offset + f.flags] = (gait?.inPlace ? 1 : 0) | (gait?.sideways ? 2 : 0) |
      (count.styleIndex === undefined ? 0 : 4) | (count.facingY === undefined ? 0 : 8);
    samples[offset + f.movementDescription] = movementDescriptionIndex(gait?.label ?? "Halt");
    samples[offset + f.phase] = count.stepPhase;
  });
  const gait = gaitNames[schedule.gaitIndex];
  if (gait === undefined) throw new Error("Unknown marcher gait while exporting OpenChart.");
  return {
    gait, instrumentPose: schedule.instrumentRestPose ? "carry" : "playing",
    color: [schedule.color.r, schedule.color.g, schedule.color.b],
    stepSizeYards: schedule.stepSizeYards,
    ...(schedule.fixedFacingY === undefined ? {} : { fixedFacingY: schedule.fixedFacingY }),
    gaits: [...gaitNames], movementDescriptions, samples,
  };
}

export function unpackOpenChartPerformance(performance: OpenChartPerformance, gaitNames: readonly string[]) {
  const indexOf = (name: string) => {
    const index = gaitNames.indexOf(name);
    if (index < 0) throw new Error(`Unknown OpenChart gait: ${name}.`);
    return index;
  };
  const gaitIndex = indexOf(performance.gait);
  const usedGaits = new Set<number>();
  const f = OPEN_CHART_SAMPLE;
  for (let offset = 0; offset < performance.samples.length; offset += OPEN_CHART_SAMPLE_SIZE) {
    usedGaits.add(performance.samples[offset + f.style]);
    const resolved = performance.samples[offset + f.gait];
    if (resolved >= 0) usedGaits.add(resolved);
  }
  const indices = new Map([...usedGaits].map(index => [index, indexOf(performance.gaits[index])]));
  const readIndex = (index: number) => {
    const value = indices.get(index);
    if (value === undefined) throw new Error("Missing OpenChart gait mapping.");
    return value;
  };
  const counts = Array.from({ length: performance.samples.length / OPEN_CHART_SAMPLE_SIZE }, (_, index) => {
    const offset = index * OPEN_CHART_SAMPLE_SIZE;
    const at = (field: number) => performance.samples[offset + field];
    const resolved = at(f.gait);
    const bakedGait: ResolvedCountGait | null = resolved < 0 ? null : {
      gaitIndex: readIndex(resolved), stepsPerCount: at(f.steps),
      bodyYaw: at(f.bodyYaw), legYawOffset: at(f.legYaw),
      inPlace: (at(f.flags) & 1) !== 0, sideways: (at(f.flags) & 2) !== 0,
      label: performance.movementDescriptions[at(f.movementDescription)],
    };
    return {
      height: at(f.height), rotationY: at(f.heading),
      stepPhase: at(f.phase),
      ...((at(f.flags) & 8) ? { facingY: at(f.facing) } : {}),
      ...((at(f.flags) & 4) ? { styleIndex: readIndex(at(f.style)) } : {}),
      bakedGait,
    };
  });
  return { gaitIndex, counts };
}
