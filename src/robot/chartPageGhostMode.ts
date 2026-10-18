import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Quaternion } from '@babylonjs/core/Maths/math.vector.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import { chartGhostModeToggle, fieldChartModeToggle, floorCalibrationToggle } from '../ui/dom';
import { getChartPageCounts } from './chartPageTimeline';
import {
  getBlankChartPageState, getDrillLastCountIndex, getGlobalCountIndex, getRobotCounts,
  setGhostBandPreviewEnabled,
} from './robot';
import { createMarcherDragGhost } from './marcherGhost';

let enabled = false;
let refreshMode: (() => void) | null = null;

export function isChartGhostModeEnabled() { return enabled; }

export function setChartGhostModeEnabled(value: boolean) {
  enabled = value;
  if (chartGhostModeToggle) chartGhostModeToggle.checked = value;
  if (value) {
    if (fieldChartModeToggle?.checked) {
      fieldChartModeToggle.checked = false;
      fieldChartModeToggle.dispatchEvent(new Event('change'));
    }
    setGhostBandPreviewEnabled(false);
  }
  refreshMode?.();
}

export function initChartPageGhostMode(root: TransformNode, getMarchers: () => TransformNode[]) {
  let ghosts: TransformNode[] = [];
  let signature = '';
  function clear() {
    ghosts.forEach(ghost => ghost.dispose());
    ghosts = [];
    signature = '';
  }
  function refresh() {
    // Blank pages already own their interactive before/after placement ghosts.
    if (!enabled || floorCalibrationToggle?.checked || getBlankChartPageState()) {
      if (ghosts.length) clear();
      return;
    }
    const pages = getChartPageCounts(getDrillLastCountIndex());
    const count = getGlobalCountIndex();
    let page = 0;
    pages.forEach((value, index) => { if (value <= count) page = index; });
    const neighbors = [
      { count: pages[page - 1], name: 'beforeChartPageGhost', color: new Color3(0.35, 0.8, 1) },
      { count: pages[page + 1], name: 'afterChartPageGhost', color: new Color3(1, 0.45, 0.85) },
    ];
    const entries = getMarchers().filter(robot => !robot.isDisposed() && robot.isEnabled()).flatMap(robot => {
      const counts = getRobotCounts(robot);
      return neighbors.flatMap(neighbor => {
        const pose = neighbor.count === undefined ? undefined : counts?.[neighbor.count];
        return pose ? [{ robot, pose, ...neighbor }] : [];
      });
    });
    const nextSignature = JSON.stringify(entries.map(({ robot, pose, count, name }) => [
      robot.uniqueId, name, count, pose.position.x, pose.position.y, pose.position.z,
      pose.facingY ?? pose.rotationY, robot.scaling.asArray(),
      robot.getChildMeshes().map(mesh => mesh.uniqueId),
    ]));
    if (nextSignature === signature) return;
    clear();
    signature = nextSignature;
    for (const { robot, pose, name, color } of entries) {
      const ghost = createMarcherDragGhost(robot, robot, color);
      ghost.name = name;
      ghost.setParent(root);
      ghost.position.copyFrom(pose.position);
      ghost.rotationQuaternion = Quaternion.FromEulerAngles(0, pose.facingY ?? pose.rotationY, 0);
      ghost.scaling.copyFrom(robot.scaling);
      ghosts.push(ghost);
    }
  }
  refreshMode = refresh;
  const change = () => setChartGhostModeEnabled(!!chartGhostModeToggle?.checked);
  chartGhostModeToggle?.addEventListener('change', change);
  const observer = scene.onBeforeRenderObservable.add(refresh);
  scene.onDisposeObservable.addOnce(() => {
    chartGhostModeToggle?.removeEventListener('change', change);
    scene.onBeforeRenderObservable.remove(observer);
    refreshMode = null;
    enabled = false;
    clear();
  });
}
