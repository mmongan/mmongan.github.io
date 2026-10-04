import * as BABYLON from 'babylonjs';
import { scene } from '../scene/engine';

// How closely the controller's local "up" must line up with world up to
// count as palm-up (like checking a smartwatch). May need tuning per headset.
const PALM_UP_DOT_THRESHOLD = 0.6;
const BAR_WIDTH = 0.14;
const BAR_HEIGHT = 0.03;
const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 64;
const BUTTON_SIZE = 0.022;
const BUTTON_Y = 0.09;

export type HandMenuHit =
  | { action: "playPause" | "rewind" | "fastForward" | "stepBack" | "stepForward" | "fullScaleVR" | "tabletopScale" }
  | { action: "seek"; fraction: number };

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

function drawProgressBar(ctx: CanvasRenderingContext2D, texture: BABYLON.DynamicTexture, progress: number) {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const trackX = 8;
  const trackY = 22;
  const trackWidth = CANVAS_WIDTH - 16;
  const trackHeight = 20;
  const radius = trackHeight / 2;

  ctx.fillStyle = "rgba(18, 22, 32, 0.85)";
  roundedRect(ctx, trackX, trackY, trackWidth, trackHeight, radius);
  ctx.fill();

  const clampedProgress = Math.min(1, Math.max(0, progress));
  const fillWidth = Math.max(trackHeight, trackWidth * clampedProgress);
  ctx.fillStyle = "#3f7cf7";
  roundedRect(ctx, trackX, trackY, fillWidth, trackHeight, radius);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(trackX + fillWidth - radius, trackY + trackHeight / 2, radius + 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  texture.update(true);
}

function createProgressBarPlane() {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d")!;

  const texture = new BABYLON.DynamicTexture(
    "handProgressBarTexture",
    canvas,
    scene,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  texture.hasAlpha = true;

  const material = new BABYLON.StandardMaterial("handProgressBarMaterial", scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = new BABYLON.Color3(1, 1, 1);
  material.disableLighting = true;
  material.specularColor = new BABYLON.Color3(0, 0, 0);
  material.backFaceCulling = false;

  const plane = BABYLON.MeshBuilder.CreatePlane(
    "handProgressBarPlane",
    { width: BAR_WIDTH, height: BAR_HEIGHT },
    scene
  );
  plane.material = material;
  plane.setEnabled(false);
  // Lie flat, just above the palm, facing up toward the viewer.
  plane.rotation.x = Math.PI / 2;
  plane.position.set(0, BUTTON_Y, -0.045);

  return { plane, texture, ctx };
}

function createButton(label: string, x: number, action: HandMenuHit): BABYLON.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(18, 22, 32, 0.85)";
  roundedRect(ctx, 2, 2, 60, 60, 14);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${label.length > 3 ? 16 : 22}px 'Segoe UI', Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 32, 34);

  const texture = new BABYLON.DynamicTexture(`handMenuButtonTexture-${label}`, canvas, scene, false);
  texture.hasAlpha = true;
  texture.update(true);

  const material = new BABYLON.StandardMaterial(`handMenuButtonMaterial-${label}`, scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = new BABYLON.Color3(1, 1, 1);
  material.disableLighting = true;
  material.specularColor = new BABYLON.Color3(0, 0, 0);
  material.backFaceCulling = false;

  const button = BABYLON.MeshBuilder.CreatePlane(
    `handMenuButton-${label}`,
    { width: BUTTON_SIZE, height: BUTTON_SIZE },
    scene
  );
  button.material = material;
  button.setEnabled(false);
  button.rotation.x = Math.PI / 2;
  button.position = new BABYLON.Vector3(x, BUTTON_Y, 0);

  buttonActions.set(button, action);
  return button;
}

function isPalmUp(controller: BABYLON.WebXRInputSource): boolean {
  const grip = controller.grip;
  if (!grip) return false;
  const localUp = grip.getDirection(BABYLON.Axis.Y);
  return BABYLON.Vector3.Dot(localUp, BABYLON.Vector3.Up()) < PALM_UP_DOT_THRESHOLD;
}

const buttonActions = new Map<BABYLON.AbstractMesh, HandMenuHit>();
let progressBar: ReturnType<typeof createProgressBarPlane> | null = null;
let buttons: BABYLON.Mesh[] = [];
let attachedTo: BABYLON.AbstractMesh | null = null;
let lastDrawnProgress = -1;

// Lets other menus (e.g. the stadium video board) reuse the same trigger-pick
// dispatch in interaction.ts, by tagging any mesh with a hand-menu action.
export function registerMenuButton(mesh: BABYLON.AbstractMesh, action: HandMenuHit) {
  buttonActions.set(mesh, action);
}

export function isMenuControl(mesh: BABYLON.AbstractMesh): boolean {
  return buttonActions.has(mesh) || mesh === progressBar?.plane;
}

export function isHandMenuVisible(): boolean {
  return attachedTo !== null && (progressBar?.plane.isEnabled() ?? false);
}

function ensureMenuMeshes() {
  if (progressBar) return;
  progressBar = createProgressBarPlane();
  const spacing = BUTTON_SIZE + 0.006;
  buttons = [
    createButton("<<", -spacing * 2, { action: "rewind" }),
    createButton("<|", -spacing, { action: "stepBack" }),
    createButton(">||", 0, { action: "playPause" }),
    createButton("|>", spacing, { action: "stepForward" }),
    createButton(">>", spacing * 2, { action: "fastForward" }),
  ];
  const fullScaleButton = createButton("1:1", -spacing / 2, { action: "fullScaleVR" });
  fullScaleButton.position.z = 0.04;
  const tabletopButton = createButton("Table", spacing / 2, { action: "tabletopScale" });
  tabletopButton.position.z = 0.04;
  buttons.push(fullScaleButton, tabletopButton);
}

// Shows a media-player-style panel (progress bar + play/rewind/fast-forward/step
// controls, tracking the selected robot's walk progress) hovering over
// whichever hand is currently turned palm-up.
export function updateHandMenu(
  controllers: ReadonlyMap<string, BABYLON.WebXRInputSource>,
  progress: number | null
) {
  ensureMenuMeshes();
  if (!progressBar) return;

  let palmUpGrip: BABYLON.AbstractMesh | null = null;
  for (const controller of controllers.values()) {
    if (controller.grip && isPalmUp(controller)) {
      palmUpGrip = controller.grip;
      break;
    }
  }

  if (!palmUpGrip) {
    progressBar.plane.setEnabled(false);
    buttons.forEach((button) => button.setEnabled(false));
    attachedTo = null;
    return;
  }

  if (attachedTo !== palmUpGrip) {
    attachedTo = palmUpGrip;
    progressBar.plane.parent = palmUpGrip;
    buttons.forEach((button) => (button.parent = palmUpGrip));
  }
  const menuHeight = palmUpGrip.getDirection(BABYLON.Axis.Y).y < 0 ? -BUTTON_Y : BUTTON_Y;
  const menuRotation = menuHeight < 0 ? -Math.PI / 2 : Math.PI / 2;
  progressBar.plane.position.y = menuHeight;
  progressBar.plane.rotation.x = menuRotation;
  buttons.forEach((button) => {
    button.position.y = menuHeight;
    button.rotation.x = menuRotation;
  });
  progressBar.plane.setEnabled(true);
  buttons.forEach((button) => button.setEnabled(true));

  const shownProgress = progress ?? 0;
  if (Math.abs(shownProgress - lastDrawnProgress) > 0.002) {
    lastDrawnProgress = shownProgress;
    drawProgressBar(progressBar.ctx, progressBar.texture, shownProgress);
  }
}

// Resolves a pick against the hand menu (a button, or a tap along the
// progress bar's track for seeking) into an action, or null if it missed.
export function getHandMenuHit(pick: BABYLON.PickingInfo): HandMenuHit | null {
  const mesh = pick.pickedMesh;
  if (!mesh) return null;

  const buttonAction = buttonActions.get(mesh);
  if (buttonAction) return buttonAction;

  if (progressBar && mesh === progressBar.plane) {
    const uv = pick.getTextureCoordinates();
    if (uv) {
      return { action: "seek", fraction: Math.min(1, Math.max(0, uv.x)) };
    }
  }

  return null;
}

