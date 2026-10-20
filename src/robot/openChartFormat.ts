export const OPEN_CHART_EXTENSION = ".openchart";
const SIGNATURE = "OCHART13";
// Wire codes are permanent and independent of runtime library ordering.
export const OPEN_CHART_INSTRUMENT_CODES = Object.freeze([
  "trumpet", "mellophone", "altoSax", "bariSax", "trombone", "euphonium",
  "clarinet", "flute", "sousaphone", "snare", "tenors", "bassDrum",
  "glockenspiel", "cymbals", "guardFlag", "guardRifle", "guardSabre",
]);
export const OPEN_CHART_GAIT_CODES = Object.freeze([
  "Field March", "High Step", "Parade", "Crab Walk", "Knee-Ankle March", "Slide",
  "Mark Time", "High Mark Time", "Double Time", "Half Time", "Backward March", "Backward High Step",
]);
export const OPEN_CHART_POSE_CODES = Object.freeze(["playing", "carry"]);
export const OPEN_CHART_MOVEMENT_DESCRIPTION_CODES = Object.freeze([...OPEN_CHART_GAIT_CODES, "Halt"]);

function encodeBuiltin(value: string, codes: readonly string[]): number | string {
  const code = codes.indexOf(value);
  return code < 0 ? value : code;
}

function decodeBuiltin(value: unknown, codes: readonly string[], name: string): string {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= codes.length) {
    invalid(`unknown ${name} code`);
  }
  return codes[value];
}
export const OPEN_CHART_DEFAULT_PPQ = 480;
export const OPEN_CHART_SAMPLE = {
  height: 0, heading: 1, facing: 2, style: 3, gait: 4,
  steps: 5, bodyYaw: 6, legYaw: 7, flags: 8, movementDescription: 9, phase: 10,
} as const;
export const OPEN_CHART_SAMPLE_SIZE = 11;
const HEADER_BYTES = 16;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_MARCHERS = 1000;
const MAX_COUNTS = 20001;
const MAX_SAMPLES = 2_000_000;

export interface OpenChartPage {
  name: string;
  count: number;
  notes: string;
}

export interface OpenChartMarcher {
  label: string;
  name: string;
  section: string;
  notes: string;
  instrument?: string;
  // Interleaved field-local X/Z coordinates in yards, one pair per count.
  positions: Float64Array;
  performance?: OpenChartPerformance;
}

export interface OpenChartPerformance {
  gait: string;
  instrumentPose: "playing" | "carry";
  color: [number, number, number];
  stepSizeYards: number;
  fixedFacingY?: number;
  gaits: string[];
  movementDescriptions: string[];
  // Per count: height, heading, facing, style/gait palette indices,
  // steps per count, body/leg yaw, flags (in-place=1, sideways=2,
  // authored style=4, authored facing=8), movement-description index, cumulative step position.
  // A gait index of -1 is an explicit halt with no resolved gait.
  // Count timing is shared by all marchers through show.timing.countTicks.
  samples: Float64Array;
}

export interface OpenChartShow {
  name: string;
  tempoBpm: number;
  widthYards: number;
  pages: OpenChartPage[];
  marchers: OpenChartMarcher[];
  timing?: OpenChartTiming;
}

export interface OpenChartTiming {
  ppq: number;
  tempos: { tick: number; bpm: number }[];
  countTicks: number[];
}

export function getOpenChartTiming(show: OpenChartShow): OpenChartTiming {
  return show.timing ?? {
    ppq: OPEN_CHART_DEFAULT_PPQ, tempos: [{ tick: 0, bpm: show.tempoBpm }],
    countTicks: Array.from({ length: getOpenChartLastCount(show) + 1 }, (_, count) => count * OPEN_CHART_DEFAULT_PPQ),
  };
}

function timingMetadata(value: unknown): OpenChartTiming {
  const data = record(value, "MIDI timing");
  const ppq = data.ppq;
  if (typeof ppq !== "number" || !Number.isInteger(ppq) || ppq < 1 || ppq > 32767) invalid("invalid MIDI PPQ");
  if (!Array.isArray(data.tempos) || !data.tempos.length || data.tempos.length > MAX_COUNTS) invalid("invalid tempo map");
  let previous = -1;
  const tempos = data.tempos.map(value => {
    const event = record(value, "tempo event");
    const tick = event.tick;
    if (typeof tick !== "number" || !Number.isSafeInteger(tick) || tick < 0 || tick <= previous) {
      invalid("tempo ticks must be increasing nonnegative integers");
    }
    if (previous < 0 && tick !== 0) invalid("tempo map must start at tick zero");
    previous = tick;
    return { tick, bpm: positive(event.bpm, "MIDI tempo") };
  });
  if (!Array.isArray(data.countTicks) || !data.countTicks.length || data.countTicks.length > MAX_COUNTS) invalid("invalid count ticks");
  previous = -1;
  const countTicks = data.countTicks.map(value => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value <= previous) {
      invalid("count ticks must be increasing nonnegative integers");
    }
    previous = value;
    return value;
  });
  if (countTicks[0] !== 0) invalid("count ticks must start at zero");
  return { ppq, tempos, countTicks };
}

interface SourceDrill {
  tempoBpm: number;
  pages: OpenChartPage[];
  marchers: Pick<OpenChartMarcher, "label" | "name" | "section" | "notes" | "instrument">[];
  tracks: { x: number; z: number }[][];
}

function invalid(message: string): never {
  throw new Error(`Invalid OpenChart show: ${message}.`);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string") invalid(`${name} must be text`);
  return value;
}

function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) invalid(`${name} must be positive and finite`);
  return value;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${name} must be finite`);
  return value;
}

function performanceMetadata(value: unknown): Omit<OpenChartPerformance, "samples"> {
  const data = record(value, "performance");
  const instrumentPose = data.instrumentPose;
  if (instrumentPose !== "playing" && instrumentPose !== "carry") invalid("unknown instrument pose");
  if (!Array.isArray(data.color) || data.color.length !== 3 ||
    data.color.some(component => typeof component !== "number" || !Number.isFinite(component) || component < 0 || component > 1)) {
    invalid("uniform color must have three components between zero and one");
  }
  const color: [number, number, number] = [data.color[0], data.color[1], data.color[2]];
  const palette = (value: unknown, name: string) => {
    if (!Array.isArray(value) || !value.length || value.length > MAX_COUNTS) invalid(`invalid ${name} palette`);
    return value.map(entry => text(entry, name));
  };
  const gaits = palette(data.gaits, "gait");
  const gait = text(data.gait, "default gait");
  if (!gaits.includes(gait)) invalid("default gait is absent from the palette");
  return {
    gait, instrumentPose, color,
    stepSizeYards: positive(data.stepSizeYards, "step size"),
    ...(data.fixedFacingY === undefined ? {} : { fixedFacingY: finite(data.fixedFacingY, "fixed facing") }),
    gaits, movementDescriptions: palette(data.movementDescriptions, "movement description"),
  };
}

function countLength(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_COUNTS) {
    invalid(`track length must be between 1 and ${MAX_COUNTS}`);
  }
  return value;
}

function encodedValueMetadata(show: OpenChartShow) {
  const data = {
    name: show.name, tempoBpm: show.tempoBpm, widthYards: show.widthYards,
    timing: getOpenChartTiming(show),
    pages: show.pages.map(page => ({ ...page })),
    marchers: show.marchers.map(({ positions, performance, ...marcher }) => ({
      label: marcher.label, name: marcher.name,
      section: marcher.section, notes: marcher.notes,
      ...(marcher.instrument === undefined ? {} : { instrument: encodeBuiltin(marcher.instrument, OPEN_CHART_INSTRUMENT_CODES) }),
      counts: positions.length / 2,
      ...(performance ? { performance: {
        gait: encodeBuiltin(performance.gait, OPEN_CHART_GAIT_CODES),
        instrumentPose: encodeBuiltin(performance.instrumentPose, OPEN_CHART_POSE_CODES),
        color: performance.color, stepSizeYards: performance.stepSizeYards,
        ...(performance.fixedFacingY === undefined ? {} : { fixedFacingY: performance.fixedFacingY }),
        gaits: performance.gaits.map(value => encodeBuiltin(value, OPEN_CHART_GAIT_CODES)),
        movementDescriptions: performance.movementDescriptions.map(value => encodeBuiltin(value, OPEN_CHART_MOVEMENT_DESCRIPTION_CODES)),
      } } : {}),
    })),
  };
  return data;
}

function expandValueMetadata(value: unknown): unknown {
  const data = record(value, "metadata");
  const palette = (value: unknown, codes: readonly string[], name: string) => {
    if (!Array.isArray(value)) invalid("invalid name palette");
    return value.map(value => decodeBuiltin(value, codes, name));
  };
  if (!Array.isArray(data.pages) || !Array.isArray(data.marchers)) invalid("missing pages or marchers");
  return {
    ...data,
    marchers: data.marchers.map(value => {
      const marcher = record(value, "marcher");
      const performance = marcher.performance === undefined ? undefined : record(marcher.performance, "performance");
      return {
        ...marcher,
        ...(marcher.instrument === undefined ? {} : {
          instrument: decodeBuiltin(marcher.instrument, OPEN_CHART_INSTRUMENT_CODES, "instrument"),
        }),
        ...(performance ? { performance: {
          ...performance,
          gait: decodeBuiltin(performance.gait, OPEN_CHART_GAIT_CODES, "gait"),
          instrumentPose: decodeBuiltin(performance.instrumentPose, OPEN_CHART_POSE_CODES, "pose"),
          gaits: palette(performance.gaits, OPEN_CHART_GAIT_CODES, "gait"),
          movementDescriptions: palette(performance.movementDescriptions, OPEN_CHART_MOVEMENT_DESCRIPTION_CODES, "movement description"),
        } } : {}),
      };
    }),
  };
}

function metadata(value: unknown) {
  const data = record(value, "metadata");
  const name = text(data.name, "name");
  const tempoBpm = positive(data.tempoBpm, "tempo");
  const widthYards = positive(data.widthYards, "field width");
  const timing = timingMetadata(data.timing);
  if (!Array.isArray(data.marchers) || !data.marchers.length || data.marchers.length > MAX_MARCHERS) {
    invalid(`expected 1 to ${MAX_MARCHERS} marchers`);
  }
  let samples = 0;
  let lastCount = 0;
  const marchers = data.marchers.map((value, index) => {
    const item = record(value, `marcher ${index}`);
    const counts = countLength(item.counts);
    samples += counts;
    lastCount = Math.max(lastCount, counts - 1);
    return {
      label: text(item.label, "marcher label"),
      name: text(item.name, "marcher name"),
      section: text(item.section, "marcher section"),
      notes: text(item.notes, "marcher notes"),
      ...(item.instrument === undefined ? {} : { instrument: text(item.instrument, "instrument") }),
      ...(item.performance === undefined ? {} : { performance: performanceMetadata(item.performance) }),
      counts,
    };
  });
  if (samples > MAX_SAMPLES) invalid(`more than ${MAX_SAMPLES} count positions`);
  if (timing.countTicks.length !== lastCount + 1) invalid("count ticks must cover the complete show");
  if (!Array.isArray(data.pages) || !data.pages.length || data.pages.length > MAX_COUNTS) invalid("invalid page list");
  let previous = -1;
  const pages = data.pages.map(value => {
    const page = record(value, "page");
    const count = page.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count <= previous || count > lastCount) {
      invalid("page counts must be increasing whole counts within the show");
    }
    previous = count;
    return { name: text(page.name, "page name"), count, notes: text(page.notes, "page notes") };
  });
  return { name, tempoBpm, widthYards, timing, pages, marchers, samples };
}

export function getOpenChartLastCount(show: OpenChartShow): number {
  return Math.max(0, ...show.marchers.map(marcher => marcher.positions.length / 2 - 1));
}

export function convertToOpenChart(drill: SourceDrill, name: string, widthYards: number): OpenChartShow {
  if (drill.tracks.length !== drill.marchers.length) invalid("track and marcher counts differ");
  const show = {
    name, tempoBpm: drill.tempoBpm, widthYards,
    pages: drill.pages.map(page => ({ ...page })),
    marchers: drill.marchers.map((marcher, index) => {
      const track = drill.tracks[index];
      const positions = new Float64Array(track.length * 2);
      track.forEach((point, count) => {
        positions[count * 2] = point.x;
        positions[count * 2 + 1] = point.z;
      });
      return { ...marcher, positions };
    }),
  };
  validateOpenChartShow(show);
  return show;
}

export function validateOpenChartShow(show: OpenChartShow): void {
  metadata({
    ...show,
    timing: getOpenChartTiming(show),
    marchers: show.marchers.map(marcher => ({
      ...marcher, counts: marcher.positions.length / 2,
    })),
  });
  for (const marcher of show.marchers) {
    if (!(marcher.positions instanceof Float64Array) || !marcher.positions.every(Number.isFinite)) {
      invalid("coordinates must be finite float64 values");
    }
    if (marcher.performance) {
      if (marcher.instrument === undefined) invalid("baked performance requires an instrument");
      const performance = marcher.performance;
      if (!(performance.samples instanceof Float64Array) ||
        performance.samples.length !== marcher.positions.length / 2 * OPEN_CHART_SAMPLE_SIZE ||
        !performance.samples.every(Number.isFinite)) invalid("invalid baked sample payload");
      const index = (value: number, length: number, name: string, minimum = 0) => {
        if (!Number.isInteger(value) || value < minimum || value >= length) invalid(`invalid ${name} index`);
      };
      const f = OPEN_CHART_SAMPLE;
      for (let offset = 0; offset < performance.samples.length; offset += OPEN_CHART_SAMPLE_SIZE) {
        const samples = performance.samples;
        index(samples[offset + f.style], performance.gaits.length, "style");
        index(samples[offset + f.gait], performance.gaits.length, "resolved gait", -1);
        index(samples[offset + f.movementDescription], performance.movementDescriptions.length, "movement description");
        index(samples[offset + f.flags], 16, "gait flags");
        if (samples[offset + f.steps] <= 0) invalid("steps per count must be positive");
      }
    }
  }
}

export function isOpenChartFile(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER_BYTES &&
    SIGNATURE.split("").every((char, index) => bytes[index] === char.charCodeAt(0));
}

export async function encodeOpenChart(show: OpenChartShow): Promise<Uint8Array<ArrayBuffer>> {
  validateOpenChartShow(show);
  const json = new TextEncoder().encode(JSON.stringify(encodedValueMetadata(show)));
  if (json.length > MAX_METADATA_BYTES) invalid("metadata is too large");
  const coordinateBytes = show.marchers.reduce((total, marcher) =>
    total + marcher.positions.byteLength + (marcher.performance
      ? marcher.performance.samples.byteLength : 0), 0);
  const coordinates = new Uint8Array(coordinateBytes);
  const view = new DataView(coordinates.buffer);
  let offset = 0;
  for (const marcher of show.marchers) {
    for (const values of [marcher.positions, ...(marcher.performance
      ? [marcher.performance.samples] : [])]) {
      for (const value of values) {
        view.setFloat64(offset, value, true);
        offset += 8;
      }
    }
  }
  const bytes = new Uint8Array(HEADER_BYTES + json.length + coordinates.length);
  bytes.set(new TextEncoder().encode(SIGNATURE));
  const header = new DataView(bytes.buffer);
  header.setUint32(8, json.length, true);
  header.setUint32(12, coordinates.length, true);
  bytes.set(json, HEADER_BYTES);
  bytes.set(coordinates, HEADER_BYTES + json.length);
  return bytes;
}

export async function decodeOpenChart(bytes: Uint8Array): Promise<OpenChartShow> {
  if (!isOpenChartFile(bytes)) invalid("unsupported signature or version");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metadataLength = view.getUint32(8, true);
  const start = HEADER_BYTES + metadataLength;
  if (metadataLength > MAX_METADATA_BYTES || start > bytes.length) invalid("truncated or oversized metadata");
  if (view.getUint32(12, true) > MAX_SAMPLES * (16 + OPEN_CHART_SAMPLE_SIZE * 8)) invalid("oversized payload");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(HEADER_BYTES, start)));
  } catch {
    invalid("metadata is not valid UTF-8 JSON");
  }
  const { marchers, samples, ...show } = metadata(expandValueMetadata(raw));
  if (bytes.length !== start + view.getUint32(12, true)) invalid("payload length does not match the header");
  const performanceValues = marchers.reduce((sum, marcher) =>
    sum + (marcher.performance ? marcher.counts * OPEN_CHART_SAMPLE_SIZE : 0), 0);
  if (view.getUint32(12, true) !== samples * 16 + performanceValues * 8) invalid("payload length does not match metadata");
  const coordinates = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.length - start);
  let offset = 0;
  const readValues = (length: number) => {
    const values = new Float64Array(length);
    for (let index = 0; index < length; index++) {
      const value = coordinates.getFloat64(offset, true);
      if (!Number.isFinite(value)) invalid("non-finite coordinate or baked sample");
      values[index] = value;
      offset += 8;
    }
    return values;
  };
  const result: OpenChartShow = {
    ...show,
    marchers: marchers.map(({ counts, performance, ...marcher }) => {
      const positions = readValues(counts * 2);
      const baked = performance && { ...performance, samples: readValues(counts * OPEN_CHART_SAMPLE_SIZE) };
      return {
        ...marcher, positions,
        ...(baked ? { performance: baked } : {}),
      };
    }),
  };
  validateOpenChartShow(result);
  return result;
}
