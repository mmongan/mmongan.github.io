// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

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
    // Hold a dense core before falling off, so puffs read as cloud matter
    // rather than an airbrushed glow.
    puffGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    puffGradient.addColorStop(0.55, `rgba(255, 255, 255, ${alpha * 0.8})`);
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
  skyCanvas.width = 1024;
  skyCanvas.height = 512;
  const skyCtx = skyCanvas.getContext("2d")!;
  // Deep zenith through mid blue to a pale, faintly warm horizon haze.
  const skyGradient = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
  skyGradient.addColorStop(0, "#15347c");
  skyGradient.addColorStop(0.4, "#3f84d2");
  skyGradient.addColorStop(0.72, "#a9d4ee");
  skyGradient.addColorStop(0.9, "#e4f2fb");
  skyGradient.addColorStop(1, "#f5f2e3");
  skyCtx.fillStyle = skyGradient;
  skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);

  // Thin, faint high-altitude streaks above the cumulus band.
  for (let i = 0; i < 6; i++) {
    const y = skyCanvas.height * (0.08 + Math.random() * 0.12);
    const x = Math.random() * skyCanvas.width;
    const length = 4 + Math.floor(Math.random() * 4);
    for (let p = 0; p < length; p++) {
      drawCloudPuff(skyCtx, skyCanvas.width, x + p * 26, y + (Math.random() - 0.5) * 4,
        14 + Math.random() * 10, 0.08 + Math.random() * 0.05);
    }
  }

  // Cumulus clusters: domed bright tops over a flatter base, with a soft
  // blue-grey underside shade so the clouds read as lit from above.
  const cloudCount = 10;
  for (let i = 0; i < cloudCount; i++) {
    const clusterX = Math.random() * skyCanvas.width;
    const clusterY = skyCanvas.height * (0.18 + Math.random() * 0.34);
    const scale = 0.5 + Math.random() * 0.55;
    for (const dx of [0, skyCanvas.width, -skyCanvas.width]) {
      const shade = skyCtx.createRadialGradient(clusterX + dx, clusterY + 10 * scale, 0,
        clusterX + dx, clusterY + 10 * scale, 70 * scale);
      shade.addColorStop(0, "rgba(140, 160, 190, 0.12)");
      shade.addColorStop(1, "rgba(140, 160, 190, 0)");
      skyCtx.fillStyle = shade;
      skyCtx.beginPath();
      skyCtx.ellipse(clusterX + dx, clusterY + 10 * scale, 80 * scale, 14 * scale, 0, 0, Math.PI * 2);
      skyCtx.fill();
    }
    const puffs = 9 + Math.floor(Math.random() * 5);
    for (let p = 0; p < puffs; p++) {
      const offsetX = (Math.random() - 0.5) * 120 * scale;
      // Keep puff centres at or above the cluster base for a flat-bottomed dome.
      const offsetY = -Math.random() * 20 * scale;
      const radius = (10 + Math.random() * 12) * scale;
      const alpha = 0.32 + 0.3 * (1 - Math.abs(offsetX) / (65 * scale)) + Math.random() * 0.1;
      drawCloudPuff(skyCtx, skyCanvas.width, clusterX + offsetX, clusterY + offsetY, radius,
        Math.max(0.22, Math.min(0.65, alpha)));
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
