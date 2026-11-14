// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Collisions/collisionCoordinator';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.pure';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { canvas, enterARButton, enterVRButton, xrEntryStatus } from '../ui/dom';

function createEngine(): Engine {
  try {
    // adaptToDeviceRatio renders at the display's native pixel density, so
    // desktop and high-DPI screens get a crisp image instead of an upscaled one.
    return new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    }, true);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Could not initialize the WebGL renderer', error);
    if (xrEntryStatus) {
      xrEntryStatus.textContent = `Unable to start the 3D view: ${detail}. ` +
        'Enable graphics acceleration and restart your browser or VS Code. ' +
        'If this is an embedded browser, open the site in Chrome, Edge, or the Quest browser.';
      xrEntryStatus.hidden = false;
    }
    if (enterVRButton) enterVRButton.disabled = true;
    if (enterARButton) enterARButton.disabled = true;
    throw error;
  }
}

export const engine = createEngine();

export const scene = new Scene(engine);
// Diagnostics handle for profiling sessions (e.g. remote Quest debugging).
(window as unknown as { __scene?: Scene }).__scene = scene;
scene.clearColor = new Color4(0.03, 0.05, 0.09, 1);

// Distance haze so the horizon ground fades out instead of ending at a hard edge.
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogColor = new Color3(0.75, 0.88, 0.95);
scene.fogStart = 90;
scene.fogEnd = 260;

// Physically block the fly camera from passing through the ground or the
// bleachers, instead of just clamping altitude.
scene.collisionsEnabled = true;

// Warm/cool daylight: a cool sky dome with green turf bounce from below, and
// a warm directional sun that owns the specular highlights. The split gives
// surfaces directional color depth without shadow maps or extra geometry.
const hemiLight = new HemisphericLight(
  "hemiLight",
  new Vector3(0, 1, 0),
  scene
);
hemiLight.intensity = 1.05;
hemiLight.diffuse = new Color3(0.88, 0.94, 1.0);
hemiLight.groundColor = new Color3(0.33, 0.39, 0.3);
hemiLight.specular = new Color3(0, 0, 0);

const dirLight = new DirectionalLight(
  "dirLight",
  new Vector3(-1, -1, -1),
  scene
);
dirLight.intensity = 0.85;
dirLight.diffuse = new Color3(1.0, 0.95, 0.85);
dirLight.specular = new Color3(1.0, 0.97, 0.9);
