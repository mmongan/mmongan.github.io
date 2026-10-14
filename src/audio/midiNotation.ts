export interface ScoreNote {
  start: number;
  end: number;
  pitch: number;
}

export interface ScoreTrack {
  name: string;
  percussion: boolean;
  notes: ScoreNote[];
}

export interface ScoreSegment {
  ticks: number;
  pitches: number[];
  tiedPitches: number[];
}

export function quantizeScoreNote(beat: number, duration: number, pitch: number): ScoreNote {
  const start = Math.round(beat * 4);
  return { start, end: Math.max(start + 1, Math.round((beat + duration) * 4)), pitch };
}

export function scoreMeasureCount(track: ScoreTrack): number {
  return Math.max(1, Math.ceil(track.notes.reduce((end, note) => Math.max(end, note.end), 0) / 16));
}

// MIDI has no engraving voices: a sixteenth-note sweep turns overlapping notes into tied chords.
export function scoreMeasure(track: ScoreTrack, measure: number): ScoreSegment[] {
  const start = measure * 16;
  const notes = track.notes.filter(note => note.start < start + 16 && note.end > start);
  const slots = Array.from({ length: 16 }, (_, tick) =>
    notes.filter(note => note.start <= start + tick && note.end > start + tick));
  const result: ScoreSegment[] = [];
  let tick = 0;
  while (tick < 16) {
    const active = slots[tick];
    let end = tick + 1;
    while (end < 16 && slots[end].length === active.length &&
      slots[end].every((note, i) => note === active[i])) end++;
    while (tick < end) {
      let ticks = 16;
      while (ticks > end - tick || tick % ticks !== 0) ticks /= 2;
      result.push({
        ticks,
        pitches: [...new Set(active.map(note => note.pitch))].sort((a, b) => a - b),
        tiedPitches: [...new Set(active.filter(note => note.start < start + tick &&
          !active.some(other => other.pitch === note.pitch && other.start === start + tick))
          .map(note => note.pitch))],
      });
      tick += ticks;
    }
  }
  return result;
}

export function scorePitch(pitch: number): { key: string; accidental: string; diatonic: number } {
  const names = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const name = names[pitch % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return {
    key: `${name}/${octave}`,
    accidental: name.endsWith('#') ? '#' : 'n',
    diatonic: octave * 7 + 'cdefgab'.indexOf(name[0]),
  };
}

export function scoreBeatPositions(segments: ScoreSegment[], notePositions: number[], endX: number): number[] {
  if (segments.length !== notePositions.length || segments.reduce((sum, segment) => sum + segment.ticks, 0) !== 16) {
    throw new Error('Score measure has incomplete beat spacing.');
  }
  return Array.from({ length: 4 }, (_, beat) => {
    const targetTick = beat * 4;
    let tick = 0;
    for (let index = 0; index < segments.length; index++) {
      const end = tick + segments[index].ticks;
      if (targetTick < end) {
        const x = notePositions[index];
        const nextX = notePositions[index + 1] ?? endX;
        return x + (nextX - x) * (targetTick - tick) / segments[index].ticks;
      }
      tick = end;
    }
    throw new Error('Score measure has incomplete beat spacing.');
  });
}

export function scoreBeatPositionsMulti(
  tracksData: { segments: ScoreSegment[]; notePositions: number[] }[],
  noteStartX: number,
  noteEndX: number
): number[] {
  if (!tracksData.length) {
    throw new Error('Score measure has incomplete beat spacing.');
  }
  const beatX: (number | undefined)[] = [undefined, undefined, undefined, undefined];
  for (const { segments, notePositions } of tracksData) {
    let tick = 0;
    for (let i = 0; i < segments.length; i++) {
      if (tick % 4 === 0) {
        const beat = tick / 4;
        if (beat < 4 && beatX[beat] === undefined && notePositions[i] !== undefined) {
          beatX[beat] = notePositions[i];
        }
      }
      tick += segments[i].ticks;
    }
  }

  beatX[0] ??= noteStartX;

  for (let b = 1; b < 4; b++) {
    if (beatX[b] === undefined) {
      let prevBeat = b - 1;
      while (prevBeat > 0 && beatX[prevBeat] === undefined) prevBeat--;
      const prevX = beatX[prevBeat]!;

      let nextBeat = b + 1;
      while (nextBeat < 4 && beatX[nextBeat] === undefined) nextBeat++;
      const nextX = nextBeat < 4 ? beatX[nextBeat]! : noteEndX;

      beatX[b] = prevX + (nextX - prevX) * ((b - prevBeat) / (nextBeat - prevBeat));
    }
  }

  return beatX as number[];
}

