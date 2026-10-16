import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { getObjectName } from '../interaction/objectNames';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.pure';
import { scene } from '../scene/engine';
import { camera as desktopCamera, setDesktopMarcherPOV } from './desktopCamera';
import { MarcherPOVCamera } from './marcherPOVCamera';
import { getMarcherEyePose } from '../robot/robot';
import { setMarcherPOVMenuActive } from '../menu/handMenu';
import { marcherPOVSelect, marcherPOVStatus, marcherPOVExitButton, marcherPOVModeButton } from '../ui/dom';

const follower = new MarcherPOVCamera(getMarcherEyePose);
let getSelected: () => TransformNode | null = () => null;
let getMarchers: () => TransformNode[] = () => [];
let selectMarcher: (robot: TransformNode | null, revealPaths?: boolean) => void = () => {};
let availableVR: () => boolean = () => false;
let listSignature = '';
let startupPOVPending = true;
let refreshPaths: () => void = () => {};

export function isMarcherPOVActive() { return follower.active; }
export function getMarcherPOVRobot() {
  const robot = getSelected();
  return follower.active && robot && !robot.isDisposed() ? robot : null;
}
export function getMarcherPOVLabel() {
  const robot = getMarcherPOVRobot();
  return robot ? `Marcher ${getMarchers().indexOf(robot) + 1}` : '';
}

export function setMarcherPOVEnabled(enabled: boolean) {
  startupPOVPending = false;
  if (!enabled) {
    follower.stop();
    setDesktopMarcherPOV(false);
    publish('POV off. Select a marcher, then enable POV.');
    return;
  }
  const robot = getSelected();
  const camera = scene.activeCamera;
  const xr = camera?.getClassName() === 'WebXRCamera';
  if (!robot || robot.isDisposed()) {
    publish('Select a marcher first, by clicking/pinching it or using the marcher list.');
    return;
  }
  if (!(camera instanceof TargetCamera) || (xr && !availableVR())) {
    publish('POV is available in the browser and immersive VR, not AR or floor calibration.');
    return;
  }
  if (!follower.start(robot, camera, xr)) {
    publish('That marcher is not visible. Select a visible marcher to start POV.');
    return;
  }
  setDesktopMarcherPOV(!xr);
  publish(xr ? 'VR POV: movement follows the marcher; headset look and room-scale motion stay yours.'
    : 'Marcher POV: mouse/arrow keys look around; movement follows the selected marcher.');
}

function publish(message: string) {
  marcherPOVModeButton?.setAttribute('aria-pressed', String(follower.active));
  if (marcherPOVExitButton) marcherPOVExitButton.hidden = !follower.active;
  if (marcherPOVStatus) marcherPOVStatus.textContent = message;
  setMarcherPOVMenuActive(follower.active);
  refreshPaths();
}

function updateFollower() {
  if (!follower.active) return;
  const robot = getSelected();
  if (!robot || follower.trackedCamera !== scene.activeCamera ||
    (scene.activeCamera?.getClassName() === 'WebXRCamera' && !availableVR()) || !follower.update(robot)) {
    setMarcherPOVEnabled(false);
  }
}

function refreshMarcherList() {
  const marchers = getMarchers().filter(robot => !robot.isDisposed() && robot.isEnabled());
  if (startupPOVPending && marchers.length > 0) {
    selectMarcher(marchers[0], false);
    setMarcherPOVEnabled(true);
  }
  const signature = JSON.stringify(marchers.map(robot => [robot.uniqueId, getObjectName(robot)]));
  if (marcherPOVSelect && signature !== listSignature) {
    listSignature = signature;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a marcher';
    marcherPOVSelect.replaceChildren(placeholder, ...marchers.map((robot, index) => {
      const option = document.createElement('option');
      option.value = String(robot.uniqueId);
      option.textContent = getObjectName(robot) ?? `Marcher ${index + 1}`;
      return option;
    }));
  }
  const selected = getSelected();
  if (marcherPOVSelect) marcherPOVSelect.value = selected ? String(selected.uniqueId) : '';
}

export function initMarcherPOV(
  selected: () => TransformNode | null,
  marchers: () => TransformNode[],
  select: (robot: TransformNode | null, revealPaths?: boolean) => void,
  updatePaths: () => void,
) {
  getSelected = selected;
  getMarchers = marchers;
  selectMarcher = select;
  refreshPaths = updatePaths;
  const selector = marcherPOVSelect;
  marcherPOVExitButton?.addEventListener('click', () => setMarcherPOVEnabled(false));
  marcherPOVModeButton?.addEventListener('click', () => setMarcherPOVEnabled(!follower.active));
  selector?.addEventListener('change', () => {
    selectMarcher(getMarchers().find(robot => String(robot.uniqueId) === selector.value) ?? null);
    if (follower.active) updateFollower();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && follower.active) setMarcherPOVEnabled(false);
  });
  scene.onBeforeCameraRenderObservable.add(camera => {
    if (camera === desktopCamera) updateFollower();
  });
  scene.onBeforeRenderObservable.add(refreshMarcherList);
  scene.onDisposeObservable.addOnce(() => follower.stop());
  publish('POV off. Select a marcher, then enable POV.');
}

export function connectMarcherPOVXR(experience: WebXRDefaultExperience, allowed: () => boolean) {
  let resumeOnXRFrame = false;
  let cameraInitialized = false;
  availableVR = () => experience.baseExperience.state === WebXRState.IN_XR && allowed();
  experience.baseExperience.sessionManager.onXRFrameObservable.add(() => {
    if (scene.activeCamera !== experience.baseExperience.camera) return;
    if (resumeOnXRFrame && cameraInitialized && availableVR()) {
      resumeOnXRFrame = false;
      setMarcherPOVEnabled(true);
    }
    updateFollower();
  }, undefined, true);
  experience.baseExperience.onStateChangedObservable.add(state => {
    if (state === WebXRState.ENTERING_XR) {
      cameraInitialized = false;
      experience.baseExperience.camera.onXRCameraInitializedObservable.addOnce(() => {
        cameraInitialized = true;
      });
      resumeOnXRFrame = follower.active;
      setMarcherPOVEnabled(false);
    } else if (state === WebXRState.EXITING_XR) {
      resumeOnXRFrame = false;
      setMarcherPOVEnabled(false);
    }
  });
}
