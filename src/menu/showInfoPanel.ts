import type { OpenMarchImportedDrill } from '../robot/openMarchFormat';
import { getGlobalCountIndex, pauseAll, seekToCount } from '../robot/robot';
import { marcherInstrumentRadios, showInfo, showInfoMarchers, showInfoPages, showInfoSummary } from '../ui/dom';

// Settings panel summary of an opened OpenMarch show: its pages (click one to
// jump to that set) and its marchers with the instrument each one holds.

let pageCounts: number[] = [];
let highlightTimer: number | undefined;

function instrumentName(value: string): string {
  const radio = marcherInstrumentRadios.find((input) => input.value === value);
  return radio?.parentElement?.querySelector("span")?.textContent ?? value;
}

function cell(row: HTMLTableRowElement, text: string) {
  row.insertCell().textContent = text;
}

function currentPageIndex(): number {
  const count = getGlobalCountIndex();
  let index = 0;
  pageCounts.forEach((pageCount, pageIndex) => {
    if (count >= pageCount) index = pageIndex;
  });
  return index;
}

function highlightCurrentPage() {
  const current = currentPageIndex();
  Array.from(showInfoPages?.rows ?? []).forEach((row, index) => row.classList.toggle("current", index === current));
}

function updateHighlightTimer() {
  window.clearInterval(highlightTimer);
  highlightTimer = undefined;
  if (showInfo && !showInfo.hidden && showInfo.open) {
    highlightCurrentPage();
    highlightTimer = window.setInterval(highlightCurrentPage, 250);
  }
}

showInfo?.addEventListener("toggle", updateHighlightTimer);

export function clearShowInfo() {
  pageCounts = [];
  if (showInfo) showInfo.hidden = true;
  showInfoPages?.replaceChildren();
  showInfoMarchers?.replaceChildren();
  updateHighlightTimer();
}

// `instruments` holds the OpenChartxr instrument given to each marcher.
export function setShowInfo(showName: string, drill: OpenMarchImportedDrill, instruments: string[], tempoBpm: number) {
  clearShowInfo();
  if (!showInfo || !showInfoPages || !showInfoMarchers) return;
  const pagesBody = showInfoPages;
  const marchersBody = showInfoMarchers;
  pageCounts = drill.pages.map((page) => page.count);
  const lastCount = drill.tracks[0]?.length ? drill.tracks[0].length - 1 : 0;
  if (showInfoSummary) {
    showInfoSummary.textContent = `${showName}: ${drill.marchers.length} marchers, ${drill.pages.length} pages, ` +
      `${lastCount} counts, ${Math.round(tempoBpm)} BPM`;
  }

  drill.pages.forEach((page, index) => {
    const row = pagesBody.insertRow();
    row.className = "page-row";
    row.tabIndex = 0;
    cell(row, page.name);
    cell(row, String(page.count));
    cell(row, index === 0 ? "—" : String(page.count - drill.pages[index - 1].count));
    cell(row, page.notes);
    const jump = () => {
      pauseAll();
      seekToCount(page.count);
      highlightCurrentPage();
    };
    row.addEventListener("click", jump);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      jump();
    });
  });

  drill.marchers.forEach((marcher, index) => {
    const row = marchersBody.insertRow();
    cell(row, marcher.label);
    cell(row, marcher.name);
    cell(row, marcher.section);
    cell(row, instrumentName(instruments[index] ?? ""));
    if (marcher.notes) row.title = marcher.notes;
  });

  showInfo.hidden = false;
  updateHighlightTimer();
}
