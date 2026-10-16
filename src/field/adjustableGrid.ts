import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import { fieldGridInterval, fieldGridToggle } from '../ui/dom';
import { FIELD_LENGTH_YARDS, FIELD_SURFACE_Y, FIELD_WIDTH_YARDS } from './constants';

const MIN_GRID_INTERVAL = 0.5;
const MAX_GRID_INTERVAL = 20;

export function createAdjustableFieldGrid(field: TransformNode) {
  let grid: LinesMesh | null = null;

  function getGridInterval(): number | null {
    const interval = fieldGridInterval?.valueAsNumber;
    return typeof interval === 'number' && Number.isFinite(interval) &&
      interval >= MIN_GRID_INTERVAL && interval <= MAX_GRID_INTERVAL
      ? interval
      : null;
  }

  function makeGridLines(interval: number) {
    const halfWidth = FIELD_WIDTH_YARDS / 2;
    const halfLength = FIELD_LENGTH_YARDS / 2;
    const gridY = FIELD_SURFACE_Y - field.position.y + 0.008;
    const lines: Vector3[][] = [];
    const firstX = Math.ceil(-halfWidth / interval) * interval;
    const lastX = Math.floor(halfWidth / interval) * interval;
    const firstZ = Math.ceil(-halfLength / interval) * interval;
    const lastZ = Math.floor(halfLength / interval) * interval;
    for (let x = firstX; x <= lastX + 1e-6; x += interval) {
      lines.push([
        new Vector3(x, gridY, -halfLength),
        new Vector3(x, gridY, halfLength),
      ]);
    }
    for (let z = firstZ; z <= lastZ + 1e-6; z += interval) {
      lines.push([
        new Vector3(-halfWidth, gridY, z),
        new Vector3(halfWidth, gridY, z),
      ]);
    }
    return lines;
  }

  function updateGrid() {
    const interval = getGridInterval();
    const enabled = !!fieldGridToggle?.checked;
    if (fieldGridInterval) {
      fieldGridInterval.disabled = !enabled;
      fieldGridInterval.setCustomValidity(
        enabled && interval === null ? 'Enter a grid spacing from 0.5 to 20 yards.' : ''
      );
      if (enabled && interval === null) fieldGridInterval.reportValidity();
    }
    if (!enabled || interval === null) {
      grid?.dispose();
      grid = null;
      return;
    }
    grid?.dispose();
    grid = MeshBuilder.CreateLineSystem('adjustableFieldGrid', {
      lines: makeGridLines(interval),
    }, scene);
    grid.parent = field;
    grid.color = new Color3(0.55, 0.88, 1);
    grid.alpha = 0.45;
    grid.isPickable = false;
  }

  fieldGridToggle?.addEventListener('change', updateGrid);
  fieldGridInterval?.addEventListener('change', updateGrid);
  updateGrid();

  scene.onDisposeObservable.addOnce(() => {
    fieldGridToggle?.removeEventListener('change', updateGrid);
    fieldGridInterval?.removeEventListener('change', updateGrid);
    grid?.dispose();
    grid = null;
  });
}
