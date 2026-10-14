export const SCORE_MEASURE_WIDTH = 760;
export const SCORE_PAGE_WIDTH = 1456;
export const SCORE_PAGE_HEIGHT = 1110;
const MEASURE_LABEL_HEIGHT = 24;

export function scoreMeasuresPerPage(trackCount: number, standScale: number, config: 'auto' | number): number {
  if (typeof config === 'number') return Math.max(1, Math.min(8, config));
  if (trackCount <= 1) {
    if (standScale >= 1.4) return 6;
    if (standScale <= 0.8) return 2;
    return 4;
  }
  if (trackCount <= 4) {
    if (standScale >= 1.25) return 4;
    if (standScale <= 0.8) return 1;
    return 2;
  }
  const systemHeight = 145 + (trackCount - 1) * 95;
  const measuresAcross = systemHeight * SCORE_PAGE_WIDTH / SCORE_PAGE_HEIGHT / SCORE_MEASURE_WIDTH;
  return Math.max(2, Math.min(8, Math.round(measuresAcross * standScale)));
}

export function layoutScorePage(heights: readonly number[], width = SCORE_PAGE_WIDTH, height = SCORE_PAGE_HEIGHT) {
  if (!heights.length) return { columns: 1, scale: 1, cells: [] };
  let bestColumns = 1;
  let bestScale = 0;
  let bestRowHeights: number[] = [];
  for (let columns = 1; columns <= heights.length; columns++) {
    const rowHeights: number[] = [];
    heights.forEach((measureHeight, index) => {
      const row = Math.floor(index / columns);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, measureHeight + MEASURE_LABEL_HEIGHT);
    });
    const scale = Math.min(width / (columns * SCORE_MEASURE_WIDTH),
      height / rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0));
    if (scale > bestScale) {
      bestColumns = columns;
      bestScale = scale;
      bestRowHeights = rowHeights;
    }
  }
  const left = (width - bestColumns * SCORE_MEASURE_WIDTH * bestScale) / 2;
  const cells = heights.map((measureHeight, index) => {
    const row = Math.floor(index / bestColumns);
    return {
      x: left + index % bestColumns * SCORE_MEASURE_WIDTH * bestScale,
      y: bestRowHeights.slice(0, row).reduce((sum, rowHeight) => sum + rowHeight, 0) * bestScale,
      width: SCORE_MEASURE_WIDTH * bestScale,
      height: measureHeight * bestScale,
      labelHeight: MEASURE_LABEL_HEIGHT * bestScale,
    };
  });
  return { columns: bestColumns, scale: bestScale, cells };
}
