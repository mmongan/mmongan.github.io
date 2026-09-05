import * as BABYLON from 'babylonjs';
import { scene } from './engineScene';

export const platform = BABYLON.MeshBuilder.CreateCylinder(
  "platform",
  { diameter: 2.5, height: 0.25, tessellation: 24 },
  scene
);
platform.position.y = 0.1;
const platformMat = new BABYLON.StandardMaterial("platformMat", scene);
platformMat.diffuseColor = new BABYLON.Color3(0.3, 0.48, 0.8);
platformMat.emissiveColor = new BABYLON.Color3(0.08, 0.1, 0.2);
platform.material = platformMat;

export const box = BABYLON.MeshBuilder.CreateBox("box", { size: 0.9 }, scene);
box.position = new BABYLON.Vector3(0, 1.2, 0);
const boxMat = new BABYLON.StandardMaterial("boxMat", scene);
boxMat.diffuseColor = new BABYLON.Color3(1, 0.52, 0.2);
boxMat.emissiveColor = new BABYLON.Color3(0.18, 0.1, 0.03);
box.material = boxMat;

export const torus = BABYLON.MeshBuilder.CreateTorus(
  "torus",
  { diameter: 1.4, thickness: 0.24, tessellation: 32 },
  scene
);
torus.position = new BABYLON.Vector3(1.8, 1.6, -1.1);
torus.rotation.x = Math.PI / 2;
const torusMat = new BABYLON.StandardMaterial("torusMat", scene);
torusMat.diffuseColor = new BABYLON.Color3(0.34, 0.92, 0.75);
torusMat.emissiveColor = new BABYLON.Color3(0.05, 0.2, 0.18);
torus.material = torusMat;

export const moon = BABYLON.MeshBuilder.CreateSphere(
  "moon",
  { diameter: 0.7, segments: 32 },
  scene
);
moon.position = new BABYLON.Vector3(-1.7, 1.6, 1.2);
const moonMat = new BABYLON.StandardMaterial("moonMat", scene);
moonMat.diffuseColor = new BABYLON.Color3(0.88, 0.92, 1);
moonMat.emissiveColor = new BABYLON.Color3(0.15, 0.17, 0.2);
moon.material = moonMat;

export const ring = BABYLON.MeshBuilder.CreateTorus(
  "ring",
  { diameter: 2.4, thickness: 0.06, tessellation: 40 },
  scene
);
ring.position = new BABYLON.Vector3(-1.7, 1.5, 1.2);
ring.rotation.x = Math.PI / 2;
ring.rotation.z = Math.PI / 4;
const ringMat = new BABYLON.StandardMaterial("ringMat", scene);
ringMat.diffuseColor = new BABYLON.Color3(0.8, 0.76, 1);
ringMat.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.25);
ring.material = ringMat;

export const globe = BABYLON.MeshBuilder.CreateSphere(
  "globe",
  { diameter: 0.8, segments: 32 },
  scene
);
globe.position = new BABYLON.Vector3(2.2, 0.8, 1.7);
const globeMat = new BABYLON.StandardMaterial("globeMat", scene);
globeMat.diffuseColor = new BABYLON.Color3(0.72, 0.88, 1);
globeMat.emissiveColor = new BABYLON.Color3(0.1, 0.18, 0.25);
globe.material = globeMat;

export const interactiveObjects = [
  { mesh: box, label: "Core Cube" },
  { mesh: torus, label: "Orbit Ring" },
  { mesh: moon, label: "Lunar Orb" },
  { mesh: globe, label: "Crystal Sphere" },
];

export function animateDecor() {
  scene.registerBeforeRender(() => {
    box.rotation.y += 0.014;
    box.rotation.x += 0.012;
    torus.rotation.z += 0.015;
    moon.rotation.y += 0.01;
    ring.rotation.y += 0.01;
    globe.rotation.y += 0.012;
    globe.position.y = 0.8 + Math.sin((performance.now() / 800) % (Math.PI * 2)) * 0.25;
  });
}
