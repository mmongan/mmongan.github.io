/// <reference types="vite/client" />
import type { SqlJsStatic } from "sql.js";
import { FIELD_WIDTH_YARDS } from "../field/constants";
import { readOpenMarchDatabase, type OpenMarchImportedDrill } from "./openMarchFormat";
import type { MarcherInstrument } from "./robot";
import exampleShowUrl from "../assets/openmarch/example-show.dots?url";

// Query parameter that opens an OpenMarch show on startup, e.g.
// `?openmarch=https://example.com/show.dots`.
export const OPEN_MARCH_URL_PARAM = "openmarch";
// Opens the bundled example show (scripts/make-openmarch-example.mts) instead
// of a URL, e.g. `?openmarch=example`.
export const OPEN_MARCH_EXAMPLE = "example";

let sqlJs: Promise<SqlJsStatic> | null = null;

// sql.js and its WebAssembly are only downloaded the first time a show opens.
function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJs) {
    sqlJs = Promise.all([import("sql.js"), import("sql.js/dist/sql-wasm.wasm?url")])
      .then(([module, wasm]) => module.default({ locateFile: () => wasm.default }));
    sqlJs.catch(() => { sqlJs = null; });
  }
  return sqlJs;
}

// Share links for file pages are rewritten to their raw download URLs.
export function resolveOpenMarchUrl(input: string, base = window.location.href): URL {
  if (input.trim().toLowerCase() === OPEN_MARCH_EXAMPLE) return new URL(exampleShowUrl, base);
  const url = new URL(input.trim(), base);
  const github = url.hostname === "github.com" && url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
  if (github) return new URL(`https://raw.githubusercontent.com/${github[1]}/${github[2]}/${github[3]}`);
  if (url.hostname === "www.dropbox.com" || url.hostname === "dropbox.com") url.searchParams.set("dl", "1");
  return url;
}

export async function loadOpenMarchFromUrl(input: string): Promise<OpenMarchImportedDrill> {
  let url: URL;
  try {
    url = resolveOpenMarchUrl(input);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https URLs can be opened.");
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Could not download ${url.href}. The server may not allow cross-origin downloads.`);
  }
  if (!response.ok) throw new Error(`Could not download ${url.href} (HTTP ${response.status}).`);
  const [SQL, bytes] = await Promise.all([loadSqlJs(), response.arrayBuffer()]);
  let drill: OpenMarchImportedDrill;
  try {
    drill = readOpenMarchDatabase(SQL, new Uint8Array(bytes), FIELD_WIDTH_YARDS);
  } catch {
    throw new Error(`${url.href} is not an OpenMarch .dots show.`);
  }
  if (drill.tracks.length === 0) throw new Error("This OpenMarch show has no marchers with dots.");
  return drill;
}

// OpenMarch sections are free text, so the closest OpenChartxr instrument is
// matched by keyword; unknown sections (such as drum major) keep `fallback`.
const SECTION_INSTRUMENTS: ReadonlyArray<readonly [RegExp, MarcherInstrument]> = [
  [/sabre|saber/, "guardSabre"],
  [/rifle/, "guardRifle"],
  [/colou?r\s*guard|guard|flag/, "guardFlag"],
  [/bari(tone)?\s*sax/, "bariSax"],
  [/sax/, "altoSax"],
  [/flute|piccolo/, "flute"],
  [/clarinet|oboe|bassoon/, "clarinet"],
  [/trumpet|cornet|flugel/, "trumpet"],
  [/mello|horn/, "mellophone"],
  [/trombone/, "trombone"],
  [/baritone|euphonium/, "euphonium"],
  [/tuba|sousa/, "sousaphone"],
  [/cymbal/, "cymbals"],
  [/snare/, "snare"],
  [/tenor|quad|quint/, "tenors"],
  [/bass\s*drum|^bass$|^bd$/, "bassDrum"],
  [/glock|bell|mallet|xylo|marimba|vibe|pit|front ensemble/, "glockenspiel"],
];

export function getOpenMarchSectionInstrument(section: string, fallback: MarcherInstrument): MarcherInstrument {
  const name = section.trim().toLowerCase();
  return SECTION_INSTRUMENTS.find(([pattern]) => pattern.test(name))?.[1] ?? fallback;
}
