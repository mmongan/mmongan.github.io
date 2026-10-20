import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';

export interface PanelMenuGestureState {
  started: number | null;
  released: number | null;
  fired: boolean;
}

export function createPanelMenuGestureState(): PanelMenuGestureState {
  return { started: null, released: null, fired: false };
}

export function isOpenFlatPalm(wrist: Vector3, middleBase: Vector3, normal: Vector3,
  fingertips: readonly Vector3[]) {
  const length = Vector3.Distance(wrist, middleBase);
  return length > 1e-4 && normal.y >= 0.65 && fingertips.length === 4 &&
    fingertips.every(tip => Vector3.Distance(wrist, tip) > length * 1.6 &&
      Math.abs(Vector3.Dot(tip.subtract(middleBase), normal)) < length * 0.35);
}

export function updatePanelMenuGesture(state: PanelMenuGestureState, time: number, open: boolean) {
  if (!open) {
    state.started = null;
    state.released ??= time;
    if (time - state.released >= 0.25) state.fired = false;
    return false;
  }
  state.released = null;
  state.started ??= time;
  if (state.fired || time - state.started < 0.45) return false;
  state.fired = true;
  return true;
}
