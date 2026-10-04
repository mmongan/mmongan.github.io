import { Engine } from '@babylonjs/core/Engines/engine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.pure';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { canvas } from '../ui/dom';

export const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  antialias: true,
});

export const scene = new Scene(engine);
scene.clearColor = new Color4(0.03, 0.05, 0.09, 1);

// Distance haze so the horizon ground fades out instead of ending at a hard edge.
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogColor = new Color3(0.75, 0.88, 0.95);
scene.fogStart = 90;
scene.fogEnd = 260;

// Physically block the fly camera from passing through the ground or the
// bleachers, instead of just clamping altitude.
scene.collisionsEnabled = true;

export const hemiLight = new HemisphericLight(
  "hemiLight",
  new Vector3(0, 1, 0),
  scene
);
hemiLight.intensity = 1.1;

export const dirLight = new DirectionalLight(
  "dirLight",
  new Vector3(-1, -1, -1),
  scene
);
dirLight.intensity = 0.8;
