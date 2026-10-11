// Regenerates the bundled OpenMarch example show:
//   node --experimental-strip-types scripts/make-openmarch-example.mts
// The band is an 8-file by 5-rank block (front rank nearest the audience) that
// spreads into a company front, curves into an arc, folds into a chevron, and
// closes back into the block. Every set is a smooth map of each marcher's
// file and rank, so no paths cross.
import { writeFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { writeOpenMarchDatabase, type FieldPoint } from "../src/robot/openMarchFormat.ts";

const OUTPUT = new URL("../src/assets/openmarch/example-show.dots", import.meta.url);
const FILES = 8;
const RANKS = 5;
const COUNTS_PER_MOVE = 16;

// Front to back, each rank lists files from the side 2 end to the side 1 end.
const SECTIONS: Record<string, [section: string, drillPrefix: string]> = {
  F: ["Flute", "F"],
  C: ["Clarinet", "C"],
  A: ["Alto Sax", "A"],
  X: ["Bari Sax", "X"],
  M: ["Mellophone", "M"],
  T: ["Trumpet", "T"],
  N: ["Trombone", "N"],
  E: ["Baritone", "E"],
  U: ["Sousaphone", "U"],
  G: ["Glockenspiel", "G"],
  D: ["Bass Drum", "BD"],
  Q: ["Tenors", "Q"],
  S: ["Snare", "S"],
};
const BAND = ["CCFFFFCC", "MXAAAAXM", "MTTTTTTM", "UENNNNEU", "GDQSSQDG"];
const marchers = BAND.flatMap((rank) => [...rank].map((code) => {
  const [section, drillPrefix] = SECTIONS[code];
  return { section, drillPrefix };
}));
if (BAND.length !== RANKS || BAND.some((rank) => rank.length !== FILES)) throw new Error("Band layout must be 8 by 5");

// Each set places the marcher at file f (0 = side 2 end) and rank r (0 = front).
type Set = (f: number, r: number) => FieldPoint;
const centered = (f: number) => f - (FILES - 1) / 2;
const block: Set = (f, r) => ({ x: -10 + r * 2.5, z: centered(f) * 2.5 });
const companyFront: Set = (f, r) => ({ x: -14 + r * 2, z: centered(f) * 5 });
const arc: Set = (f, r) => {
  const radius = 22 - r * 2.5;
  const angle = (centered(f) / ((FILES - 1) / 2)) * (50 * Math.PI) / 180;
  return { x: 8 - radius * Math.cos(angle), z: radius * Math.sin(angle) };
};
const chevron: Set = (f, r) => {
  const z = centered(f) * 4;
  return { x: -13 + r * 2 + Math.abs(z) * 0.5, z };
};
const sets: Set[] = [block, companyFront, arc, chevron, block];

const tracks: FieldPoint[][] = marchers.map((_, index) => {
  // Rank 0 is the front (woodwinds), rank 4 the drumline.
  const r = Math.floor(index / FILES);
  const f = index % FILES;
  const track: FieldPoint[] = [sets[0](f, r)];
  for (let move = 1; move < sets.length; move++) {
    const from = sets[move - 1](f, r);
    const to = sets[move](f, r);
    for (let count = 1; count <= COUNTS_PER_MOVE; count++) {
      const t = count / COUNTS_PER_MOVE;
      track.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
    }
  }
  return track;
});

const SQL = await initSqlJs();
const bytes = writeOpenMarchDatabase(
  SQL,
  {
    tempoBpm: 120,
    setCounts: sets.map((_, page) => page * COUNTS_PER_MOVE),
    tracks,
    marchers,
  },
  { level: "highschool", widthYards: 53.333, hashOffsetYards: 8.8889 }
);
writeFileSync(OUTPUT, bytes);
console.log(`Wrote ${bytes.length} bytes, ${tracks.length} marchers, ${sets.length} sets to ${OUTPUT.pathname}`);
