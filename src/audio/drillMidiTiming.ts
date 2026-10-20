export function drillCountToMidiBeat(count: number, ticks: readonly number[], ppq: number): number {
  if (ticks.length < 2) return count + (ticks[0] ?? 0) / ppq;
  const index = Math.max(0, Math.min(ticks.length - 2, Math.floor(count)));
  return (ticks[index] + (count - index) * (ticks[index + 1] - ticks[index])) / ppq;
}

export function midiBeatToDrillCount(beat: number, ticks: readonly number[], ppq: number): number {
  if (ticks.length < 2) return beat - (ticks[0] ?? 0) / ppq;
  const tick = beat * ppq;
  let low = 0, high = ticks.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (ticks[middle] <= tick) low = middle;
    else high = middle;
  }
  return low + (tick - ticks[low]) / (ticks[low + 1] - ticks[low]);
}

export function midiBeatsPerDrillCount(count: number, ticks: readonly number[], ppq: number): number {
  if (ticks.length < 2) return 1;
  const index = Math.max(0, Math.min(ticks.length - 2, Math.floor(count)));
  return (ticks[index + 1] - ticks[index]) / ppq;
}
