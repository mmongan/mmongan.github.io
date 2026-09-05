import * as BABYLON from 'babylonjs';
import { scene } from '../engineScene';
import { FIELD_LENGTH_YARDS, FIELD_WIDTH_YARDS, END_ZONE_DEPTH_YARDS } from './constants';

export interface TurfResult {
  outerBase: BABYLON.Mesh;
  field: BABYLON.Mesh;
  fieldLines: BABYLON.Mesh;
  whiteMaterial: BABYLON.StandardMaterial;
  sidelineMat: BABYLON.StandardMaterial;
}

export function createTurf(): TurfResult {
  const outerBase = BABYLON.MeshBuilder.CreateGround(
    "outerBase",
    { width: FIELD_WIDTH_YARDS + 22, height: FIELD_LENGTH_YARDS + 16 },
    scene
  );
  outerBase.position.y = -0.8;

  const outerBaseMat = new BABYLON.StandardMaterial("outerBaseMat", scene);
  outerBaseMat.diffuseColor = new BABYLON.Color3(0.18, 0.2, 0.22);
  outerBase.material = outerBaseMat;
  outerBase.checkCollisions = true;

  const turfCanvas = document.createElement("canvas");
  turfCanvas.width = 512;
  turfCanvas.height = 512;
  const turfCtx = turfCanvas.getContext("2d")!;

  const baseGradient = turfCtx.createLinearGradient(0, 0, turfCanvas.width, turfCanvas.height);
  baseGradient.addColorStop(0, "rgb(48, 116, 52)");
  baseGradient.addColorStop(0.5, "rgb(82, 152, 62)");
  baseGradient.addColorStop(1, "rgb(36, 103, 46)");
  turfCtx.fillStyle = baseGradient;
  turfCtx.fillRect(0, 0, turfCanvas.width, turfCanvas.height);

  for (let y = 0; y < turfCanvas.height; y += 4) {
    for (let x = 0; x < turfCanvas.width; x += 4) {
      const variance = Math.random() * 26;
      const green = 110 + variance;
      const red = 60 + Math.random() * 20;
      const blue = 42 + Math.random() * 18;
      turfCtx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      turfCtx.fillRect(x, y, 4, 4);
    }
  }

  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * turfCanvas.width;
    const y = Math.random() * turfCanvas.height;
    const length = 4 + Math.random() * 10;
    const angle = Math.random() * Math.PI;
    turfCtx.strokeStyle = `rgba(16, ${66 + Math.random() * 30}, 18, ${0.28 + Math.random() * 0.42})`;
    turfCtx.lineWidth = 1 + Math.random() * 1.4;
    turfCtx.beginPath();
    turfCtx.moveTo(x, y);
    turfCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    turfCtx.stroke();
  }

  for (let i = 0; i < 400; i++) {
    const x = Math.random() * turfCanvas.width;
    const y = Math.random() * turfCanvas.height;
    const radius = 4 + Math.random() * 12;
    turfCtx.beginPath();
    turfCtx.fillStyle = `rgba(20, 90, 25, ${0.08 + Math.random() * 0.2})`;
    turfCtx.arc(x, y, radius, 0, Math.PI * 2);
    turfCtx.fill();
  }

  // Tile the grass detail once per yard so blades stay a realistic size.
  const turfTexture = new BABYLON.DynamicTexture(
    "grassTexture",
    turfCanvas,
    scene,
    true,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  turfTexture.update(false);
  turfTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  turfTexture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  turfTexture.uScale = FIELD_WIDTH_YARDS;
  turfTexture.vScale = FIELD_LENGTH_YARDS;
  turfTexture.anisotropicFilteringLevel = 16;

  const fieldMaterial = new BABYLON.StandardMaterial("fieldMat", scene);
  fieldMaterial.diffuseTexture = turfTexture;
  fieldMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.95, 0.9);
  fieldMaterial.specularColor = new BABYLON.Color3(0.08, 0.14, 0.08);

  const field = BABYLON.MeshBuilder.CreateGround(
    "field",
    { width: FIELD_WIDTH_YARDS, height: FIELD_LENGTH_YARDS, subdivisions: 48 },
    scene
  );
  field.position.y = -0.5;
  field.material = fieldMaterial;

  // Mow-stripe bands as a flat, non-tiled overlay so the grass texture never stretches.
  const stripeCanvas = document.createElement("canvas");
  stripeCanvas.width = 4;
  const yardsPerBand = 5;
  const bandCount = FIELD_LENGTH_YARDS / yardsPerBand;
  stripeCanvas.height = bandCount * 4;
  const stripeCtx = stripeCanvas.getContext("2d")!;
  for (let band = 0; band < bandCount; band++) {
    stripeCtx.fillStyle = band % 2 === 0 ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.12)";
    stripeCtx.fillRect(0, band * 4, stripeCanvas.width, 4);
  }

  const stripeTexture = new BABYLON.DynamicTexture(
    "mowStripeTexture",
    stripeCanvas,
    scene,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  stripeTexture.update(false);
  stripeTexture.hasAlpha = true;

  const stripeMaterial = new BABYLON.StandardMaterial("stripeMat", scene);
  stripeMaterial.diffuseTexture = stripeTexture;
  stripeMaterial.opacityTexture = stripeTexture;
  stripeMaterial.disableLighting = true;
  stripeMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1);
  stripeMaterial.specularColor = new BABYLON.Color3(0, 0, 0);

  const mowStripes = BABYLON.MeshBuilder.CreateGround(
    "mowStripes",
    { width: FIELD_WIDTH_YARDS, height: FIELD_LENGTH_YARDS, subdivisions: 24 },
    scene
  );
  mowStripes.position.y = -0.49;
  mowStripes.material = stripeMaterial;

  const whiteMaterial = new BABYLON.StandardMaterial("fieldLineMat", scene);
  whiteMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
  whiteMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

  const endZoneMatLeft = new BABYLON.StandardMaterial("endZoneMatLeft", scene);
  endZoneMatLeft.diffuseColor = new BABYLON.Color3(0.26, 0.2, 0.03);
  endZoneMatLeft.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

  const endZoneMatRight = new BABYLON.StandardMaterial("endZoneMatRight", scene);
  endZoneMatRight.diffuseColor = new BABYLON.Color3(0.24, 0.05, 0.06);
  endZoneMatRight.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

  const leftEndZone = BABYLON.MeshBuilder.CreateBox(
    "leftEndZone",
    { width: FIELD_WIDTH_YARDS, height: 0.06, depth: END_ZONE_DEPTH_YARDS },
    scene
  );
  leftEndZone.position = new BABYLON.Vector3(0, -0.47, -55);
  leftEndZone.material = endZoneMatLeft;

  const rightEndZone = BABYLON.MeshBuilder.CreateBox(
    "rightEndZone",
    { width: FIELD_WIDTH_YARDS, height: 0.06, depth: END_ZONE_DEPTH_YARDS },
    scene
  );
  rightEndZone.position = new BABYLON.Vector3(0, -0.47, 55);
  rightEndZone.material = endZoneMatRight;

  const fieldLines = new BABYLON.Mesh("fieldLines", scene);

  for (let z = -50; z <= 50; z += 5) {
    const line = BABYLON.MeshBuilder.CreateBox(
      `yardLine${z}`,
      { width: FIELD_WIDTH_YARDS, height: 0.015, depth: 0.18 },
      scene
    );
    line.position = new BABYLON.Vector3(0, -0.48, z);
    line.material = whiteMaterial;
    line.parent = fieldLines;

    if (Math.abs(z) === 0) {
      line.scaling.z = 2.4;
    }
  }

  const midfieldLine = BABYLON.MeshBuilder.CreateBox(
    "midfieldLine",
    { width: FIELD_WIDTH_YARDS, height: 0.015, depth: 0.32 },
    scene
  );
  midfieldLine.position = new BABYLON.Vector3(0, -0.48, 0);
  midfieldLine.material = whiteMaterial;
  midfieldLine.parent = fieldLines;

  const goalLineNorth = BABYLON.MeshBuilder.CreateBox(
    "goalLineNorth",
    { width: FIELD_WIDTH_YARDS, height: 0.015, depth: 0.26 },
    scene
  );
  goalLineNorth.position = new BABYLON.Vector3(0, -0.48, -60);
  goalLineNorth.material = whiteMaterial;

  const goalLineSouth = BABYLON.MeshBuilder.CreateBox(
    "goalLineSouth",
    { width: FIELD_WIDTH_YARDS, height: 0.015, depth: 0.26 },
    scene
  );
  goalLineSouth.position = new BABYLON.Vector3(0, -0.48, 60);
  goalLineSouth.material = whiteMaterial;

  const sidelineMat = new BABYLON.StandardMaterial("sidelineMat", scene);
  sidelineMat.diffuseColor = new BABYLON.Color3(0.92, 0.92, 0.92);

  const leftSideline = BABYLON.MeshBuilder.CreateBox(
    "leftSideline",
    { width: 0.2, height: 0.015, depth: FIELD_LENGTH_YARDS },
    scene
  );
  leftSideline.position = new BABYLON.Vector3(-FIELD_WIDTH_YARDS / 2, -0.48, 0);
  leftSideline.material = whiteMaterial;

  const rightSideline = BABYLON.MeshBuilder.CreateBox(
    "rightSideline",
    { width: 0.2, height: 0.015, depth: FIELD_LENGTH_YARDS },
    scene
  );
  rightSideline.position = new BABYLON.Vector3(FIELD_WIDTH_YARDS / 2, -0.48, 0);
  rightSideline.material = whiteMaterial;

  return { outerBase, field, fieldLines, whiteMaterial, sidelineMat };
}
