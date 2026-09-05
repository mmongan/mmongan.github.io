import * as BABYLON from 'babylonjs';
import { canvas } from './dom';

export const engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  antialias: true,
});

export const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.09, 1);

// Distance haze so the horizon ground fades out instead of ending at a hard edge.
scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
scene.fogColor = new BABYLON.Color3(0.75, 0.88, 0.95);
scene.fogStart = 90;
scene.fogEnd = 260;

// Physically block the fly camera from passing through the ground or the
// bleachers, instead of just clamping altitude.
scene.collisionsEnabled = true;

export const hemiLight = new BABYLON.HemisphericLight(
  "hemiLight",
  new BABYLON.Vector3(0, 1, 0),
  scene
);
hemiLight.intensity = 1.1;

export const dirLight = new BABYLON.DirectionalLight(
  "dirLight",
  new BABYLON.Vector3(-1, -1, -1),
  scene
);
dirLight.intensity = 0.8;
