import {
  midiScoreDetails, midiScoreTrack, midiScoreFollow, midiScorePrevious,
  midiScoreNext, midiScoreStatus, midiScoreCanvas, musicScoreMeasuresSelect,
} from '../ui/dom';
import { getMusicTransportState, onDrillTransportChangedObservable } from '../robot/robot';
import {
  scoreBeatPositionsMulti, scoreMeasure, scoreMeasureCount,
  scorePitch, type ScoreTrack, type ScoreSegment,
} from './midiNotation';
import { Observable } from '@babylonjs/core/Misc/observable.pure';
import { layoutScorePage, scoreMeasuresPerPage } from './scoreLayout';

export interface MidiScoreDisplay {
  rows: { svg: string; height: number; measure: number; beatPositions: number[] }[];
  trackName: string;
  currentMeasure: number;
  currentBeat: number;
  message: string;
}

export const onMidiScoreDisplayChanged = new Observable<MidiScoreDisplay>();
let standVisible = false;
let display: MidiScoreDisplay = { rows: [], trackName: '', currentMeasure: 0, currentBeat: 0, message: 'No MIDI loaded.' };

function publishDisplay() {
  display.currentMeasure = currentMeasure;
  display.currentBeat = currentBeat;
  onMidiScoreDisplayChanged.notifyObservers(display);
}

export function setMidiScoreStandVisible(visible: boolean) {
  standVisible = visible;
  publishDisplay();
  if (visible) {
    updateScoreTransport();
    void renderScore();
  }
}

let tracks: (ScoreTrack & { measureCount: number })[] = [];
let page = 0;
let renderRequest = 0;
let currentMeasure = 0;
let currentBeat = 0;
let standScale = 1.0;
let measuresConfig: 'auto' | number = 'auto';

export function setScoreStandScale(scale: number) {
  if (Math.abs(standScale - scale) < 0.01) return;
  const prevMeasures = getMeasuresPerPage(getActiveTracks().length);
  standScale = scale;
  const nextMeasures = getMeasuresPerPage(getActiveTracks().length);
  if (prevMeasures !== nextMeasures) {
    const activeTracks = getActiveTracks();
    const total = getTotalMeasures(activeTracks);
    page = Math.floor(Math.min(currentMeasure, total - 1) / nextMeasures);
    void renderScore();
  }
}

export function setScoreMeasuresConfig(config: 'auto' | number) {
  if (measuresConfig === config) return;
  measuresConfig = config;
  const activeTracks = getActiveTracks();
  const measures = getMeasuresPerPage(activeTracks.length);
  const total = getTotalMeasures(activeTracks);
  page = Math.floor(Math.min(currentMeasure, total - 1) / measures);
  void renderScore();
}

export function getScoreMeasuresConfig(): 'auto' | number {
  return measuresConfig;
}

export function getEffectiveMeasuresPerPage(): number {
  return getMeasuresPerPage(getActiveTracks().length);
}

function isFullScore(): boolean {
  return tracks.length > 1 && (midiScoreTrack?.value === 'full' || !midiScoreTrack?.value);
}

function getActiveTracks(): (ScoreTrack & { measureCount: number })[] {
  if (!tracks.length) return [];
  if (isFullScore()) return tracks;
  const index = Math.max(0, Math.min(tracks.length - 1, Number(midiScoreTrack?.value ?? 0)));
  return [tracks[index]];
}

function getMeasuresPerPage(trackCount: number): number {
  return scoreMeasuresPerPage(trackCount, standScale, measuresConfig);
}

function getTotalMeasures(activeTracks = getActiveTracks()): number {
  return Math.max(1, ...activeTracks.map(t => t.measureCount));
}

function formatTrackLabel(name: string): string {
  const cleaned = name.replace(/^\d+\.\s*/, '').replace(/:$/, '').trim();
  if (!cleaned) return name;
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return capitalized.length > 9 ? capitalized.slice(0, 8) + '…' : capitalized;
}

function highlightMeasure() {
  midiScoreCanvas?.querySelectorAll<HTMLElement>('[data-measure]').forEach(element => {
    const current = Number(element.dataset.measure) === currentMeasure;
    if (current && !element.classList.contains('current-measure') && midiScoreFollow?.checked && midiScoreCanvas) {
      midiScoreCanvas.scrollTop = element.offsetTop;
      midiScoreCanvas.scrollLeft = element.offsetLeft;
    }
    element.classList.toggle('current-measure', current);
  });
  midiScoreCanvas?.querySelectorAll<SVGElement>('[data-score-beat]').forEach(marker => {
    marker.style.display = Number(marker.dataset.scoreBeat) === currentBeat ? '' : 'none';
  });
}

async function renderScore() {
  const request = ++renderRequest;
  const activeTracks = getActiveTracks();
  const container = midiScoreCanvas;
  if (!activeTracks.length || !container || (!midiScoreDetails?.open && !standVisible)) return;
  const total = getTotalMeasures(activeTracks);
  const measuresPerPage = getMeasuresPerPage(activeTracks.length);
  page = Math.max(0, Math.min(page, Math.ceil(total / measuresPerPage) - 1));
  const first = page * measuresPerPage;
  if (midiScorePrevious) midiScorePrevious.disabled = page === 0;
  if (midiScoreNext) midiScoreNext.disabled = first + measuresPerPage >= total;
  if (midiScoreStatus) midiScoreStatus.textContent = 'Rendering sheet music...';
  try {
    const { Renderer, Stave, StaveConnector, StaveNote, Voice, Formatter, Accidental, StaveTie } = await import('vexflow');
    if (request !== renderRequest) return;
    const fragment = document.createDocumentFragment();
    const scoreRows: MidiScoreDisplay['rows'] = [];
    const fullScore = activeTracks.length > 1;
    const clefs = activeTracks.map(track =>
      track.notes.length && (track.notes.reduce((sum, note) => sum + note.pitch, 0) / track.notes.length < 60)
        ? 'bass' : 'treble');
    const staveX = fullScore ? 85 : 10;
    const staveWidth = fullScore ? 660 : 740;
    const durations: Record<number, string> = { 16: 'w', 8: 'h', 4: 'q', 2: '8', 1: '16' };

    const previousByTrack: ({ note: InstanceType<typeof StaveNote>; pitches: number[] } | undefined)[] =
      activeTracks.map(() => undefined);

    for (let measure = first; measure < Math.min(first + measuresPerPage, total); measure++) {
      let staveY0 = 35;
      let height = 150;
      const staveSpacing = 95;

      const segmentsByTrack = activeTracks.map(track => scoreMeasure(track, measure));

      if (fullScore) {
        const topClef = clefs[0];
        const topDiatonic = topClef === 'treble' ? 38 : 26;
        const topPositions = segmentsByTrack[0].flatMap(s => s.pitches.map(p => scorePitch(p).diatonic));
        const topOffset = Math.max(0, Math.max(topDiatonic, ...topPositions) - topDiatonic) * 4;

        const bottomClef = clefs[clefs.length - 1];
        const bottomDiatonic = bottomClef === 'treble' ? 38 : 26;
        const bottomPositions = segmentsByTrack[segmentsByTrack.length - 1].flatMap(s => s.pitches.map(p => scorePitch(p).diatonic));
        const bottomOffset = Math.max(0, bottomDiatonic - 8 - Math.min(bottomDiatonic - 8, ...bottomPositions)) * 4;

        staveY0 = 25 + Math.min(25, topOffset);
        height = staveY0 + (activeTracks.length - 1) * staveSpacing + 85 + Math.min(25, bottomOffset);
      } else {
        const clef = clefs[0];
        const top = clef === 'treble' ? 38 : 26;
        const positions = segmentsByTrack[0].flatMap(s => s.pitches.map(p => scorePitch(p).diatonic));
        staveY0 = 35 + Math.max(0, Math.max(top, ...positions) - top) * 5;
        height = staveY0 + 100 + Math.max(0, top - 8 - Math.min(top - 8, ...positions)) * 5;
      }

      const row = document.createElement('div');
      row.className = 'midi-score-measure';
      row.dataset.measure = String(measure);
      row.setAttribute('aria-label', `${fullScore ? 'Full score' : activeTracks[0].name}, measure ${measure + 1}, drill counts ${measure * 4} to ${measure * 4 + 4}`);
      fragment.append(row);

      const renderer = new Renderer(row, Renderer.Backends.SVG);
      renderer.resize(760, height);
      const context = renderer.getContext();

      const staves = activeTracks.map((_, i) => {
        const y = staveY0 + i * staveSpacing;
        const stave = new Stave(staveX, y, staveWidth).addClef(clefs[i]).addTimeSignature('4/4');
        stave.setContext(context).draw();
        return stave;
      });

      if (fullScore) {
        const topStave = staves[0];
        const bottomStave = staves[staves.length - 1];

        const lineLeft = new StaveConnector(topStave, bottomStave);
        lineLeft.setType(StaveConnector.type.SINGLE_LEFT);
        lineLeft.setContext(context).draw();

        const lineRight = new StaveConnector(topStave, bottomStave);
        lineRight.setType(StaveConnector.type.SINGLE_RIGHT);
        lineRight.setContext(context).draw();

        const bracket = new StaveConnector(topStave, bottomStave);
        bracket.setType(activeTracks.length === 2 ? StaveConnector.type.BRACE : StaveConnector.type.BRACKET);
        bracket.setContext(context).draw();
      }

      const voices: InstanceType<typeof Voice>[] = [];
      const notesByTrack: InstanceType<typeof StaveNote>[][] = [];

      for (let i = 0; i < activeTracks.length; i++) {
        const clef = clefs[i];
        const stave = staves[i];
        const segments = segmentsByTrack[i];

        const notes = segments.map(segment => {
          const note = new StaveNote({
            clef,
            keys: segment.pitches.length ? segment.pitches.map(pitch => scorePitch(pitch).key)
              : [clef === 'bass' ? 'd/3' : 'b/4'],
            duration: durations[segment.ticks] + (segment.pitches.length ? '' : 'r'),
          });
          segment.pitches.forEach((pitch, index) =>
            note.addModifier(new Accidental(scorePitch(pitch).accidental), index));
          note.setStave(stave);
          return note;
        });

        const voice = new Voice({ num_beats: 4, beat_value: 4 }).addTickables(notes);
        voices.push(voice);
        notesByTrack.push(notes);
      }

      const formatter = new Formatter();
      voices.forEach(voice => formatter.joinVoices([voice]));
      formatter.formatToStave(voices, staves[0]);

      voices.forEach((voice, i) => {
        voice.draw(context, staves[i]);
      });

      for (let i = 0; i < activeTracks.length; i++) {
        const track = activeTracks[i];
        const notes = notesByTrack[i];
        const segments = segmentsByTrack[i];
        let previous = previousByTrack[i];

        notes.forEach((note, index) => {
          const segment = segments[index];
          const tied = segment.tiedPitches.filter(pitch => !previous || previous.pitches.includes(pitch));
          if (tied.length) {
            new StaveTie({
              first_note: previous?.note,
              last_note: note,
              first_indices: tied.map(pitch => previous?.pitches.indexOf(pitch) ?? 0),
              last_indices: tied.map(pitch => segment.pitches.indexOf(pitch)),
            }).setContext(context).draw();
          }
          previous = segment.pitches.length ? { note, pitches: segment.pitches } : undefined;
        });

        const continuing = scoreMeasure(track, measure + 1)[0]?.tiedPitches ?? [];
        const last = previous;
        const outgoing = last?.pitches.filter(pitch => continuing.includes(pitch)) ?? [];
        if (last && outgoing.length) {
          new StaveTie({
            first_note: last.note,
            first_indices: outgoing.map(pitch => last.pitches.indexOf(pitch)),
            last_indices: outgoing.map(() => 0),
          }).setContext(context).draw();
        }
        previousByTrack[i] = previous;
      }

      const svg = row.querySelector('svg');
      svg?.setAttribute('role', 'img');
      svg?.setAttribute('aria-label', `${fullScore ? 'Full score' : activeTracks[0].name}, measure ${measure + 1}`);
      if (!svg) throw new Error('VexFlow did not create a score image.');

      if (fullScore) {
        activeTracks.forEach((track, i) => {
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.setAttribute('x', '8');
          label.setAttribute('y', String(staves[i].getY() + 24));
          label.setAttribute('font-family', 'Arial, sans-serif');
          label.setAttribute('font-size', '12');
          label.setAttribute('font-weight', 'bold');
          label.setAttribute('fill', '#475569');
          label.textContent = formatTrackLabel(track.name);
          svg.append(label);
        });
      }

      const tracksData = activeTracks.map((_, i) => ({
        segments: segmentsByTrack[i],
        notePositions: notesByTrack[i].map(n => n.getAbsoluteX()),
      }));
      const beatPositions = scoreBeatPositionsMulti(tracksData, staves[0].getNoteStartX(), staves[0].getNoteEndX());

      scoreRows.push({
        svg: new XMLSerializer().serializeToString(svg),
        height, measure, beatPositions,
      });

      beatPositions.forEach((x, beat) => {
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        marker.dataset.scoreBeat = String(measure * 4 + beat);
        marker.setAttribute('x1', String(x - 5));
        marker.setAttribute('x2', String(x - 5));
        marker.setAttribute('y1', '10');
        marker.setAttribute('y2', String(height - 10));
        marker.setAttribute('stroke', '#d97706');
        marker.setAttribute('stroke-width', '3');
        marker.style.display = 'none';
        svg.append(marker);
      });
    }

    const layout = layoutScorePage(scoreRows.map(row => row.height));
    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${layout.columns}, 760px)`;
    container.replaceChildren(fragment);
    const titleName = fullScore ? `Full score (${activeTracks.length} parts)` : activeTracks[0].name;
    display = {
      rows: scoreRows,
      trackName: titleName,
      currentMeasure,
      currentBeat,
      message: `Measures ${first + 1}-${Math.min(first + measuresPerPage, total)} of ${total}`,
    };
    publishDisplay();
    highlightMeasure();
    if (midiScoreStatus) {
      const hasPercussion = activeTracks.some(t => t.percussion);
      midiScoreStatus.textContent =
        `${titleName} Measures ${first + 1}-${Math.min(first + measuresPerPage, total)} of ${total}.` +
        (hasPercussion ? ' Percussion shown as MIDI pitches, not drum notation.' : '');
    }
  } catch (error) {
    if (request !== renderRequest) return;
    container.replaceChildren();
    const titleName = activeTracks.length > 1 ? `Full score (${activeTracks.length} parts)` : (activeTracks[0]?.name ?? '');
    const message = `Could not render sheet music: ${error instanceof Error ? error.message : String(error)}. Reopen the view to retry. MIDI audio is unaffected.`;
    if (midiScoreStatus) midiScoreStatus.textContent = message;
    display = { rows: [], trackName: titleName, currentMeasure, currentBeat, message };
    publishDisplay();
  }
}

export function setMidiScoreTracks(nextTracks: ScoreTrack[]) {
  renderRequest++;
  tracks = nextTracks.map(track => ({ ...track, measureCount: scoreMeasureCount(track) }));
  page = 0;
  midiScoreCanvas?.replaceChildren();
  display = { rows: [], trackName: '', currentMeasure, currentBeat, message: tracks.length ? 'Rendering sheet music...' : 'No MIDI loaded.' };
  publishDisplay();
  const options: HTMLOptionElement[] = [];
  if (tracks.length > 1) {
    const fullOption = document.createElement('option');
    fullOption.value = 'full';
    fullOption.textContent = `Full score (${tracks.length} parts)`;
    options.push(fullOption);
  }
  tracks.forEach((track, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = track.name;
    options.push(option);
  });
  midiScoreTrack?.replaceChildren(...options);
  if (midiScoreTrack) {
    midiScoreTrack.disabled = !tracks.length;
    if (tracks.length > 1) {
      midiScoreTrack.value = 'full';
    } else if (tracks.length === 1) {
      midiScoreTrack.value = '0';
    }
  }
  if (midiScorePrevious) midiScorePrevious.disabled = true;
  if (midiScoreNext) midiScoreNext.disabled = true;
  if (midiScoreStatus) midiScoreStatus.textContent = tracks.length ? 'Open sheet music to view the loaded MIDI.' : 'No MIDI loaded.';
  updateScoreTransport();
  void renderScore();
}

function updateScoreTransport() {
  const nextBeat = Math.floor(getMusicTransportState().beat);
  const changed = nextBeat !== currentBeat;
  currentBeat = nextBeat;
  currentMeasure = Math.floor(nextBeat / 4);
  const activeTracks = getActiveTracks();
  if (!activeTracks.length || (!midiScoreDetails?.open && !standVisible)) return;
  const total = getTotalMeasures(activeTracks);
  const measuresPerPage = getMeasuresPerPage(activeTracks.length);
  const nextPage = Math.floor(Math.min(currentMeasure, total - 1) / measuresPerPage);
  if (midiScoreFollow?.checked && nextPage !== page) {
    page = nextPage;
    void renderScore();
  } else {
    highlightMeasure();
    if (changed) publishDisplay();
  }
}

export function initMidiScore() {
  midiScoreDetails?.addEventListener('toggle', () => {
    if (midiScoreDetails?.open) {
      updateScoreTransport();
      void renderScore();
    } else if (!standVisible) renderRequest++;
  });
  midiScoreTrack?.addEventListener('change', () => {
    const activeTracks = getActiveTracks();
    const total = getTotalMeasures(activeTracks);
    const measuresPerPage = getMeasuresPerPage(activeTracks.length);
    page = Math.floor(Math.min(currentMeasure, total - 1) / measuresPerPage);
    updateScoreTransport();
    void renderScore();
  });
  midiScoreFollow?.addEventListener('change', () => {
    updateScoreTransport();
    void renderScore();
  });
  musicScoreMeasuresSelect?.addEventListener('change', () => {
    if (!musicScoreMeasuresSelect) return;
    const val = musicScoreMeasuresSelect.value;
    setScoreMeasuresConfig(val === 'auto' ? 'auto' : Number(val));
  });
  const browse = (offset: number) => {
    if (midiScoreFollow) midiScoreFollow.checked = false;
    page += offset;
    void renderScore();
  };
  midiScorePrevious?.addEventListener('click', () => browse(-1));
  midiScoreNext?.addEventListener('click', () => browse(1));
  onDrillTransportChangedObservable.add(updateScoreTransport);
}
