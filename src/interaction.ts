import * as BABYLON from 'babylonjs';
import { scene } from './engineScene';
import { statusText } from './dom';
import { interactiveObjects } from './decor';

export const selectedState: { current: BABYLON.Mesh | null; previous: BABYLON.Mesh | null } = {
  current: null,
  previous: null,
};

let activeController: BABYLON.WebXRInputSource | null = null;

export function setActiveController(controller: BABYLON.WebXRInputSource) {
  activeController = controller;
}

function applySelection(mesh: BABYLON.Mesh | null, label: string) {
  if (!mesh) {
    return;
  }

  if (selectedState.previous && selectedState.previous !== mesh) {
    selectedState.previous.scaling = new BABYLON.Vector3(1, 1, 1);
  }

  selectedState.current = mesh;
  selectedState.previous = mesh;
  mesh.scaling = new BABYLON.Vector3(1.18, 1.18, 1.18);
  if (statusText) {
    statusText.textContent = `Selected: ${label} — rotate with the controller`;
  }
}

function attachSelectionActions() {
  interactiveObjects.forEach(({ mesh, label }) => {
    const actionManager = new BABYLON.ActionManager(scene);
    mesh.actionManager = actionManager;

    actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPickTrigger,
        () => applySelection(mesh, label)
      )
    );

    actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPickDownTrigger,
        () => applySelection(mesh, label)
      )
    );
  });
}

export function initInteraction() {
  attachSelectionActions();

  scene.registerBeforeRender(() => {
    if (selectedState.current && activeController && activeController.pointer) {
      const rotation = activeController.pointer.absoluteRotationQuaternion;
      if (rotation) {
        selectedState.current.rotationQuaternion = rotation.clone();
      }
    }
  });
}
