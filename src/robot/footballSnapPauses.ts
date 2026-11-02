// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { scene } from '../scene/engine';
import { getDrillTransportState, pauseAll, playAll, seekToCount } from './robot';
import { floorCalibrationToggle, footballStatus } from '../ui/dom';
import type { FootballBallEvent } from './footballPlayGeometry';

export function initFootballSnapPauses(events: readonly FootballBallEvent[]) {
  const paused = new Set<FootballBallEvent>();
  let previous = getDrillTransportState();
  let pending: { deadline: number; revision: number; beat: number } | null = null;
  const observer = scene.onAfterRenderObservable.add(() => {
    const transport = getDrillTransportState();
    if (pending) {
      if (transport.playing || transport.revision !== pending.revision || transport.beat !== pending.beat) {
        pending = null;
      } else {
        if (footballStatus) footballStatus.value = 'At the snap: 3-second pause before the play.';
        if (performance.now() >= pending.deadline && !floorCalibrationToggle?.checked) {
          pending = null;
          playAll();
        }
      }
      previous = getDrillTransportState();
      return;
    }
    if (transport.beat < previous.beat) {
      for (const event of paused) if (event.startCount >= transport.beat) paused.delete(event);
    }
    const snap = transport.playing && transport.beatsPerSecond > 0 && !floorCalibrationToggle?.checked
      ? events.find(event => event.kind === 'snap' && !paused.has(event) &&
        (transport.beat === event.startCount || transport.revision === previous.revision &&
          previous.beat < event.startCount && transport.beat >= event.startCount)) : null;
    if (snap) {
      paused.add(snap);
      pauseAll();
      seekToCount(snap.startCount);
      const stopped = getDrillTransportState();
      pending = { deadline: performance.now() + 3000, revision: stopped.revision, beat: stopped.beat };
      if (footballStatus) footballStatus.value = 'At the snap: 3-second pause before the play.';
    }
    previous = getDrillTransportState();
  });
  return () => { scene.onAfterRenderObservable.remove(observer); };
}
