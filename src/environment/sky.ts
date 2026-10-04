import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { scene } from '../scene/engine';

// Scatter soft, fluffy cloud clumps in the blue-sky band (avoids the zenith and the horizon glow).
function drawCloudPuff(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  cx: number,
  cy: number,
  radius: number,
  alpha: number
) {
  // Draw wrapped copies too so clouds near the left/right edge don't create a seam
  // where the sphere's UV wraps from x=width back to x=0.
  const offsets = [0];
  if (cx - radius < 0) offsets.push(canvasWidth);
  if (cx + radius > canvasWidth) offsets.push(-canvasWidth);

  for (const dx of offsets) {
    const puffGradient = ctx.createRadialGradient(cx + dx, cy, 0, cx + dx, cy, radius);
    puffGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    puffGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = puffGradient;
    ctx.beginPath();
    ctx.arc(cx + dx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Procedural gradient skybox with soft clouds (day sky, no external texture assets needed).
export function createSky(): Mesh {
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 512;
  skyCanvas.height = 512;
  const skyCtx = skyCanvas.getContext("2d")!;
  const skyGradient = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
  skyGradient.addColorStop(0, "#1a3d8f");
  skyGradient.addColorStop(0.45, "#4d8fd6");
  skyGradient.addColorStop(0.75, "#bfe0f2");
  skyGradient.addColorStop(1, "#eaf6ff");
  skyCtx.fillStyle = skyGradient;
  skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);

  const cloudCount = 14;
  for (let i = 0; i < cloudCount; i++) {
    const clusterX = Math.random() * skyCanvas.width;
    const clusterY = skyCanvas.height * (0.16 + Math.random() * 0.38);
    const puffs = 4 + Math.floor(Math.random() * 4);
    for (let p = 0; p < puffs; p++) {
      const offsetX = (Math.random() - 0.5) * 70;
      const offsetY = (Math.random() - 0.5) * 18;
      const radius = 18 + Math.random() * 26;
      drawCloudPuff(skyCtx, skyCanvas.width, clusterX + offsetX, clusterY + offsetY, radius, 0.35 + Math.random() * 0.3);
    }
  }

  const skyTexture = new DynamicTexture(
    "skyTexture",
    skyCanvas,
    scene,
    false,
    Texture.TRILINEAR_SAMPLINGMODE
  );
  skyTexture.update(false);
  skyTexture.wrapU = Texture.WRAP_ADDRESSMODE;
  skyTexture.wrapV = Texture.CLAMP_ADDRESSMODE;

  const skyMaterial = new StandardMaterial("skyMaterial", scene);
  skyMaterial.diffuseTexture = skyTexture;
  skyMaterial.emissiveColor = new Color3(1, 1, 1);
  skyMaterial.disableLighting = true;
  skyMaterial.specularColor = new Color3(0, 0, 0);
  skyMaterial.backFaceCulling = false;
  // Never let the huge sky sphere win the depth test and occlude real geometry.
  skyMaterial.disableDepthWrite = true;

  const skyBox = MeshBuilder.CreateSphere("skyBox", { diameter: 900, segments: 16 }, scene);
  skyBox.material = skyMaterial;
  skyBox.infiniteDistance = true;
  skyBox.applyFog = false;
  skyBox.renderingGroupId = 0;

  return skyBox;
}
