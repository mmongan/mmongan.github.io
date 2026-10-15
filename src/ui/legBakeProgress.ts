import { getLegAnimationBakeStatus, startLegAnimationPrebake, cancelLegAnimationPrebake } from '../robot/robot';
import { legBakeDetails, legBakeLabel, legBakePanel, legBakeProgress, legPrebakeButton } from './dom';

export function formatLegBakeProgress(status: ReturnType<typeof getLegAnimationBakeStatus>) {
  const { completedCounts, totalCounts, pending, sharedBytes, memoryLimited } = status;
  const percent = totalCounts > 0 ? Math.min(100, 100 * completedCounts / totalCounts) : 0;
  const displayedPercent = pending > 0 ? Math.min(99.9, Math.floor(percent * 10) / 10) : percent;
  const label = memoryLimited > 0
    ? pending > 0 ? `Baking legs - ${displayedPercent.toFixed(1)}% (memory limit)` : 'Leg bake limited by memory'
    : pending > 0 ? `${status.prebaking ? 'Prebaking show' : 'Baking legs'} - ${displayedPercent.toFixed(1)}%` : 'Leg bake ready';
  const details = `${completedCounts.toLocaleString()} / ${totalCounts.toLocaleString()} marcher-counts processed` +
    ` | ${(sharedBytes / (1024 * 1024)).toFixed(2)} MiB shared poses` +
    (status.reusedBakes > 0 ? ` | ${status.reusedBakes} marchers reuse baking` : '') +
    (status.reusedCycles > 0 ? ` | ${status.reusedCycles.toLocaleString()} cycle sections reused` : '') +
    (memoryLimited > 0 ? ' | Remaining intervals use live IK.' : '');
  const hits = status.bakedPoseHits ?? 0;
  const misses = status.bakedPoseMisses ?? 0;
  const hitRate = hits + misses > 0 ? `${(100 * hits / (hits + misses)).toFixed(1)}%` : '--';
  const reasons = status.bakedFallbacks;
  const breakdown = reasons
    ? `\nWaiting for bake: ${reasons.pending.toLocaleString()} | Accuracy fallback: ${reasons.accuracy.toLocaleString()}` +
      ` | Memory: ${reasons.memory.toLocaleString()} | Reverse boundary: ${reasons.reverseBoundary.toLocaleString()}`
    : '';
  const cache = `Baked pose hits: ${hits.toLocaleString()} (${hitRate}, session) | Live fallbacks: ${misses.toLocaleString()}` +
    breakdown +
    `\nCycles: ${(status.readyCycles ?? 0).toLocaleString()} ready / ${(status.uniqueCycles ?? 0).toLocaleString()} unique` +
    ` | ${(status.reusedCycles ?? 0).toLocaleString()} reused sections` +
    `\nRoute bakes: ${(status.uniqueBakes ?? 0).toLocaleString()} unique | ${(status.reusedBakes ?? 0).toLocaleString()} shared owners`;
  return { visible: totalCounts > 0, percent: displayedPercent, label, details, cache };
}

export function initLegBakeProgress(): () => void {
  const panel = legBakePanel;
  const label = legBakeLabel;
  const progress = legBakeProgress;
  const details = legBakeDetails;
  if (!panel || !label || !progress || !details) return () => {};
  const update = () => {
    const display = formatLegBakeProgress(getLegAnimationBakeStatus());
    panel.hidden = !display.visible;
    if (label.textContent !== display.label) label.textContent = display.label;
    progress.value = display.percent;
    const text = `${display.details}\n${display.cache}`;
    if (details.textContent !== text) details.textContent = text;
    if (legPrebakeButton) {
      const status = getLegAnimationBakeStatus();
      legPrebakeButton.textContent = status.prebaking ? 'Cancel prebake' : 'Prebake show';
      legPrebakeButton.disabled = status.pending === 0;
      legPrebakeButton.title = status.prebaking
        ? 'Resume marching immediately, using live animation where baked poses are not ready.'
        : 'Pause marching and prepare animation faster. Completion leaves playback paused.';
    }
  };
  const prebake = () => {
    if (getLegAnimationBakeStatus().prebaking) cancelLegAnimationPrebake();
    else startLegAnimationPrebake();
    update();
  };
  legPrebakeButton?.addEventListener('click', prebake);
  update();
  const timer = window.setInterval(update, 500);
  return () => {
    window.clearInterval(timer);
    legPrebakeButton?.removeEventListener('click', prebake);
  };
}
