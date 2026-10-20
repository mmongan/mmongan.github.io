import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import initSqlJs from "sql.js";
import { readOpenMarchDatabase } from "../src/robot/openMarchFormat.ts";
import { convertToOpenChart, encodeOpenChart } from "../src/robot/openChartFormat.ts";

const [input, output, title = input ? basename(input, ".dots") : ""] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts\\convert-openmarch.mts input.dots output.openchart [title]");
const SQL = await initSqlJs();
const widthYards = 53.333;
const drill = readOpenMarchDatabase(SQL, new Uint8Array(readFileSync(input)), widthYards);
const bytes = await encodeOpenChart(convertToOpenChart(drill, title, widthYards));
writeFileSync(output, bytes);
console.log(`Converted ${drill.tracks.length} marchers and ${drill.pages.length} pages to ${bytes.length} bytes: ${output}`);
