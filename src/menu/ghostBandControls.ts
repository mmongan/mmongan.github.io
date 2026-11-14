// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ghostBandStatus, ghostBandTimeline, ghostBandToggle } from '../ui/dom';
import {
  getDrillTransportState, getGhostBandAnchorBeat, isGhostBandPreviewEnabled,
  onDrillTransportChangedObservable, seekToCount, setGhostBandPreviewEnabled,
} from '../robot/robot';

export function initGhostBandControls() {
  // Transport notifications arrive every frame; only touch the DOM (and
  // build the strings) when a displayed value actually changed.
  let lastKey = '';
  const refresh = (transport = getDrillTransportState()) => {
    const active = isGhostBandPreviewEnabled();
    const key = `${active}:${transport.beat}:${transport.lastBeat}:${active ? getGhostBandAnchorBeat() : 0}`;
    if (key === lastKey) return;
    lastKey = key;
    if (ghostBandToggle) ghostBandToggle.checked = active;
    if (ghostBandTimeline) {
      ghostBandTimeline.disabled = !active;
      ghostBandTimeline.max = String(transport.lastBeat);
      ghostBandTimeline.value = String(transport.beat);
    }
    if (ghostBandStatus) ghostBandStatus.textContent = active
      ? `Real band paused at count ${getGhostBandAnchorBeat().toFixed(1)}. Ghost count: ${transport.beat.toFixed(1)}.`
      : 'Ghost comparison off.';
  };
  ghostBandToggle?.addEventListener('change', () => {
    if (ghostBandToggle) setGhostBandPreviewEnabled(ghostBandToggle.checked);
  });
  ghostBandTimeline?.addEventListener('input', () => {
    if (ghostBandTimeline && isGhostBandPreviewEnabled()) seekToCount(Number(ghostBandTimeline.value));
  });
  onDrillTransportChangedObservable.add(refresh);
  refresh();
}
