import { Camera } from '@babylonjs/core/Cameras/camera.pure';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { engine, scene } from '../scene/engine';
import { attachToARTransform } from '../xr/ar';
import { registerMenuButton } from '../menu/handMenu';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS, HASH_OFFSETS_YARDS } from './constants';
import { TOP_DOWN_MARKER_LAYER_MASK, playAll } from '../robot/robot';
import { INTRO_DURATION_MS } from '../camera/desktopCamera';

declare const __BUILD_TIME__: string | undefined;

function formatBuildStamp(rawValue?: string): string {
  const fallback = "20260905123456";
  const value = rawValue ?? __BUILD_TIME__ ?? fallback;
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export interface VideoBoardResult {
  // Redraws the on-screen progress bar for the currently selected robot's walk.
  updateProgress: (progress: number | null) => void;
  updateFieldLevel: (level: string) => void;
  setScreenSize: (scale: number) => void;
}

function createVideoField() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 1152;
  const ctx = canvas.getContext("2d")!;
  const xAt = (yards: number) => (yards / FIELD_WIDTH_YARDS + 0.5) * canvas.width;
  const zAt = (yards: number) => (yards / FIELD_LENGTH_YARDS + 0.5) * canvas.height;
  const yardsX = canvas.width / FIELD_WIDTH_YARDS;
  const yardsZ = canvas.height / FIELD_LENGTH_YARDS;
  const texture = new DynamicTexture("videoFieldTexture", canvas, scene, false);

  function updateFieldLevel(level: string) {
    ctx.fillStyle = "#3a923f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let z = -50; z < 50; z += 10) {
      ctx.fillStyle = "#419e44";
      ctx.fillRect(0, zAt(z), canvas.width, 5 * yardsZ);
    }
    ctx.fillStyle = "#061233";
    ctx.fillRect(0, 0, canvas.width, 10 * yardsZ);
    ctx.fillStyle = "#091c4a";
    ctx.fillRect(0, zAt(50), canvas.width, 10 * yardsZ);

    ctx.strokeStyle = "#f5f7ef";
    ctx.lineWidth = 0.42 * yardsZ;
    for (let z = -50; z <= 50; z += 5) {
      ctx.beginPath();
      ctx.moveTo(0, zAt(z));
      ctx.lineTo(canvas.width, zAt(z));
      ctx.stroke();
    }
    ctx.lineWidth = 0.2 * yardsX;
    for (const x of [-FIELD_WIDTH_YARDS / 2, FIELD_WIDTH_YARDS / 2]) {
      ctx.beginPath();
      ctx.moveTo(xAt(x), 0);
      ctx.lineTo(xAt(x), canvas.height);
      ctx.stroke();
    }
    ctx.fillStyle = "#f5f7ef";
    const hashOffset = HASH_OFFSETS_YARDS[level] ?? HASH_OFFSETS_YARDS.nfl;
    for (let z = -49; z <= 49; z++) {
      for (const x of [-hashOffset, hashOffset]) {
        ctx.fillRect(xAt(x - 0.35), zAt(z - 0.12), 0.7 * yardsX, 0.24 * yardsZ);
      }
    }
    ctx.font = `bold ${2.5 * yardsX}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let z = -40; z <= 40; z += 10) {
      for (const x of [-FIELD_WIDTH_YARDS / 2 + 12, FIELD_WIDTH_YARDS / 2 - 12]) {
        ctx.save();
        ctx.translate(xAt(x), zAt(z));
        ctx.rotate(x < 0 ? Math.PI / 2 : -Math.PI / 2);
        ctx.scale(-1, 1);
        ctx.fillText(String(50 - Math.abs(z)), 0, 0);
        ctx.restore();
      }
    }
    texture.update(false);
  }

  updateFieldLevel("highschool");
  const material = new StandardMaterial("videoFieldMaterial", scene);
  material.diffuseTexture = texture;
  material.emissiveColor = Color3.White();
  material.disableLighting = true;
  const mesh = MeshBuilder.CreateGround(
    "videoField",
    { width: FIELD_WIDTH_YARDS, height: FIELD_LENGTH_YARDS },
    scene
  );
  mesh.position.y = -0.43;
  mesh.layerMask = TOP_DOWN_MARKER_LAYER_MASK;
  mesh.isPickable = false;
  mesh.material = material;
  return { mesh, updateFieldLevel };
}

// A straight-down orthographic view of the whole field, rendered live into a
// texture so the board can show every robot's position from above. The
// camera's up vector is the field's width axis so the field's long edge
// (its length) maps to the image's horizontal axis, matching the screen's
// landscape shape instead of running the long edge top-to-bottom.
function createTopDownFieldTexture(
  videoField: Mesh,
  refreshIntervalSeconds: number
): RenderTargetTexture {
  const camera = new FreeCamera("topDownViewCamera", new Vector3(0, 80, 0), scene);
  camera.upVector = new Vector3(1, 0, 0);
  camera.setTarget(new Vector3(0, 0, 0));
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  // See the normal scene plus each robot's oversized top-down marker disc.
  camera.layerMask |= TOP_DOWN_MARKER_LAYER_MASK;
  const halfWidth = FIELD_WIDTH_YARDS / 2 + 6;
  const halfLength = FIELD_LENGTH_YARDS / 2 + 6;
  camera.orthoLeft = -halfLength;
  camera.orthoRight = halfLength;
  camera.orthoTop = halfWidth;
  camera.orthoBottom = -halfWidth;
  camera.minZ = 1;
  camera.maxZ = 200;

  // Match the texture's aspect ratio to the ortho frustum's so the field
  // itself isn't stretched before it's mapped onto the (differently shaped) screen.
  const textureWidth = 512;
  const textureHeight = Math.round(textureWidth * (halfWidth / halfLength));
  const rtt = new RenderTargetTexture(
    "topDownViewTexture",
    { width: textureWidth, height: textureHeight },
    scene,
    false
  );
  rtt.activeCamera = camera;
  rtt.renderList = [videoField];
  const refreshInterval = Math.max(0.1, refreshIntervalSeconds);
  let elapsedSeconds = refreshInterval;
  scene.onBeforeRenderObservable.add(() => {
    elapsedSeconds += engine.getDeltaTime() / 1000;
    if (elapsedSeconds < refreshInterval) return;

    elapsedSeconds %= refreshInterval;
    videoField.computeWorldMatrix(true);
    const world = videoField.getWorldMatrix();
    const scale = Vector3.TransformNormal(Vector3.Up(), world).length();
    const cameraPosition = Vector3.TransformCoordinates(new Vector3(0, 80, 0), world);
    camera.position.copyFrom(cameraPosition);
    camera.upVector = Vector3.TransformNormal(new Vector3(1, 0, 0), world).normalize();
    const down = Vector3.TransformNormal(Vector3.Down(), world).normalize();
    camera.setTarget(camera.position.add(down.scale(80)));
    // setTarget nudges vertical views in Z; keep that offset out of the scaled framing.
    camera.position.copyFrom(cameraPosition);
    camera.orthoLeft = -halfLength * scale;
    camera.orthoRight = halfLength * scale;
    camera.orthoTop = halfWidth * scale;
    camera.orthoBottom = -halfWidth * scale;
    camera.minZ = scale;
    camera.maxZ = 200 * scale;
    rtt.renderList = [videoField, ...scene.meshes.filter((mesh) => mesh.name === "robotTopDownMarker")];
    rtt.render();
  });
  return rtt;
}

// Large LED-style billboard at the stadium edge, visible from the main viewing angle.
// Its main screen is a live top-down feed of the field; a HUD strip along the
// bottom carries the title/timestamp and the selected robot's playback progress.
export function createVideoBoard(
  refreshIntervalSeconds = 0.1
): VideoBoardResult {
  const videoField = createVideoField();
  const boardMeshesStart = scene.meshes.length;
  const boardWidth = 24;
  const boardHeight = 13;
  const boardZ = 68;
  const boardY = 14;

  const hudCanvas = document.createElement("canvas");
  hudCanvas.width = 640;
  hudCanvas.height = 100;
  const hudCtx = hudCanvas.getContext("2d")!;

  const progressBarArea = { x: 190, y: 34, width: hudCanvas.width - 190 - 16, height: 22 };

  function drawHud(progress: number | null) {
    hudCtx.fillStyle = "#0b1a3d";
    hudCtx.fillRect(0, 0, hudCanvas.width, hudCanvas.height);
    hudCtx.strokeStyle = "#1c2a4a";
    hudCtx.lineWidth = 4;
    hudCtx.strokeRect(2, 2, hudCanvas.width - 4, hudCanvas.height - 4);

    hudCtx.fillStyle = "#ffcf40";
    hudCtx.font = "bold 28px 'Segoe UI', Arial";
    hudCtx.textAlign = "left";
    hudCtx.textBaseline = "middle";
    hudCtx.fillText("Chartxr", 16, 34);

    hudCtx.fillStyle = "#dfe8ff";
    hudCtx.font = "16px 'Segoe UI', Arial";
    hudCtx.fillText(formatBuildStamp(), 16, 64);

    const { x, y, width, height } = progressBarArea;
    const radius = height / 2;
    hudCtx.fillStyle = "rgba(255, 255, 255, 0.15)";
    roundedRect(hudCtx, x, y, width, height, radius);
    hudCtx.fill();

    const clamped = Math.min(1, Math.max(0, progress ?? 0));
    const fillWidth = Math.max(height, width * clamped);
    hudCtx.fillStyle = "#3f7cf7";
    roundedRect(hudCtx, x, y, fillWidth, height, radius);
    hudCtx.fill();

    hudCtx.beginPath();
    hudCtx.arc(x + fillWidth - radius, y + height / 2, radius + 4, 0, Math.PI * 2);
    hudCtx.fillStyle = "#ffffff";
    hudCtx.fill();
  }

  drawHud(0);

  const hudTexture = new DynamicTexture(
    "videoBoardHudTexture",
    hudCanvas,
    scene,
    false,
    Texture.TRILINEAR_SAMPLINGMODE
  );
  hudTexture.update(true);

  const hudMaterial = new StandardMaterial("videoBoardHudMaterial", scene);
  hudMaterial.diffuseTexture = hudTexture;
  hudMaterial.emissiveColor = new Color3(0.95, 0.95, 0.95);
  hudMaterial.disableLighting = true;
  hudMaterial.specularColor = new Color3(0, 0, 0);
  hudMaterial.backFaceCulling = false;

  const feedMaterial = new StandardMaterial("videoBoardMaterial", scene);
  feedMaterial.diffuseTexture = createTopDownFieldTexture(videoField.mesh, refreshIntervalSeconds);
  feedMaterial.emissiveColor = new Color3(0.95, 0.95, 0.95);
  feedMaterial.disableLighting = true;
  feedMaterial.specularColor = new Color3(0, 0, 0);
  feedMaterial.backFaceCulling = false;

  const frameMaterial = new StandardMaterial("videoBoardFrameMaterial", scene);
  frameMaterial.diffuseColor = new Color3(0.15, 0.16, 0.18);
  frameMaterial.specularColor = new Color3(0.1, 0.1, 0.1);

  const frame = MeshBuilder.CreateBox(
    "videoBoardFrame",
    { width: boardWidth + 0.8, height: boardHeight + 0.8, depth: 0.7 },
    scene
  );
  frame.position = new Vector3(0, boardY, boardZ);
  frame.material = frameMaterial;

  const screen = MeshBuilder.CreatePlane(
    "videoBoardScreen",
    { width: boardWidth, height: boardHeight },
    scene
  );
  screen.position = new Vector3(0, boardY, boardZ - 0.45);
  screen.material = feedMaterial;

  // Start marching after the intro camera move finishes.
  setTimeout(() => {
    playAll();
  }, INTRO_DURATION_MS);

  const hudHeight = boardHeight * 0.18;
  const hud = MeshBuilder.CreatePlane(
    "videoBoardHud",
    { width: boardWidth, height: hudHeight },
    scene
  );
  hud.position = new Vector3(0, boardY - boardHeight / 2 + hudHeight / 2, boardZ - 0.47);
  hud.material = hudMaterial;

  const poleMaterial = new StandardMaterial("videoBoardPoleMaterial", scene);
  poleMaterial.diffuseColor = new Color3(0.2, 0.21, 0.23);

  // Poles run from the actual field surface (y=-0.5) up to the board frame.
  const videoBoardPoleTopY = boardY - boardHeight / 2 + 0.3;
  const videoBoardPoleHeight = videoBoardPoleTopY - -0.5;
  for (const x of [-4.5, 4.5]) {
    const pole = MeshBuilder.CreateCylinder(
      `videoBoardPole${x}`,
      { diameter: 0.6, height: videoBoardPoleHeight },
      scene
    );
    pole.position = new Vector3(x, -0.5 + videoBoardPoleHeight / 2, boardZ);
    pole.material = poleMaterial;
  }

  createVideoBoardButtons(boardY - boardHeight / 2 - 1.2, boardZ - 0.6);

  const boardRoot = new TransformNode("videoBoardRoot", scene);
  boardRoot.position.set(0, -0.5, boardZ);
  scene.meshes.slice(boardMeshesStart).forEach((mesh) => {
    if (!mesh.parent) mesh.setParent(boardRoot);
  });
  attachToARTransform(boardRoot);

  let lastHudProgress = 0;
  let lastHudUpdateTime = -Infinity;

  return {
    updateFieldLevel: videoField.updateFieldLevel,
    setScreenSize(scale) {
      boardRoot.scaling.setAll(Math.min(1.75, Math.max(0.5, scale)));
    },
    updateProgress(progress) {
      const shownProgress = Math.min(1, Math.max(0, progress ?? 0));
      if (shownProgress === lastHudProgress) return;
      const now = performance.now();
      if (now - lastHudUpdateTime < 100 && shownProgress !== 0 && shownProgress !== 1) return;
      lastHudProgress = shownProgress;
      lastHudUpdateTime = now;
      drawHud(shownProgress);
      hudTexture.update(true);
    },
  };
}

// A row of large, easy-to-see-from-a-distance media buttons mounted on a
// backing panel just below the screen, controlling the same selected-robot
// playback as the palm-up hand menu (tagged via registerMenuButton).
function createVideoBoardButtons(y: number, z: number) {
  const buttonMaterial = new StandardMaterial("videoBoardButtonMaterial", scene);
  buttonMaterial.diffuseColor = new Color3(0.15, 0.16, 0.18);
  buttonMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
  buttonMaterial.backFaceCulling = false;

  const labels: { text: string; action: "rewind" | "stepBack" | "playPause" | "stepForward" | "fastForward" }[] = [
    { text: "<<", action: "rewind" },
    { text: "<|", action: "stepBack" },
    { text: ">||", action: "playPause" },
    { text: "|>", action: "stepForward" },
    { text: ">>", action: "fastForward" },
  ];

  const buttonSize = 1.4;
  const spacing = buttonSize + 0.5;
  const startX = -((labels.length - 1) / 2) * spacing;
  const panelDepth = 0.3;
  const panelPadding = 0.6;

  const panelMaterial = new StandardMaterial("videoBoardButtonPanelMaterial", scene);
  panelMaterial.diffuseColor = new Color3(0.12, 0.13, 0.15);
  panelMaterial.specularColor = new Color3(0.1, 0.1, 0.1);

  const panelWidth = spacing * (labels.length - 1) + buttonSize + panelPadding;
  const panelHeight = buttonSize + panelPadding;
  const panel = MeshBuilder.CreateBox(
    "videoBoardButtonPanel",
    {
      width: panelWidth,
      height: panelHeight,
      depth: panelDepth,
    },
    scene
  );
  panel.position = new Vector3(0, y, z + panelDepth / 2);
  panel.material = panelMaterial;

  labels.forEach((label, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1c2a4a";
    roundedRect(ctx, 4, 4, 120, 120, 24);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label.text, 64, 68);

    const texture = new DynamicTexture(`videoBoardButtonTexture-${label.action}`, canvas, scene, false);
    texture.hasAlpha = true;
    texture.update(true);

    const material = buttonMaterial.clone(`videoBoardButtonMaterial-${label.action}`);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.emissiveColor = new Color3(1, 1, 1);
    material.disableLighting = true;

    const button = MeshBuilder.CreatePlane(
      `videoBoardButton-${label.action}`,
      { width: buttonSize, height: buttonSize },
      scene
    );
    button.material = material;
    button.parent = panel;
    button.position = new Vector3(startX + index * spacing, 0, -panelDepth / 2 - 0.02);

    registerMenuButton(button, { action: label.action });
  });

  createTitleBanner(y - panelHeight / 2, z + panelDepth / 2, panelWidth);
}

// A small "Chartxr" banner mounted just below the media button panel.
function createTitleBanner(panelBottomY: number, z: number, width: number) {
  const bannerHeight = 1.0;
  const gap = 0.3;

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#12131a";
  roundedRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 24);
  ctx.fill();
  ctx.fillStyle = "#ffcf40";
  ctx.font = "bold 64px 'Segoe UI', Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Chartxr", canvas.width / 2, canvas.height / 2);

  const texture = new DynamicTexture("videoBoardBannerTexture", canvas, scene, false);
  texture.update(true);

  const material = new StandardMaterial("videoBoardBannerMaterial", scene);
  material.diffuseTexture = texture;
  material.emissiveColor = new Color3(0.95, 0.95, 0.95);
  material.disableLighting = true;
  material.specularColor = new Color3(0, 0, 0);
  material.backFaceCulling = false;

  const banner = MeshBuilder.CreatePlane("videoBoardBanner", { width, height: bannerHeight }, scene);
  banner.position = new Vector3(0, panelBottomY - gap - bannerHeight / 2, z);
  banner.material = material;
}
