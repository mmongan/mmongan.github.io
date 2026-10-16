import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';

interface MarcherPosition {
  robot: TransformNode;
  x: number;
  z: number;
}

interface NearestMarcher {
  marcher: MarcherPosition;
  neighbor: MarcherPosition;
  distance: number;
}

export function initDrillSpacingChecker(
  getMarchers: () => TransformNode[],
  selectMarcher: (robot: TransformNode) => void
) {
  const thresholdInput = document.getElementById('drillSpacingThreshold') as HTMLInputElement | null;
  const checkButton = document.getElementById('drillSpacingCheck') as HTMLButtonElement | null;
  const summary = document.getElementById('drillSpacingSummary') as HTMLOutputElement | null;
  const results = document.getElementById('drillSpacingResults');
  if (!thresholdInput || !checkButton || !summary || !results) return;

  checkButton.addEventListener('click', () => {
    if (!thresholdInput.checkValidity() || !Number.isFinite(thresholdInput.valueAsNumber)) {
      thresholdInput.reportValidity();
      return;
    }

    const marchers: MarcherPosition[] = getMarchers()
      .filter((robot) => !robot.isDisposed() && robot.isEnabled())
      .map((robot) => ({ robot, x: robot.position.x, z: robot.position.z }))
      .filter((marcher) => Number.isFinite(marcher.x) && Number.isFinite(marcher.z));
    const threshold = thresholdInput.valueAsNumber;
    const nearest: NearestMarcher[] = marchers.flatMap((marcher) => {
      let closest: NearestMarcher | null = null;
      for (const neighbor of marchers) {
        if (neighbor === marcher) continue;
        const distance = Math.hypot(marcher.x - neighbor.x, marcher.z - neighbor.z);
        if (!closest || distance < closest.distance) closest = { marcher, neighbor, distance };
      }
      return closest ? [closest] : [];
    }).sort((a, b) => a.distance - b.distance);
    const crowdedCount = nearest.filter((entry) => entry.distance < threshold).length;

    summary.value = marchers.length < 2
      ? `Place at least two marchers to check spacing (${marchers.length} found).`
      : `${marchers.length} marchers checked; ${crowdedCount} are closer than ${threshold.toFixed(2)} yd to their nearest neighbor.`;
    results.replaceChildren();

    for (const entry of nearest) {
      const row = document.createElement('div');
      row.className = `spacing-result-row${entry.distance < threshold ? ' crowded' : ''}`;
      const detail = document.createElement('span');
      detail.textContent = `Marcher #${entry.marcher.robot.uniqueId} → #${entry.neighbor.robot.uniqueId}: ${entry.distance.toFixed(2)} yd`;
      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.textContent = 'Select';
      selectButton.setAttribute('aria-label', `Select marcher ${entry.marcher.robot.uniqueId}`);
      selectButton.addEventListener('click', () => selectMarcher(entry.marcher.robot));
      row.append(detail, selectButton);
      results.append(row);
    }
  });
}
