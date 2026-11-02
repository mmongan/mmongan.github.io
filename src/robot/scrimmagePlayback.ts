// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { scene } from '../scene/engine';
import { getDrillTransportState, playAll } from './robot';

export function onScrimmageReturnComplete(canRestore: () => boolean, restoreBand: () => void) {
  let lastTransport = getDrillTransportState();
  let completed = false;
  const observer = scene.onAfterRenderObservable.add(() => {
    const transport = getDrillTransportState();
    const forwardPlayback = transport.playing && transport.beatsPerSecond > 0 ||
      lastTransport.playing && lastTransport.beatsPerSecond > 0 && lastTransport.revision === transport.revision;
    if (forwardPlayback && transport.lastBeat > 0 && transport.beat >= transport.lastBeat) completed = true;
    lastTransport = transport;
    if (completed && canRestore()) restoreBand();
  });
  return () => { scene.onAfterRenderObservable.remove(observer); };
}

export function resumeBandAfterPause(canResume: () => boolean, notify: (message: string) => void) {
  const pausedBand = getDrillTransportState();
  const restartAt = performance.now() + 3000;
  const dispose = () => { scene.onAfterRenderObservable.remove(observer); };
  const observer = scene.onAfterRenderObservable.add(() => {
    const current = getDrillTransportState();
    if (current.playing || current.revision !== pausedBand.revision || current.beat !== pausedBand.beat) {
      dispose();
      return;
    }
    if (performance.now() < restartAt || !canResume()) return;
    dispose();
    playAll();
    notify('Band restored: running the original drill.');
  });
  notify('Band restored: pausing for 3 seconds before running the original drill.');
  return dispose;
}
