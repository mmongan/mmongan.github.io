// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="vite/client" />

// Read-mostly handle for the live browser test suite (tests/live) and remote
// headset debugging. Installed in dev builds, or in any build when the page
// URL contains `?diagnostics`. It exposes existing transport and readiness
// functions only; it adds no separate playback or scene state.

import { getMidiPlaybackWaitReason, isMidiPlaybackReady } from '../audio/midiPlayback';
import {
  getDrillTransportState, isPlaybackRequested, isPlaybackStartPending,
  pauseAll, playAll, seekToCount, toggleAllPlayback,
} from '../robot/robot';
import { onStartupStateChanged } from '../ui/loadingScreen';
import { engine, scene } from './engine';

export interface OpenChartxrDiagnostics {
  transport: typeof getDrillTransportState;
  isPlaybackStartPending: typeof isPlaybackStartPending;
  isPlaybackRequested: typeof isPlaybackRequested;
  isMidiPlaybackReady: typeof isMidiPlaybackReady;
  midiWaitReason: typeof getMidiPlaybackWaitReason;
  playAll: typeof playAll;
  pauseAll: typeof pauseAll;
  toggleAllPlayback: typeof toggleAllPlayback;
  seekToCount: typeof seekToCount;
  marcherCount: () => number;
  startupFinished: () => boolean;
  // Frames presented by the engine, counted even if scene rendering fails.
  enginePresentedFrames: () => number;
  // Frames whose scene render completed.
  sceneRenderedFrames: () => number;
}

export function shouldInstallDiagnostics(search = window.location.search): boolean {
  return import.meta.env.DEV || new URLSearchParams(search).has('diagnostics');
}

export function installDiagnosticsHooks(getMarcherCount: () => number) {
  if (!shouldInstallDiagnostics()) return;
  let startupFinished = false;
  const unsubscribe = onStartupStateChanged(state => { startupFinished = state.finished; });
  let presented = 0;
  let rendered = 0;
  const presentedObserver = engine.onEndFrameObservable.add(() => { presented++; });
  const renderedObserver = scene.onAfterRenderObservable.add(() => { rendered++; });
  const diagnostics: OpenChartxrDiagnostics = {
    transport: getDrillTransportState,
    isPlaybackStartPending,
    isPlaybackRequested,
    isMidiPlaybackReady,
    midiWaitReason: getMidiPlaybackWaitReason,
    playAll,
    pauseAll,
    toggleAllPlayback,
    seekToCount,
    marcherCount: getMarcherCount,
    startupFinished: () => startupFinished,
    enginePresentedFrames: () => presented,
    sceneRenderedFrames: () => rendered,
  };
  (window as unknown as { __openchartxr?: OpenChartxrDiagnostics }).__openchartxr = diagnostics;
  scene.onDisposeObservable.addOnce(() => {
    unsubscribe();
    engine.onEndFrameObservable.remove(presentedObserver);
    scene.onAfterRenderObservable.remove(renderedObserver);
    delete (window as unknown as { __openchartxr?: OpenChartxrDiagnostics }).__openchartxr;
  });
}
