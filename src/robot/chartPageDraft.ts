// Browser-saved "chart page draft in progress": every marcher's full count
// schedule, the open blank page (and which marchers still wait as ghosts),
// the transition library choice, and the drafted guides. Plain JSON only, so
// it can be validated before anything in the scene is replaced.

import type { ChartPageTimeline } from './chartPageTimeline';

export const CHART_PAGE_DRAFT_KEY = 'chartxr.chartPageDraft';
const MAX_MARCHERS = 1000;
const MAX_COUNTS = 20000;

export type SavedVector = [number, number, number];

export interface SavedCount {
  p: SavedVector;
  r: number;
  f?: number;
  s?: number;
}

export interface SavedMarcher {
  instrument: string;
  gait: number;
  rest: boolean;
  color: SavedVector;
  step: number;
  fixed?: number;
  label?: string;
  counts: SavedCount[];
}

export interface SavedBlankPage {
  count: number;
  previous: number;
  next: number;
  // Indices into `marchers` that still wait as ghosts.
  waiting: number[];
}

export interface ChartPageDraft {
  version: 1;
  savedAt: string;
  beat: number;
  tempoBpm: number;
  transition: { shape: string; pace: string; styleIndex: number | null };
  page: SavedBlankPage | null;
  marchers: SavedMarcher[];
  // Drafting workspace JSON (same format as Save drafting), if available.
  drafting: string | null;
  // Chart page index whose guides `drafting` holds; older drafts omit it.
  draftingPage?: number;
  // Every other chart page's drafted guides (drafting workspace JSON per page).
  pageDrafting?: { page: number; drafting: string }[];
  timeline?: ChartPageTimeline;
}

const round = (value: number) => Math.round(value * 10000) / 10000;

export function roundVector(x: number, y: number, z: number): SavedVector {
  return [round(x), round(y), round(z)];
}

export function serializeChartPageDraft(draft: ChartPageDraft): string {
  const json = JSON.stringify(draft);
  parseChartPageDraft(json);
  return json;
}

function fail(message: string): never {
  throw new Error(`Saved chart page draft is invalid: ${message}.`);
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be a finite number`);
  return value;
}

function count(value: unknown, name: string): number {
  const number = finite(value, name);
  if (!Number.isInteger(number) || number < 0) fail(`${name} must be a whole count`);
  return number;
}

function vector(value: unknown, name: string): SavedVector {
  if (!Array.isArray(value) || value.length !== 3) fail(`${name} must have three numbers`);
  return [finite(value[0], name), finite(value[1], name), finite(value[2], name)];
}

function optionalFinite(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : finite(value, name);
}

export function parseChartPageDraft(json: string): ChartPageDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    fail('not JSON');
  }
  if (!raw || typeof raw !== 'object') fail('not an object');
  const data = raw as Record<string, unknown>;
  if (data.version !== 1) fail('unsupported version');
  if (typeof data.savedAt !== 'string') fail('missing save time');
  if (!Array.isArray(data.marchers) || data.marchers.length === 0 || data.marchers.length > MAX_MARCHERS) {
    fail('marchers must be a non-empty list');
  }
  const marchers = data.marchers.map((value, index): SavedMarcher => {
    if (!value || typeof value !== 'object') fail(`marcher ${index} is not an object`);
    const marcher = value as Record<string, unknown>;
    if (typeof marcher.instrument !== 'string') fail(`marcher ${index} has no instrument`);
    if (typeof marcher.rest !== 'boolean') fail(`marcher ${index} rest pose must be true or false`);
    if (marcher.label !== undefined && typeof marcher.label !== 'string') fail(`marcher ${index} label must be text`);
    const step = finite(marcher.step, `marcher ${index} step size`);
    if (step <= 0) fail(`marcher ${index} step size must be positive`);
    if (!Array.isArray(marcher.counts) || marcher.counts.length === 0 || marcher.counts.length > MAX_COUNTS) {
      fail(`marcher ${index} needs at least one count`);
    }
    const counts = marcher.counts.map((entry, countIndex): SavedCount => {
      if (!entry || typeof entry !== 'object') fail(`marcher ${index} count ${countIndex} is not an object`);
      const savedCount = entry as Record<string, unknown>;
      const name = `marcher ${index} count ${countIndex}`;
      const style = savedCount.s === undefined ? undefined : count(savedCount.s, `${name} style`);
      const facing = optionalFinite(savedCount.f, `${name} facing`);
      return {
        p: vector(savedCount.p, `${name} position`), r: finite(savedCount.r, `${name} heading`),
        ...(facing === undefined ? {} : { f: facing }), ...(style === undefined ? {} : { s: style }),
      };
    });
    const fixed = optionalFinite(marcher.fixed, `marcher ${index} fixed facing`);
    return {
      instrument: marcher.instrument, gait: count(marcher.gait, `marcher ${index} gait`), rest: marcher.rest,
      color: vector(marcher.color, `marcher ${index} color`), step, counts,
      ...(fixed === undefined ? {} : { fixed }),
      ...(marcher.label === undefined ? {} : { label: marcher.label as string }),
    };
  });
  let page: SavedBlankPage | null = null;
  if (data.page !== null) {
    if (!data.page || typeof data.page !== 'object') fail('page must be an object or null');
    const savedPage = data.page as Record<string, unknown>;
    const pageCount = count(savedPage.count, 'page count');
    const previous = count(savedPage.previous, 'previous page count');
    const next = count(savedPage.next, 'next page count');
    if (previous > pageCount || next < pageCount) fail('page counts are out of order');
    if (!Array.isArray(savedPage.waiting)) fail('waiting marchers must be a list');
    const waiting = savedPage.waiting.map((value) => count(value, 'waiting marcher'));
    if (waiting.some((index) => index >= marchers.length) || new Set(waiting).size !== waiting.length) {
      fail('waiting marchers must refer to distinct saved marchers');
    }
    page = { count: pageCount, previous, next, waiting };
  }
  if (!data.transition || typeof data.transition !== 'object') fail('missing transition');
  const transition = data.transition as Record<string, unknown>;
  if (typeof transition.shape !== 'string' || typeof transition.pace !== 'string') fail('transition needs a path and pace');
  const styleIndex = transition.styleIndex === null ? null : count(transition.styleIndex, 'transition style');
  if (data.drafting !== null && typeof data.drafting !== 'string') fail('drafting must be text or null');
  const draftingPage = data.draftingPage === undefined ? undefined : count(data.draftingPage, 'drafting page');
  let pageDrafting: { page: number; drafting: string }[] | undefined;
  if (data.pageDrafting !== undefined) {
    if (!Array.isArray(data.pageDrafting)) fail('page drafting must be a list');
    pageDrafting = data.pageDrafting.map((value, index) => {
      if (!value || typeof value !== 'object') fail(`page drafting ${index} is not an object`);
      const entry = value as Record<string, unknown>;
      if (typeof entry.drafting !== 'string') fail(`page drafting ${index} must hold drafting text`);
      return { page: count(entry.page, `page drafting ${index} page`), drafting: entry.drafting };
    });
    if (new Set(pageDrafting.map((entry) => entry.page)).size !== pageDrafting.length) {
      fail('page drafting must list each page once');
    }
  }
  const tempoBpm = finite(data.tempoBpm, 'tempo');
  let timeline: ChartPageTimeline | undefined;
  if (data.timeline !== undefined) {
    if (!data.timeline || typeof data.timeline !== 'object') fail('timeline must be an object');
    const saved = data.timeline as Record<string, unknown>;
    const beatsPerPage = count(saved.beatsPerPage, 'beats per page');
    if (beatsPerPage < 1 || beatsPerPage > 64 || !Array.isArray(saved.authoredCounts)) fail('invalid page timeline');
    const authoredCounts = saved.authoredCounts.map(value => count(value, 'authored count'));
    if (authoredCounts.some(value => value > 20000)) fail('authored count is too large');
    timeline = { beatsPerPage, authoredCounts: [...new Set(authoredCounts)].sort((a, b) => a - b) };
  }
  if (tempoBpm <= 0) fail('tempo must be positive');
  return {
    version: 1, savedAt: data.savedAt, beat: Math.max(0, finite(data.beat, 'count')), tempoBpm,
    transition: { shape: transition.shape, pace: transition.pace, styleIndex },
    page, marchers, drafting: data.drafting as string | null,
    ...(draftingPage === undefined ? {} : { draftingPage }),
    ...(pageDrafting === undefined ? {} : { pageDrafting }),
    ...(timeline === undefined ? {} : { timeline }),
  };
}
