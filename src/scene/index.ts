import { engine, scene } from './engine';
import '../camera/desktopCamera';
import '../camera/playerAvatar';
import { fieldLevelInputs, getSelectedFieldLevel } from '../ui/dom';
import { createSky } from '../environment/sky';
import { createHorizonGround } from '../environment/ground';
import { createFootballField } from '../field/footballField';
import {
  initInteraction,
  updateARResizeFromControllers,
  updateRobotPathFromControllers,
  updateTabletopHands,
  updateHandPathDrawing,
  getActiveControllers,
  getSelectedRobotProgress,
} from '../interaction/sceneInteraction';
import { captureContentRootMeshes, attachToARTransform } from '../xr/ar';
import { createTeleportGrid, initXR } from '../xr/webXR';
import { updateHandMenu } from '../menu/handMenu';
import '../menu/settings';

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

initInteraction();

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
  updateHandMenu(getActiveControllers(), progress);
  footballField.updateVideoBoardProgress(progress);
  scene.render();
}

engine.runRenderLoop(renderFrame);

window.addEventListener("resize", () => {
  engine.resize();
});
