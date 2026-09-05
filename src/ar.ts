import * as BABYLON from 'babylonjs';
import { scene } from './engineScene';

// AR tabletop mode: shrink the whole stadium onto a table and hide the
// world-scale sky/ground, which only make sense for the full-scale VR view.
const AR_HIDDEN_MESH_NAMES = new Set(["skyBox", "horizonGround"]);
const AR_SCALE = 0.02;
const arRoot = new BABYLON.TransformNode("arRoot", scene);
let arTabletopModeActive = false;
let contentRootMeshes: BABYLON.AbstractMesh[] = [];

// Must be called once all real scene content exists, but before anything that
// should stay outside AR's shrink-to-tabletop transform (e.g. the teleport grid).
export function captureContentRootMeshes() {
  contentRootMeshes = scene.meshes.filter((mesh) => !mesh.parent);
}

export function enterARTabletopMode() {
  if (arTabletopModeActive) return;
  arTabletopModeActive = true;
  contentRootMeshes.forEach((mesh) => {
    if (AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setEnabled(false);
    } else {
      mesh.setParent(arRoot);
    }
  });
  arRoot.scaling.setAll(AR_SCALE);
  arRoot.position = new BABYLON.Vector3(0, 0, 0.6);
}

export function exitARTabletopMode() {
  if (!arTabletopModeActive) return;
  arTabletopModeActive = false;
  contentRootMeshes.forEach((mesh) => {
    if (AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setEnabled(true);
    } else {
      mesh.setParent(null);
    }
  });
  arRoot.scaling.setAll(1);
  arRoot.position.setAll(0);
}
