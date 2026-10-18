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

// Build static content before wiring up input and the WebXR experience.
createSky();
createHorizonGround();
const footballField = createFootballField();

function updateFieldLevel() {
  footballField.setFieldLevel(getSelectedFieldLevel());
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
