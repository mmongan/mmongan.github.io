export interface MidiBeatUnit {
  beat: number;
  quarterNotesPerPulse: number;
  pulsesPerMeasure?: number;
}

export function midiBeatUnits(
  signatures: ReadonlyArray<{ ticks: number; timeSignature: number[] }>, ppq: number
): MidiBeatUnit[] {
  return signatures.map(({ ticks, timeSignature: [numerator, denominator] }) => {
    const compound = numerator >= 6 && numerator % 3 === 0;
    return {
      beat: ticks / ppq,
      quarterNotesPerPulse: (compound ? 3 : 1) * 4 / denominator,
      pulsesPerMeasure: compound ? numerator / 3 : numerator,
    };
  });
}

// 1-based measure and beat (in meter pulses) at a quarter-note MIDI beat.
// Defaults to 4/4 before the first time signature; signatures are assumed to start on bar lines.
export function midiMeasureAtBeat(beat: number, units: ReadonlyArray<MidiBeatUnit>) {
  let start = 0;
  let unit = 1;
  let perMeasure = 4;
  let measures = 0;
  for (const change of units) {
    if (change.beat > beat) break;
    measures += Math.ceil((change.beat - start) / unit / perMeasure - 1e-6);
    start = change.beat;
    unit = change.quarterNotesPerPulse;
    perMeasure = change.pulsesPerMeasure ?? perMeasure;
  }
  const pulses = Math.max(0, beat - start) / unit;
  const inMeasure = Math.floor(pulses / perMeasure + 1e-9);
  return { measure: measures + inMeasure + 1, beat: pulses - inMeasure * perMeasure + 1 };
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
