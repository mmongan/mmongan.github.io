export interface ThumbJogState {
  neutral: number | null;
  settlingSeconds: number;
}

export function resetThumbJog(state: ThumbJogState) {
  state.neutral = null;
  state.settlingSeconds = 0;
}

// Coordinates are palm-relative and normalized by hand length.
export function updateThumbJog(state: ThumbJogState, active: boolean, position: number, deltaSeconds: number): number {
  if (!active || !Number.isFinite(position) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > 0.1) {
    resetThumbJog(state);
    return 0;
  }
  if (state.neutral === null || (state.settlingSeconds < 0.3 && Math.abs(position - state.neutral) > 0.08)) {
    state.neutral = position;
    state.settlingSeconds = 0;
  }
  if (state.settlingSeconds < 0.3) {
    state.settlingSeconds += deltaSeconds;
    return 0;
  }
  return Math.max(-1, Math.min(1, (position - state.neutral) / 0.35));
}
