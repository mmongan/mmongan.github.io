import { engine, scene } from './engineScene';
import './camera';
import { fieldLevelSelect } from './dom';
import { createSky } from './environment/sky';
import { createHorizonGround } from './environment/ground';
import { createFootballField } from './field';
import { animateDecor } from './decor';
import { initInteraction } from './interaction';
import { captureContentRootMeshes } from './ar';
import { createTeleportGrid, initXR } from './xr';

createSky();
createHorizonGround();

const footballField = createFootballField();

if (fieldLevelSelect) {
  fieldLevelSelect.addEventListener("change", (event) => {
    footballField.setFieldLevel((event.target as HTMLSelectElement).value);
  });
}

animateDecor();
initInteraction();

// Snapshot of top-level meshes for AR tabletop mode — must be taken after all
// real scene content exists but before the teleport grid, which stays world-scale.
captureContentRootMeshes();

const teleportGrid = createTeleportGrid();
initXR(teleportGrid);

engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => {
  engine.resize();
});
