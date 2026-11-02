// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { engine, scene } from './engine';
import '../camera/desktopCamera';
import { drillChartPadToggle, fieldLevelInputs, getSelectedFieldLevel } from '../ui/dom';
import { createSky } from '../environment/sky';
import { createHorizonGround } from '../environment/ground';
import { createFootballField } from '../field/footballField';
import {
  initInteraction,
  updateARResizeFromControllers,
  updateRobotPathFromControllers,
  updateTabletopHands,
  updateHandPathDrawing,
  getSelectedRobotProgress,
  getSelectedMarcher,
  getSelectableMarchers,
  selectRobot,
  refreshPathLineAppearance,
} from '../interaction/pathInteraction';
import { captureContentRootMeshes, attachToARTransform } from '../xr/ar';
import { createTeleportGrid, initXR } from '../xr/webXR';
import '../menu/settings';
import { initMidiPlayback } from '../audio/midiPlayback';
import { initMusicStand } from '../menu/musicStand';
import { initInstrumentPanel } from '../menu/instrumentPanel';
import { initXRSettingsPanel } from '../menu/xrSettingsPanel';
import { initGhostBandControls } from '../menu/ghostBandControls';
import { setDrillChartPadVisible } from '../menu/drillChartPad';
import { initMarcherPOV } from '../camera/marcherPOV';
import { initMarcherFootprints } from '../robot/marcherFootprints';
import { initDrillSpacingChecker } from '../menu/drillSpacingChecker';
import { initPlaybackModeControls } from '../ui/playbackMode';
import { reportStartupProgress } from '../ui/loadingScreen';
import { initStartupDisplay } from './startupDisplay';
import { seekToCount, isAnyPlaying } from '../robot/robot';
import { applyStaticRenderOptimizations, refreshFrozenWorldMatrices } from './renderOptimizations';

// Build static content before wiring up input and the WebXR experience.
reportStartupProgress(0.05, 'Building the stadium…');
createSky();
createHorizonGround();
const footballField = createFootballField();

function updateFieldLevel() {
  footballField.setFieldLevel(getSelectedFieldLevel());
  // Field-level rebuilds can replace or move static field meshes.
  refreshFrozenWorldMatrices();
}

fieldLevelInputs.forEach((input) => {
  input.addEventListener("change", updateFieldLevel);
});

updateFieldLevel();
initPlaybackModeControls();

initInteraction();
initDrillSpacingChecker(getSelectableMarchers, selectRobot);
initMusicStand();
initInstrumentPanel();
initXRSettingsPanel();
initGhostBandControls();
initMidiPlayback();
initMarcherPOV(getSelectedMarcher, getSelectableMarchers, selectRobot, refreshPathLineAppearance);
initMarcherFootprints(getSelectedMarcher);

const startupChartObserver = scene.onBeforeRenderObservable.add(() => {
  scene.onBeforeRenderObservable.remove(startupChartObserver);
  if (drillChartPadToggle?.checked) setDrillChartPadVisible(true);
});

// Snapshot of top-level meshes for AR tabletop mode — must be taken after all
// real scene content exists but before the teleport grid is created, since the
// grid is attached to the AR transform separately (so it tracks scale/position).
captureContentRootMeshes();

const teleportGrid = createTeleportGrid();
attachToARTransform(teleportGrid);
initXR(teleportGrid);

// After captureContentRootMeshes so the camera-riding startup display never
// joins the AR tabletop transform.
initStartupDisplay();

// Freeze the static stadium after the scene graph has been rebased under the
// AR transform; frozen matrices re-sync whenever that transform changes.
applyStaticRenderOptimizations();

// Render a mid-stride marching pose once while the startup overlay still
// covers the scene, so the session's first Play press does not hitch on
// one-time pose, cache, and GPU setup for the marching band.
let warmupStep = 0;
const warmupObserver = scene.onBeforeRenderObservable.add(() => {
  if (isAnyPlaying()) {
    scene.onBeforeRenderObservable.remove(warmupObserver);
    return;
  }
  if (!getSelectableMarchers().length) return;
  warmupStep++;
  if (warmupStep === 1) seekToCount(0.5);
  else if (warmupStep >= 3) {
    seekToCount(0);
    scene.onBeforeRenderObservable.remove(warmupObserver);
  }
});

function renderFrame() {
  updateARResizeFromControllers();
  updateTabletopHands();
  updateHandPathDrawing();
  updateRobotPathFromControllers();
  const progress = getSelectedRobotProgress();
  footballField.updateVideoBoardProgress(progress);
  scene.render();
}

engine.runRenderLoop(renderFrame);

window.addEventListener("resize", () => {
  engine.resize();
});
