export interface ChartPageTimeline {
  beatsPerPage: number;
  authoredCounts: number[];
}

let timeline: ChartPageTimeline = { beatsPerPage: 8, authoredCounts: [] };

export function getChartPageTimeline(): ChartPageTimeline {
  return { beatsPerPage: timeline.beatsPerPage, authoredCounts: [...timeline.authoredCounts] };
}

export function setChartPageTimeline(value: ChartPageTimeline) {
  if (!Number.isInteger(value.beatsPerPage) || value.beatsPerPage < 1 || value.beatsPerPage > 64 ||
    value.authoredCounts.some(count => !Number.isInteger(count) || count < 0 || count > 20000)) {
    throw new RangeError('Chart pages require 1–64 beats per page and valid authored counts.');
  }
  timeline = { beatsPerPage: value.beatsPerPage, authoredCounts: [...new Set(value.authoredCounts)].sort((a, b) => a - b) };
}

export function getChartPageCounts(last: number): number[] {
  const counts = new Set([0, last]);
  for (let count = 0; count <= last; count += timeline.beatsPerPage) counts.add(count);
  timeline.authoredCounts.filter(count => count <= last).forEach(count => counts.add(count));
  return [...counts].sort((a, b) => a - b);
}

export function isAuthoredChartPage(count: number, last: number) {
  return count === 0 || count === last || timeline.authoredCounts.includes(count);
}

export function getAuthoredChartPageSpan(count: number, last: number) {
  const anchors = [...new Set([0, last, ...timeline.authoredCounts.filter(value => value <= last)])].sort((a, b) => a - b);
  const previous = anchors.filter(value => value < count);
  return { previous: previous[previous.length - 1] ?? count,
    next: anchors.find(value => value > count) ?? count };
}

export function authorChartPage(count: number) {
  setChartPageTimeline({ ...timeline, authoredCounts: [...timeline.authoredCounts, count] });
}

export function insertChartPageTimeline(after: number, beats: number) {
  setChartPageTimeline({ ...timeline, authoredCounts: [
    ...timeline.authoredCounts.map(count => count > after ? count + beats : count),
    after, after + beats,
  ] });
}
