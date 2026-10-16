import { ghostBandStatus, ghostBandTimeline, ghostBandToggle } from '../ui/dom';
import {
  getDrillTransportState, getGhostBandAnchorBeat, isGhostBandPreviewEnabled,
  onDrillTransportChangedObservable, seekToCount, setGhostBandPreviewEnabled,
} from '../robot/robot';

export function initGhostBandControls() {
  const refresh = () => {
    const active = isGhostBandPreviewEnabled();
    const transport = getDrillTransportState();
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
