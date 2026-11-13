// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { getObjectName } from '../interaction/objectNames';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { camera as desktopCamera, setDesktopMarcherPOV } from './desktopCamera';
import { MarcherPOVCamera } from './marcherPOVCamera';
import { getMarcherEyePose } from '../robot/robot';
import { marcherPOVSelect, marcherPOVStatus, marcherPOVExitButton, marcherPOVModeButton } from '../ui/dom';
import {
  initMarcherDrumGame, isMarcherDrumGameActive as isDrumGameActive,
  stopMarcherDrumGame, toggleMarcherDrumGame as toggleDrumGame,
} from './marcherDrumGame';

const follower = new MarcherPOVCamera(getMarcherEyePose);
let getSelected: () => TransformNode | null = () => null;
let getMarchers: () => TransformNode[] = () => [];
let selectMarcher: (robot: TransformNode | null, revealPaths?: boolean) => void = () => {};
let availableVR: () => boolean = () => false;
let listSignature = '';
let refreshPaths: () => void = () => {};

export function isMarcherPOVActive() { return follower.active; }
export function isMarcherDrumGameActive() { return isDrumGameActive(); }
export function toggleMarcherDrumGame() { toggleDrumGame(); }
export function getMarcherPOVRobot() {
  const robot = getSelected();
  return follower.active && robot && !robot.isDisposed() ? robot : null;
}
export function getMarcherPOVLabel() {
  const robot = getMarcherPOVRobot();
  return robot ? `Marcher ${getMarchers().indexOf(robot) + 1}` : '';
}

const isUsableMarcher = (robot: TransformNode | null): robot is TransformNode =>
  !!robot && !robot.isDisposed() && robot.isEnabled();

// The visible marcher closest to the centre of the current view, so panel
// buttons (which cannot pick a marcher themselves) start POV on the marcher
// the user is looking at. Marchers behind the camera rank last.
function findMarcherInView(camera: TargetCamera): TransformNode | null {
  const origin = camera.globalPosition;
  const forward = camera.getDirection(Vector3.Forward(camera.getScene().useRightHandedSystem));
  let best: TransformNode | null = null;
  let bestScore = Infinity;
  for (const robot of getMarchers()) {
    if (!isUsableMarcher(robot)) continue;
    const offset = robot.getAbsolutePosition().subtract(origin);
    const along = Vector3.Dot(offset, forward);
    const sideways = offset.subtract(forward.scale(along)).length();
    const score = along > 0 ? sideways / along : 1e6 + offset.length();
    if (score < bestScore) {
      bestScore = score;
      best = robot;
    }
  }
  return best;
}

// Short state for immersive panel buttons, which can't show the DOM status.
let panelNotice: { text: string; until: number } | null = null;
const PANEL_NOTICE_MS = 3000;

function notifyPanel(text: string) {
  panelNotice = { text, until: performance.now() + PANEL_NOTICE_MS };
}

export function getMarcherPOVPanelLabel(): { text: string; active: boolean } {
  if (panelNotice && performance.now() < panelNotice.until) return { text: panelNotice.text, active: follower.active };
  panelNotice = null;
  return { text: `Marcher POV: ${follower.active ? 'on' : 'off'}`, active: follower.active };
}

export function setMarcherPOVEnabled(enabled: boolean) {
  if (!enabled) {
    stopMarcherDrumGame();
    follower.stop();
    setDesktopMarcherPOV(false);
    panelNotice = null;
    publish('POV off. Select a marcher, then enable POV.');
    return;
  }
  const camera = scene.activeCamera;
  const xr = camera?.getClassName() === 'WebXRCamera';
  if (!(camera instanceof TargetCamera) || (xr && !availableVR())) {
    notifyPanel('POV: VR or desktop only');
    publish('POV is available in the browser and immersive VR, not AR or floor calibration.');
    return;
  }
  let robot = getSelected();
  if (!isUsableMarcher(robot)) {
    // Started from a panel/sign with no usable selection: follow the marcher
    // in view and select it, so paths, chart and Drum Game agree.
    robot = findMarcherInView(camera);
    if (!robot) {
      notifyPanel('POV: no visible marchers');
      publish('No visible marchers. Open a show or add marchers, then enable POV.');
      return;
    }
    selectMarcher(robot);
  }
  if (!follower.start(robot, camera, xr)) {
    notifyPanel('POV: marcher not visible');
    publish('That marcher is not visible. Select a visible marcher to start POV.');
    return;
  }
  panelNotice = null;
  setDesktopMarcherPOV(!xr);
  publish(xr ? 'VR POV: movement follows the marcher; headset look and room-scale motion stay yours.'
    : 'Marcher POV: mouse/arrow keys look around; movement follows the selected marcher.');
}

function publish(message: string) {
  marcherPOVModeButton?.setAttribute('aria-pressed', String(follower.active));
  if (marcherPOVExitButton) marcherPOVExitButton.hidden = !follower.active;
  if (marcherPOVStatus) marcherPOVStatus.textContent = message;
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
  initMarcherDrumGame({
    getSelected,
    startPOV: () => setMarcherPOVEnabled(true),
    isPOVActive: isMarcherPOVActive,
    isVRActive: availableVR,
    status: publish,
  });
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
