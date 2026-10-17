// Each chart page keeps its own drafted guides. The field shows the guides of
// the page being shown; the other pages' guides wait here, keyed by page index.
import { scene } from '../scene/engine';
import { parseDraftingWorkspace, serializeDraftingWorkspace, type WorkspaceGuide } from './draftingWorkspace';
import { areDrawingGuidesBusy, exportDrawingWorkspace, swapDrawingGuides } from './fieldDrawingTools';

export interface SavedPageGuides {
  page: number;
  // Drafting workspace JSON (same format as Save drafting); only its guides are used.
  drafting: string;
}

const storedGuides = new Map<number, WorkspaceGuide[]>();
let shownPage = 0;
let getShownPage: (() => number) | null = null;

function store(page: number, guides: WorkspaceGuide[]) {
  if (guides.length > 0) storedGuides.set(page, guides);
  else storedGuides.delete(page);
}

/** Swaps the field's guides to `page`'s; returns false (retry later) while guides are being edited. */
export function showChartPageGuides(page: number): boolean {
  if (page === shownPage) return true;
  const previous = swapDrawingGuides(storedGuides.get(page) ?? []);
  if (!previous) return false;
  storedGuides.delete(page);
  store(shownPage, previous);
  shownPage = page;
  return true;
}

/** Follows the page shown every frame, so seeking, flipping and playback change guides. */
export function initChartPageGuides(pageIndex: () => number) {
  if (getShownPage) return;
  getShownPage = pageIndex;
  shownPage = pageIndex();
  scene.onBeforeRenderObservable.add(() => {
    if (getShownPage) showChartPageGuides(getShownPage());
  });
}

/** Whether the field's guides can be swapped now (nothing drawn or held). */
export function canSwapChartPageGuides(): boolean {
  return !areDrawingGuidesBusy();
}

/**
 * A blank page was inserted after `afterPage` and is now shown: later pages'
 * guides move up one index and the new page starts with no guides.
 */
export function insertChartPageGuides(afterPage: number): boolean {
  const previous = swapDrawingGuides([]);
  if (!previous) return false;
  const shifted = [...storedGuides].map(([page, guides]): [number, WorkspaceGuide[]] =>
    [page > afterPage ? page + 1 : page, guides]);
  storedGuides.clear();
  shifted.forEach(([page, guides]) => store(page, guides));
  store(shownPage > afterPage ? shownPage + 1 : shownPage, previous);
  shownPage = afterPage + 1;
  storedGuides.delete(shownPage);
  return true;
}

/** Forgets the guides of pages not shown (e.g. a different show was loaded). */
export function forgetOtherChartPageGuides() {
  storedGuides.clear();
  if (getShownPage) shownPage = getShownPage();
}

/** Guides of every page not shown, serialized with the current drafting settings. */
export function captureChartPageGuides(): { shown: number; pages: SavedPageGuides[] } {
  const current = exportDrawingWorkspace();
  const settings = current ? parseDraftingWorkspace(current).settings : null;
  const pages = settings ? [...storedGuides].sort(([a], [b]) => a - b).map(([page, guides]) => ({
    page, drafting: serializeDraftingWorkspace({ version: 1, guides, settings }),
  })) : [];
  return { shown: shownPage, pages };
}

/**
 * Replaces the other pages' guides from a saved draft whose field guides
 * (already imported) belong to page `shown`. Returns an error message for
 * pages that could not be read; those pages start empty.
 */
export function restoreChartPageGuides(shown: number, pages: readonly SavedPageGuides[]): true | string {
  storedGuides.clear();
  shownPage = shown;
  const failed: number[] = [];
  for (const saved of pages) {
    if (saved.page === shown) continue;
    try {
      store(saved.page, parseDraftingWorkspace(saved.drafting).guides);
    } catch {
      failed.push(saved.page + 1);
    }
  }
  return failed.length === 0 ? true : `Guides for page ${failed.join(', ')} could not be read.`;
}
