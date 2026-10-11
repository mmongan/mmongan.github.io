import type { Database, SqlJsStatic } from "sql.js";

// OpenMarch (https://openmarch.com) stores a show as a `.dots` SQLite
// database. This module converts between that file and Chartxr's per-count
// marcher tracks. It only uses type imports so Node checks can load it without
// Babylon.js or a bundler.

export const OPEN_MARCH_FILE_EXTENSION = ".dots";

// OpenMarch canvas pixels are half an inch, so one yard is 18 pixels no matter
// which step size the field uses.
const OPEN_MARCH_PIXELS_PER_INCH = 0.5;
const OPEN_MARCH_PIXELS_PER_YARD = OPEN_MARCH_PIXELS_PER_INCH * 36;
const OPEN_MARCH_STEP_INCHES = 22.5;
const YARDS_PER_EIGHT_TO_FIVE_STEP = OPEN_MARCH_STEP_INCHES / 36;
const OPEN_MARCH_USER_VERSION = 7;
const DEFAULT_TEMPO_BPM = 120;
const DEFAULT_LAST_PAGE_COUNTS = 8;
const BEATS_PER_MEASURE = 4;
const MIDSET_TOLERANCE_YARDS = 0.05;

// OpenMarch applies Drizzle migrations newer than the last recorded row, so an
// exported file records the migrations its schema already contains.
const OPEN_MARCH_MIGRATIONS: ReadonlyArray<readonly [number, string]> = [
  [1749812963333, "8ab8dbe3589a3675be4330f30277d0e0e3ace1a2ea26c53becc4aeeb95822160"],
  [1752789274792, "3f61f2928dc743a2319d8122acba5a7f33d0d43dbbaaeb8fc61a0f12c9587e29"],
  [1752789863048, "334299e4161d49e5f88a59c6959669356aed78016c93f30265105dfd1d8e00f1"],
  [1753068380361, "033e932835eea513074c5777fbe594cfb444ca980505ab110bbce3607b5229ff"],
  [1753640028768, "5e1c0b53722d57364da083b938ba86aae7ddfc9c4b6bb74f12bfea1690295cb0"],
  [1754832111507, "5d110f1181826c600a0d0fb2d6b599670df600dc174fc0625898ce5f046e79d3"],
  [1755743220373, "6f5422ad292839b76eae9873ff8135f298cb60d3fa9c32e8e970ef96c55fa33b"],
  [1757474673889, "8139ac2f7772fa7d575d1acd0f0ae5c53cccf94259a465feaf3256da74c25449"],
  [1758910347493, "a5735fe11cadca314c77677cb3574e1a2ade486a9732252f68c4e90d0f642f98"],
  [1759086544223, "8836c61bb084431c3f5eb2ad6d64d7b1783b75cafeb89589a67fd7954b2602b4"],
  [1759286004269, "b2ed737cb9eed39526f7f7540ed43ead542b1536fa660ed6c282827a1ead19ff"],
  [1760733039979, "7b4ed16cf545bef8c6a7ba8ccba2d18fa0103cd01bb53e0bdec7f7b054340a73"],
  [1764521848101, "f9423f7c1e94fc51e1516409f6780978a7a9aef6b6fa5265e8055cc6c2c35ff4"],
  [1764547615201, "29d8101e03441833266669f00df651e9aa77e1f8c727054a2ce9f694ee5cab4a"],
  [1764557592093, "1809a63f412b2a0cd19bb36229b449f254e44506dcc46ad30a89207b88e9aedb"],
  [1764723930076, "6c16fc7b51c3f803f73057c018169f6db22151bc9b07b1a918d856a009ed9d00"],
  [1764733345489, "e40132ccaf70a6715877e42c371d8abe04fe57e7b5cdc69c81b182d0d428f714"],
];

const TIMESTAMPS = "created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL";
const PATH_POSITION_CHECK =
  "CHECK(path_start_position >= 0 AND path_start_position <= 1 AND path_end_position >= 0 AND path_end_position <= 1)";
const APPEARANCE_COLUMNS =
  "fill_color text, outline_color text, shape_type text, visible integer DEFAULT 1 NOT NULL, label_visible integer DEFAULT 1 NOT NULL, equipment_name text, equipment_state text";

// Matches OpenMarch's database after its 0016 migration.
const OPEN_MARCH_SCHEMA = `
CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
CREATE TABLE audio_files (id integer PRIMARY KEY NOT NULL, path text NOT NULL, nickname text, data blob, selected integer DEFAULT 0 NOT NULL, ${TIMESTAMPS});
CREATE TABLE beats (
  id integer PRIMARY KEY NOT NULL, duration real NOT NULL, position integer NOT NULL, include_in_measure integer DEFAULT 1 NOT NULL, notes text, ${TIMESTAMPS},
  CONSTRAINT beats_duration_check CHECK(duration >= 0),
  CONSTRAINT beats_position_check CHECK(position >= 0),
  CONSTRAINT beats_include_in_measure CHECK(include_in_measure IN (0, 1))
);
CREATE TABLE field_properties (id integer PRIMARY KEY NOT NULL, json_data text NOT NULL, image blob, CONSTRAINT field_properties_id_check CHECK(id = 1));
CREATE TABLE history_redo (sequence integer PRIMARY KEY NOT NULL, history_group integer NOT NULL, sql text NOT NULL);
CREATE TABLE history_stats (
  id integer PRIMARY KEY NOT NULL, cur_undo_group integer NOT NULL, cur_redo_group integer NOT NULL, group_limit integer NOT NULL,
  CONSTRAINT history_stats_id_check CHECK(id = 1)
);
CREATE TABLE history_undo (sequence integer PRIMARY KEY NOT NULL, history_group integer NOT NULL, sql text NOT NULL);
CREATE TABLE marchers (
  id integer PRIMARY KEY NOT NULL, name text, section text NOT NULL, year text, notes text, drill_prefix text NOT NULL, drill_order integer NOT NULL, ${TIMESTAMPS}
);
CREATE TABLE pages (
  id integer PRIMARY KEY NOT NULL, is_subset integer DEFAULT 0 NOT NULL, notes text, ${TIMESTAMPS}, start_beat integer NOT NULL,
  FOREIGN KEY (start_beat) REFERENCES beats(id) ON UPDATE no action ON DELETE no action,
  CONSTRAINT pages_is_subset_check CHECK(is_subset IN (0, 1))
);
CREATE TABLE pathways (id integer PRIMARY KEY NOT NULL, path_data text NOT NULL, notes text, ${TIMESTAMPS});
CREATE TABLE marcher_pages (
  id integer PRIMARY KEY NOT NULL, marcher_id integer NOT NULL, page_id integer NOT NULL, x real NOT NULL, y real NOT NULL, ${TIMESTAMPS},
  path_data_id integer, path_start_position real, path_end_position real, notes text, rotation_degrees real DEFAULT 0 NOT NULL, ${APPEARANCE_COLUMNS},
  FOREIGN KEY (marcher_id) REFERENCES marchers(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (path_data_id) REFERENCES pathways(id) ON UPDATE no action ON DELETE set null,
  CONSTRAINT marcher_pages_path_data_position_check ${PATH_POSITION_CHECK}
);
CREATE TABLE measures (
  id integer PRIMARY KEY NOT NULL, start_beat integer NOT NULL, rehearsal_mark text, notes text, ${TIMESTAMPS},
  FOREIGN KEY (start_beat) REFERENCES beats(id) ON UPDATE no action ON DELETE no action
);
CREATE TABLE midsets (
  id integer PRIMARY KEY NOT NULL, mp_id integer NOT NULL, x real NOT NULL, y real NOT NULL, progress_placement real NOT NULL, ${TIMESTAMPS},
  path_data_id integer, path_start_position real, path_end_position real, notes text,
  FOREIGN KEY (mp_id) REFERENCES marcher_pages(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (path_data_id) REFERENCES pathways(id) ON UPDATE no action ON DELETE set null,
  CONSTRAINT midsets_path_data_position_check ${PATH_POSITION_CHECK},
  CONSTRAINT placement_check CHECK(progress_placement > 0 AND progress_placement < 1)
);
CREATE TABLE section_appearances (id integer PRIMARY KEY NOT NULL, section text NOT NULL, ${APPEARANCE_COLUMNS}, ${TIMESTAMPS});
CREATE TABLE shapes (id integer PRIMARY KEY NOT NULL, name text, ${TIMESTAMPS}, notes text);
CREATE TABLE shape_pages (
  id integer PRIMARY KEY NOT NULL, shape_id integer NOT NULL, page_id integer NOT NULL, svg_path text NOT NULL, ${TIMESTAMPS}, notes text,
  FOREIGN KEY (shape_id) REFERENCES shapes(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE shape_page_marchers (
  id integer PRIMARY KEY NOT NULL, shape_page_id integer NOT NULL, marcher_id integer NOT NULL, position_order integer NOT NULL, ${TIMESTAMPS}, notes text,
  FOREIGN KEY (shape_page_id) REFERENCES shape_pages(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (marcher_id) REFERENCES marchers(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE tags (id integer PRIMARY KEY NOT NULL, name text, description text, ${TIMESTAMPS}, icon text, color_hex text);
CREATE TABLE marcher_tags (
  id integer PRIMARY KEY NOT NULL, marcher_id integer NOT NULL, tag_id integer NOT NULL, ${TIMESTAMPS},
  FOREIGN KEY (marcher_id) REFERENCES marchers(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE tag_appearances (
  id integer PRIMARY KEY NOT NULL, tag_id integer NOT NULL, start_page_id integer NOT NULL,
  fill_color text, outline_color text, shape_type text, visible integer DEFAULT 1 NOT NULL, label_visible integer DEFAULT 1 NOT NULL,
  priority integer DEFAULT 0 NOT NULL, ${TIMESTAMPS}, equipment_name text, equipment_state text,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (start_page_id) REFERENCES pages(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE utility (
  id integer PRIMARY KEY NOT NULL, last_page_counts integer DEFAULT 8 NOT NULL, default_beat_duration real DEFAULT 0.5 NOT NULL,
  updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  CONSTRAINT utility_last_page_counts_check CHECK(last_page_counts > 0),
  CONSTRAINT utility_id_check CHECK(id = 0),
  CONSTRAINT utility_default_beat_duration_check CHECK(default_beat_duration > 0)
);
CREATE TABLE workspace_settings (id integer PRIMARY KEY NOT NULL, json_data text NOT NULL, ${TIMESTAMPS}, CONSTRAINT workspace_settings_id_check CHECK(id = 1));
CREATE INDEX "idx-spm-marcher_id" ON shape_page_marchers (marcher_id);
CREATE INDEX "idx-spm-shape_page_id" ON shape_page_marchers (shape_page_id);
CREATE INDEX index_marcher_pages_on_marcher_id ON marcher_pages (marcher_id);
CREATE INDEX index_marcher_pages_on_page_id ON marcher_pages (page_id);
CREATE UNIQUE INDEX marcher_pages_marcher_id_page_id_unique ON marcher_pages (marcher_id, page_id);
CREATE UNIQUE INDEX marcher_tags_marcher_id_tag_id_unique ON marcher_tags (marcher_id, tag_id);
CREATE UNIQUE INDEX marchers_drill_prefix_drill_order_unique ON marchers (drill_prefix, drill_order);
CREATE UNIQUE INDEX midsets_mp_id_progress_placement_unique ON midsets (mp_id, progress_placement);
CREATE UNIQUE INDEX pages_start_beat_unique ON pages (start_beat);
CREATE UNIQUE INDEX shape_page_marchers_shape_page_id_marcher_id_unique ON shape_page_marchers (shape_page_id, marcher_id);
CREATE UNIQUE INDEX shape_page_marchers_shape_page_id_position_order_unique ON shape_page_marchers (shape_page_id, position_order);
CREATE UNIQUE INDEX shape_pages_page_id_shape_id_unique ON shape_pages (page_id, shape_id);
CREATE UNIQUE INDEX tag_appearances_tag_id_start_page_id_unique ON tag_appearances (tag_id, start_page_id);
CREATE VIEW timing_objects AS
  SELECT beats.position AS position, beats.duration AS duration,
    SUM(duration) OVER (ORDER BY position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS timestamp,
    beats.id AS beat_id, pages.id AS page_id, measures.id AS measure_id
  FROM beats
    LEFT JOIN pages ON beats.id = pages.start_beat
    LEFT JOIN measures ON beats.id = measures.start_beat;
CREATE TRIGGER prevent_first_beat_modification BEFORE UPDATE ON beats FOR EACH ROW WHEN OLD.id = 0
  BEGIN SELECT RAISE(FAIL, 'Modification not allowed for the first beat.'); END;
CREATE TRIGGER prevent_first_beat_deletion BEFORE DELETE ON beats FOR EACH ROW WHEN OLD.id = 0
  BEGIN SELECT RAISE(FAIL, 'Deletion not allowed for the first beat.'); END;
CREATE TRIGGER prevent_first_page_modification BEFORE UPDATE ON pages FOR EACH ROW
  WHEN OLD.id = 0 AND (NEW.is_subset != OLD.is_subset OR NEW.start_beat != OLD.start_beat)
  BEGIN SELECT RAISE(FAIL, 'Modification not allowed for the first page.'); END;
CREATE TRIGGER prevent_first_page_deletion BEFORE DELETE ON pages FOR EACH ROW WHEN OLD.id = 0
  BEGIN SELECT RAISE(FAIL, 'Deletion not allowed for the first page.'); END;
CREATE TRIGGER prevent_utility_deletion BEFORE DELETE ON utility FOR EACH ROW WHEN OLD.id = 0
  BEGIN SELECT RAISE(FAIL, 'Deletion not allowed for the utility record.'); END;
`;

// Chartxr field coordinates in yards: x crosses the field from the front
// sideline (-x) to the back sideline (+x), z runs down the field with side 1
// (OpenMarch's negative x) at +z, and the origin is the 50-yard line.
export type FieldPoint = { x: number; z: number };

export type OpenMarchFieldSpec = {
  level: string;
  widthYards: number;
  hashOffsetYards: number;
};

export type OpenMarchExportDrill = {
  tempoBpm: number;
  // Count index of each page's dot, ascending and starting at 0.
  setCounts: number[];
  // One track per marcher with a position for every count up to the last set.
  tracks: FieldPoint[][];
  // Optional section and drill prefix per track (defaults: Trumpet, "T").
  marchers?: { section: string; drillPrefix: string }[];
  // Optional notes per page (one per set count).
  pageNotes?: string[];
};

export type OpenMarchPageInfo = {
  // OpenMarch's page name, e.g. "0", "1", "1A" (subsets get letters).
  name: string;
  // Count index of the page's set.
  count: number;
  notes: string;
};

export type OpenMarchMarcherInfo = {
  // Drill label, e.g. "T3".
  label: string;
  name: string;
  section: string;
  notes: string;
};

export type OpenMarchImportedDrill = {
  tempoBpm: number;
  pages: OpenMarchPageInfo[];
  // One entry per track, in track order.
  marchers: OpenMarchMarcherInfo[];
  // One position per count, all tracks the same length.
  tracks: FieldPoint[][];
};

type Checkpoint = {
  id: number;
  name: string;
  axis: "x" | "y";
  terseName: string;
  stepsFromCenterFront: number;
  useAsReference: boolean;
  visible: boolean;
  fieldLabel?: string;
};

type FieldFrame = { centerX: number; frontY: number };

const LEVEL_NAMES: Record<string, string> = {
  highschool: "high school",
  college: "college",
  nfl: "pro",
};

const roundSteps = (yards: number) => Math.round((yards / YARDS_PER_EIGHT_TO_FIVE_STEP) * 100) / 100;

// Mirrors OpenMarch's football templates, with hashes placed where Chartxr
// draws them for the selected level and end zones included because Chartxr's
// field spans the full 120 yards.
export function createOpenMarchFieldProperties(spec: OpenMarchFieldSpec) {
  const xCheckpoints: Checkpoint[] = [];
  let id = 0;
  for (let yards = 0; yards <= 100; yards += 5) {
    const yardLine = yards <= 50 ? yards : 100 - yards;
    xCheckpoints.push({
      id: id++,
      name: `${yardLine} yard line`,
      axis: "x",
      terseName: String(yardLine),
      stepsFromCenterFront: ((yards - 50) / 5) * 8,
      useAsReference: true,
      visible: true,
      ...(yardLine !== 0 && yardLine % 10 === 0 ? { fieldLabel: String(yardLine) } : {}),
    });
  }
  for (const steps of [-96, 96]) {
    xCheckpoints.push({
      id: id++,
      name: "end zone",
      axis: "x",
      terseName: "EZ",
      stepsFromCenterFront: steps,
      useAsReference: true,
      visible: true,
    });
  }

  const halfWidth = spec.widthYards / 2;
  const yCheckpoints: Checkpoint[] = [
    { id: 0, name: "front sideline", axis: "y", terseName: "FSL", stepsFromCenterFront: 0, useAsReference: true, visible: false },
    {
      id: 1, name: "front hash", axis: "y", terseName: "FH",
      stepsFromCenterFront: -roundSteps(halfWidth - spec.hashOffsetYards), useAsReference: true, visible: true,
    },
    {
      id: 2, name: "back hash", axis: "y", terseName: "BH",
      stepsFromCenterFront: -roundSteps(halfWidth + spec.hashOffsetYards), useAsReference: true, visible: true,
    },
    {
      id: 3, name: "back sideline", axis: "y", terseName: "BSL",
      stepsFromCenterFront: -roundSteps(spec.widthYards), useAsReference: true, visible: false,
    },
  ];

  const pro = spec.level === "nfl";
  const frame = getFieldFrame({ xCheckpoints, yCheckpoints, stepSizeInches: OPEN_MARCH_STEP_INCHES });
  return {
    name: `Chartxr ${LEVEL_NAMES[spec.level] ?? spec.level} football field (with end zones)`,
    xCheckpoints,
    yCheckpoints,
    yardNumberCoordinates: pro
      ? { homeStepsFromFrontToOutside: 19.2, homeStepsFromFrontToInside: 22.4, awayStepsFromFrontToInside: 62.93, awayStepsFromFrontToOutside: 66.13 }
      : { homeStepsFromFrontToOutside: 11.2, homeStepsFromFrontToInside: 14.4, awayStepsFromFrontToInside: 70.9333, awayStepsFromFrontToOutside: 74.1333 },
    stepSizeInches: OPEN_MARCH_STEP_INCHES,
    halfLineXInterval: 4,
    halfLineYInterval: 4,
    measurementSystem: "imperial",
    useHashes: true,
    isCustom: true,
    width: frame.centerX * 2,
    height: frame.frontY,
    centerFrontPoint: { xPixels: frame.centerX, yPixels: frame.frontY },
  };
}

// Same derivation as OpenMarch's FieldProperties constructor: the canvas
// spans the checkpoint extents and the center-front point is at half the
// width on the front edge.
function getFieldFrame(field: unknown): FieldFrame {
  const data = (field && typeof field === "object" ? field : {}) as {
    xCheckpoints?: { stepsFromCenterFront?: number }[];
    yCheckpoints?: { stepsFromCenterFront?: number }[];
    stepSizeInches?: number;
    centerFrontPoint?: { xPixels?: number; yPixels?: number };
  };
  const steps = (checkpoints: { stepsFromCenterFront?: number }[] | undefined) =>
    (Array.isArray(checkpoints) ? checkpoints : [])
      .map((checkpoint) => Number(checkpoint?.stepsFromCenterFront))
      .filter(Number.isFinite);
  const xSteps = steps(data.xCheckpoints);
  const ySteps = steps(data.yCheckpoints);
  if (xSteps.length > 0 && ySteps.length > 0) {
    const stepInches = Number(data.stepSizeInches) > 0 ? Number(data.stepSizeInches) : OPEN_MARCH_STEP_INCHES;
    const pixelsPerStep = stepInches * OPEN_MARCH_PIXELS_PER_INCH;
    const width = (Math.max(0, ...xSteps) - Math.min(0, ...xSteps)) * pixelsPerStep;
    const height = (Math.max(0, ...ySteps) - Math.min(0, ...ySteps)) * pixelsPerStep;
    return { centerX: width / 2, frontY: height };
  }
  const centerX = Number(data.centerFrontPoint?.xPixels);
  const frontY = Number(data.centerFrontPoint?.yPixels);
  if (Number.isFinite(centerX) && Number.isFinite(frontY)) return { centerX, frontY };
  return getFieldFrame(createOpenMarchFieldProperties({ level: "highschool", widthYards: 53.333, hashOffsetYards: 8.8889 }));
}

export function fieldPointToOpenMarchPixels(point: FieldPoint, frame: FieldFrame, widthYards: number) {
  return {
    x: frame.centerX - point.z * OPEN_MARCH_PIXELS_PER_YARD,
    y: frame.frontY - (point.x + widthYards / 2) * OPEN_MARCH_PIXELS_PER_YARD,
  };
}

export function openMarchPixelsToFieldPoint(x: number, y: number, frame: FieldFrame, widthYards: number): FieldPoint {
  return {
    x: (frame.frontY - y) / OPEN_MARCH_PIXELS_PER_YARD - widthYards / 2,
    z: (frame.centerX - x) / OPEN_MARCH_PIXELS_PER_YARD,
  };
}

function run(db: Database, sql: string, params: (number | string | null)[]) {
  db.run(sql, params);
}

// Builds a `.dots` file that OpenMarch opens as an existing show: page 0 is
// the opening set on beat 0, and each later page starts on the count after the
// previous set and lasts until its own set.
export function writeOpenMarchDatabase(
  SQL: SqlJsStatic,
  drill: OpenMarchExportDrill,
  spec: OpenMarchFieldSpec
): Uint8Array {
  const setCounts = normalizeSetCounts(drill.setCounts);
  const lastCount = setCounts[setCounts.length - 1];
  const tempoBpm = drill.tempoBpm > 0 ? drill.tempoBpm : DEFAULT_TEMPO_BPM;
  const beatDuration = 60 / tempoBpm;
  const field = createOpenMarchFieldProperties(spec);
  const frame = getFieldFrame(field);
  const lastPageCounts = setCounts.length > 1 ? lastCount - setCounts[setCounts.length - 2] : DEFAULT_LAST_PAGE_COUNTS;
  const db = new SQL.Database();
  try {
    db.exec(OPEN_MARCH_SCHEMA);
    db.exec(`PRAGMA user_version = ${OPEN_MARCH_USER_VERSION}`);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN");
    OPEN_MARCH_MIGRATIONS.forEach(([createdAt, hash]) =>
      run(db, "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [hash, createdAt])
    );
    run(db, "INSERT INTO beats (id, duration, position) VALUES (0, 0, 0)", []);
    for (let count = 1; count <= lastCount; count++) {
      run(db, "INSERT INTO beats (id, duration, position) VALUES (?, ?, ?)", [count, beatDuration, count]);
    }
    for (let beat = 1; beat <= lastCount; beat += BEATS_PER_MEASURE) {
      run(db, "INSERT INTO measures (start_beat) VALUES (?)", [beat]);
    }
    setCounts.forEach((count, page) => {
      run(db, "INSERT INTO pages (id, start_beat, notes) VALUES (?, ?, ?)", [
        page,
        page === 0 ? 0 : setCounts[page - 1] + 1,
        drill.pageNotes?.[page] || null,
      ]);
    });
    run(db, "INSERT INTO utility (id, last_page_counts, default_beat_duration) VALUES (0, ?, ?)", [
      Math.max(1, lastPageCounts),
      beatDuration,
    ]);
    run(db, "INSERT INTO history_stats (id, cur_undo_group, cur_redo_group, group_limit) VALUES (1, 1, 1, 500)", []);
    run(db, "INSERT INTO field_properties (id, json_data) VALUES (1, ?)", [JSON.stringify(field)]);
    run(db, "INSERT INTO workspace_settings (id, json_data) VALUES (1, ?)", [
      JSON.stringify({ defaultBeatsPerMeasure: BEATS_PER_MEASURE, defaultTempo: Math.round(tempoBpm), defaultNewPageCounts: 8 }),
    ]);

    let marcherPageId = 1;
    const drillOrders = new Map<string, number>();
    drill.tracks.forEach((track, index) => {
      if (track.length === 0) return;
      const marcherId = index + 1;
      const { section, drillPrefix } = drill.marchers?.[index] ?? { section: "Trumpet", drillPrefix: "T" };
      const drillOrder = (drillOrders.get(drillPrefix) ?? 0) + 1;
      drillOrders.set(drillPrefix, drillOrder);
      run(db, "INSERT INTO marchers (id, name, section, drill_prefix, drill_order) VALUES (?, ?, ?, ?, ?)", [
        marcherId,
        `${section} ${drillOrder}`,
        section,
        drillPrefix,
        drillOrder,
      ]);
      const at = (count: number) => track[Math.min(track.length - 1, Math.max(0, count))];
      setCounts.forEach((count, page) => {
        const pixels = fieldPointToOpenMarchPixels(at(count), frame, spec.widthYards);
        run(db, "INSERT INTO marcher_pages (id, marcher_id, page_id, x, y) VALUES (?, ?, ?, ?, ?)", [
          marcherPageId,
          marcherId,
          page,
          pixels.x,
          pixels.y,
        ]);
        // OpenMarch moves in straight lines between pages, so curved Chartxr
        // routes keep their exact per-count spots as midsets.
        if (page > 0) {
          const startCount = setCounts[page - 1];
          const counts = count - startCount;
          const from = at(startCount);
          const to = at(count);
          const intermediate: { placement: number; point: FieldPoint }[] = [];
          let curved = false;
          for (let step = 1; step < counts; step++) {
            const placement = step / counts;
            const point = at(startCount + step);
            const expectedX = from.x + (to.x - from.x) * placement;
            const expectedZ = from.z + (to.z - from.z) * placement;
            if (Math.hypot(point.x - expectedX, point.z - expectedZ) > MIDSET_TOLERANCE_YARDS) curved = true;
            intermediate.push({ placement, point });
          }
          if (curved) {
            intermediate.forEach(({ placement, point }) => {
              const midset = fieldPointToOpenMarchPixels(point, frame, spec.widthYards);
              run(db, "INSERT INTO midsets (mp_id, x, y, progress_placement) VALUES (?, ?, ?, ?)", [
                marcherPageId,
                midset.x,
                midset.y,
                placement,
              ]);
            });
          }
        }
        marcherPageId++;
      });
    });
    db.exec("COMMIT");
    return db.export();
  } finally {
    db.close();
  }
}

function normalizeSetCounts(counts: number[]): number[] {
  const sorted = [...new Set(counts.map((count) => Math.max(0, Math.round(count))))].sort((a, b) => a - b);
  if (sorted[0] !== 0) sorted.unshift(0);
  return sorted;
}

function queryRows(db: Database, sql: string): Record<string, unknown>[] {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))
  );
}

function tableExists(db: Database, table: string): boolean {
  const statement = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  try {
    statement.bind([table]);
    return statement.step();
  } finally {
    statement.free();
  }
}

// Reads an OpenMarch show into one Chartxr position per count. Moves between
// pages are straight lines (through any midsets); curved pathways are not
// reproduced.
export function readOpenMarchDatabase(SQL: SqlJsStatic, bytes: Uint8Array, widthYards: number): OpenMarchImportedDrill {
  let db: Database;
  try {
    db = new SQL.Database(bytes);
  } catch {
    throw new Error("This file is not an OpenMarch .dots database.");
  }
  try {
    for (const table of ["beats", "pages", "marchers", "marcher_pages"]) {
      if (!tableExists(db, table)) throw new Error("This file is not an OpenMarch .dots show (missing " + table + ").");
    }

    const beats = queryRows(db, "SELECT position, duration FROM beats ORDER BY position");
    const durations = beats
      .filter((beat) => Number(beat.position) > 0 && Number(beat.duration) > 0)
      .map((beat) => Number(beat.duration))
      .sort((a, b) => a - b);
    const medianDuration = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 60 / DEFAULT_TEMPO_BPM;

    const pages = queryRows(
      db,
      "SELECT pages.id AS id, pages.is_subset AS is_subset, pages.notes AS notes, beats.position AS position FROM pages JOIN beats ON beats.id = pages.start_beat ORDER BY beats.position"
    );
    if (pages.length === 0) throw new Error("This OpenMarch show has no pages.");
    const lastPageCounts = tableExists(db, "utility")
      ? Number(queryRows(db, "SELECT last_page_counts FROM utility WHERE id = 0")[0]?.last_page_counts) || DEFAULT_LAST_PAGE_COUNTS
      : DEFAULT_LAST_PAGE_COUNTS;
    // A page's dot is reached on its final count: one before the next page
    // starts, or after utility.last_page_counts for the final page.
    const pageCounts: number[] = [];
    pages.forEach((page, index) => {
      const start = Number(page.position);
      const end = index === 0 && start === 0
        ? 0
        : index + 1 < pages.length
          ? Number(pages[index + 1].position) - 1
          : start + Math.max(1, lastPageCounts) - 1;
      pageCounts.push(Math.max(index === 0 ? 0 : pageCounts[index - 1] + 1, end));
    });
    const pageIndexById = new Map(pages.map((page, index) => [Number(page.id), index]));
    const lastCount = pageCounts[pageCounts.length - 1];

    let frame: FieldFrame;
    try {
      const json = tableExists(db, "field_properties")
        ? queryRows(db, "SELECT json_data FROM field_properties WHERE id = 1")[0]?.json_data
        : undefined;
      frame = getFieldFrame(typeof json === "string" ? JSON.parse(json) : undefined);
    } catch {
      frame = getFieldFrame(undefined);
    }

    const marchers = queryRows(db, "SELECT id, name, section, notes, drill_prefix, drill_order FROM marchers ORDER BY drill_prefix, drill_order, id");
    const keyframesByMarcher = new Map<number, { count: number; point: FieldPoint }[]>();
    const marcherPageRows = queryRows(db, "SELECT id, marcher_id, page_id, x, y FROM marcher_pages");
    const marcherPageById = new Map<number, { marcherId: number; pageIndex: number }>();
    marcherPageRows.forEach((row) => {
      const pageIndex = pageIndexById.get(Number(row.page_id));
      const x = Number(row.x);
      const y = Number(row.y);
      if (pageIndex === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const marcherId = Number(row.marcher_id);
      marcherPageById.set(Number(row.id), { marcherId, pageIndex });
      const keyframes = keyframesByMarcher.get(marcherId) ?? [];
      keyframes.push({ count: pageCounts[pageIndex], point: openMarchPixelsToFieldPoint(x, y, frame, widthYards) });
      keyframesByMarcher.set(marcherId, keyframes);
    });
    if (tableExists(db, "midsets")) {
      queryRows(db, "SELECT mp_id, x, y, progress_placement FROM midsets").forEach((row) => {
        const owner = marcherPageById.get(Number(row.mp_id));
        const placement = Number(row.progress_placement);
        const x = Number(row.x);
        const y = Number(row.y);
        if (!owner || owner.pageIndex === 0 || !(placement > 0 && placement < 1) || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const startCount = pageCounts[owner.pageIndex - 1];
        const count = startCount + (pageCounts[owner.pageIndex] - startCount) * placement;
        keyframesByMarcher.get(owner.marcherId)?.push({ count, point: openMarchPixelsToFieldPoint(x, y, frame, widthYards) });
      });
    }

    const tracks: FieldPoint[][] = [];
    const marcherInfo: OpenMarchMarcherInfo[] = [];
    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    marchers.forEach((marcher) => {
      const keyframes = keyframesByMarcher.get(Number(marcher.id));
      if (!keyframes || keyframes.length === 0) return;
      keyframes.sort((a, b) => a.count - b.count);
      tracks.push(sampleKeyframes(keyframes, lastCount));
      marcherInfo.push({
        label: `${text(marcher.drill_prefix)}${marcher.drill_order ?? ""}`,
        name: text(marcher.name),
        section: text(marcher.section),
        notes: text(marcher.notes),
      });
    });

    let pageNumberOffset = 0;
    try {
      const json = tableExists(db, "workspace_settings")
        ? queryRows(db, "SELECT json_data FROM workspace_settings WHERE id = 1")[0]?.json_data
        : undefined;
      const offset = typeof json === "string" ? Number(JSON.parse(json)?.pageNumberOffset) : NaN;
      if (Number.isInteger(offset)) pageNumberOffset = offset;
    } catch {
      // Unreadable settings keep OpenMarch's default numbering.
    }
    const pageNames = getOpenMarchPageNames(pages.map((page) => Number(page.is_subset) === 1), pageNumberOffset);

    return {
      tempoBpm: 60 / medianDuration,
      pages: pages.map((page, index) => ({ name: pageNames[index], count: pageCounts[index], notes: text(page.notes) })),
      marchers: marcherInfo,
      tracks,
    };
  } finally {
    db.close();
  }
}

// Mirrors OpenMarch's page naming: pages count up from the offset and each
// subset page takes the previous number plus the next letter (2, 2A, 2B, 3).
function getOpenMarchPageNames(isSubset: boolean[], offset: number): string[] {
  const names: string[] = [];
  let pageNumber = offset;
  let letters = "";
  const nextLetters = (current: string) => {
    const chars = current.split("");
    for (let i = chars.length - 1; i >= 0; i--) {
      if (chars[i] !== "Z") {
        chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
        return chars.join("");
      }
      chars[i] = "A";
    }
    return "A" + chars.join("");
  };
  isSubset.forEach((subset, index) => {
    if (index > 0) {
      if (subset) {
        letters = nextLetters(letters);
      } else {
        pageNumber++;
        letters = "";
      }
    }
    names.push(`${pageNumber}${letters}`);
  });
  return names;
}

function sampleKeyframes(keyframes: { count: number; point: FieldPoint }[], lastCount: number): FieldPoint[] {
  const track: FieldPoint[] = [];
  let next = 0;
  for (let count = 0; count <= lastCount; count++) {
    while (next < keyframes.length && keyframes[next].count < count) next++;
    if (next === 0) {
      track.push({ ...keyframes[0].point });
    } else if (next >= keyframes.length) {
      track.push({ ...keyframes[keyframes.length - 1].point });
    } else {
      const before = keyframes[next - 1];
      const after = keyframes[next];
      const span = after.count - before.count;
      const t = span > 0 ? (count - before.count) / span : 1;
      track.push({
        x: before.point.x + (after.point.x - before.point.x) * t,
        z: before.point.z + (after.point.z - before.point.z) * t,
      });
    }
  }
  return track;
}
