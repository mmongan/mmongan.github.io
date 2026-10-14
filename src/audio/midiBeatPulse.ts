export interface MidiBeatUnit {
  beat: number;
  quarterNotesPerPulse: number;
}

export function midiBeatUnits(
  signatures: ReadonlyArray<{ ticks: number; timeSignature: number[] }>, ppq: number
): MidiBeatUnit[] {
  return signatures.map(({ ticks, timeSignature: [numerator, denominator] }) => ({
    beat: ticks / ppq,
    quarterNotesPerPulse: (numerator >= 6 && numerator % 3 === 0 ? 3 : 1) * 4 / denominator,
  }));
}

export function midiPulseAtBeat(beat: number, units: ReadonlyArray<MidiBeatUnit>): number {
  let start = 0;
  let unit = 1;
  let pulse = 0;
  for (const change of units) {
    if (change.beat > beat) break;
    pulse += (change.beat - start) / unit;
    start = change.beat;
    unit = change.quarterNotesPerPulse;
  }

  return pulse + (beat - start) / unit;
}

export function midiBeatAtPulse(pulse: number, units: ReadonlyArray<MidiBeatUnit>): number {
  let start = 0;
  let unit = 1;
  let startPulse = 0;
  for (const change of units) {
    const nextPulse = startPulse + (change.beat - start) / unit;
    if (nextPulse > pulse) break;
    startPulse = nextPulse;
    start = change.beat;
    unit = change.quarterNotesPerPulse;
  }
  return start + (pulse - startPulse) * unit;
}
