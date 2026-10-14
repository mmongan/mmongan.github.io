import type { Ray } from '@babylonjs/core/Culling/ray';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import {
  getDrillLastCountIndex,
  getGlobalCountIndex,
  getRobotPositionsAtCount,
  getRobotPositionAtCount,
  seekToCount,
} from '../robot/robot';
import { END_ZONE_DEPTH_YARDS, FIELD_LENGTH_YARDS, FIELD_WIDTH_YARDS, HASH_OFFSETS_YARDS } from '../field/constants';
import { getSelectedFieldLevel } from '../ui/dom';
import { registerMenuButton, type HandMenuHit } from './handMenu';
import { FloatingPanel } from './floatingPanel';
import { PanelTransparencySlider } from './panelTransparencySlider';
import { drawPanelButton, PANEL_FRAME_COLOR, PANEL_PAPER_COLOR } from './panelStyle';
import { getMarcherPOVRobot, getMarcherPOVLabel } from '../camera/marcherPOV';

export const DRILL_CHART_COUNTS_PER_SET = 8;

const PAD_WIDTH = 0.42;
const PAD_HEIGHT = 0.315;
const BACKING_DEPTH = 0.008;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = Math.round(CANVAS_WIDTH * PAD_HEIGHT / PAD_WIDTH);
const FIELD_LEFT = 48;
const FIELD_RIGHT = CANVAS_WIDTH - 48;
const FIELD_TOP = 118;
const FIELD_BOTTOM = FIELD_TOP + (FIELD_RIGHT - FIELD_LEFT) * FIELD_WIDTH_YARDS / FIELD_LENGTH_YARDS;
const BUTTON_WIDTH = 0.075;
const BUTTON_HEIGHT = 0.032;
const SPAWN_DISTANCE = 0.42;
const SPAWN_DROP = 0.22;
// The desktop camera has a narrower view, so the pad floats farther and higher there.
const DESKTOP_SPAWN_DISTANCE = 1;
const DESKTOP_SPAWN_DROP = 0.08;
const REDRAW_INTERVAL_FRAMES = 6;

interface Pad {
  root: TransformNode;
  meshes: Set<AbstractMesh>;
  buttons: Map<AbstractMesh, HandMenuHit>;
  texture: DynamicTexture;
  ctx: CanvasRenderingContext2D;
  interaction: FloatingPanel;
}

let pad: Pad | null = null;
let visible = false;
// Once the user positions the pad it stays put across hide/show, unless the
// viewer has since moved too far away to reach or read it.
const USER_PLACEMENT_MAX_DISTANCE = 2.5;
const POINTER_SOURCE = "pointer";
let lastSignature = "";
let framesUntilRedraw = 0;
const visibilityListeners = new Set<(visible: boolean) => void>();

// Set boundaries every DRILL_CHART_COUNTS_PER_SET counts, plus the drill's
// final count when it doesn't land on a boundary, so the last page is the
// ending formation.
export function getDrillChartSetCounts(): number[] {
  const last = getDrillLastCountIndex();
  const counts: number[] = [];
  for (let count = 0; count <= last; count += DRILL_CHART_COUNTS_PER_SET) counts.push(count);
  if (counts[counts.length - 1] !== last) counts.push(last);
  return counts;
}

// The page shown is the latest set the playhead has reached, so playback
// flips pages on its own and flipping a page seeks the playhead.
function getCurrentPage(setCounts: number[]): number {
  const count = getGlobalCountIndex();
  let page = 0;
  for (let index = 0; index < setCounts.length; index++) {
    if (setCounts[index] <= count) page = index;
  }
  return page;
}

export function flipDrillChartPage(direction: 1 | -1) {
  const setCounts = getDrillChartSetCounts();
  const page = getCurrentPage(setCounts);
  const target = Math.min(setCounts.length - 1, Math.max(0, page + direction));
  seekToCount(setCounts[target]);
  framesUntilRedraw = 0;
}

function createButtonTexture(label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = label === "X" ? 80 : 192;
  canvas.height = 80;
  const ctx = canvas.getContext("2d")!;
  drawPanelButton(ctx, canvas.width, canvas.height, label);
  const texture = new DynamicTexture(`drillChartButtonTexture-${label}`, canvas, scene, false);
  texture.hasAlpha = true;
  texture.getAlphaFromRGB = false;
  texture.update(true);
  return texture;
}

function createPad(): Pad {
  // A TransformNode root (not a mesh) keeps the pad out of the AR content
  // snapshot, so it floats at world/room scale instead of with the field.
  const root = new TransformNode("drillChartPadRoot", scene);
  root.rotationQuaternion = Quaternion.Identity();
  const meshes = new Set<AbstractMesh>();
  const buttons = new Map<AbstractMesh, HandMenuHit>();

  const backingMaterial = new StandardMaterial("drillChartBackingMaterial", scene);
  backingMaterial.diffuseColor = Color3.FromHexString(PANEL_FRAME_COLOR);
  backingMaterial.specularColor = Color3.Black();
  backingMaterial.alpha = 0.08;
  backingMaterial.disableDepthWrite = true;
  const backing = MeshBuilder.CreateBox("drillChartBacking", {
    width: PAD_WIDTH + 0.02, height: PAD_HEIGHT + 0.04, depth: BACKING_DEPTH,
  }, scene);
  backing.material = backingMaterial;
  backing.position.set(0, 0.01, BACKING_DEPTH / 2 + 0.004);

  const stackMaterial = new StandardMaterial("drillChartStackMaterial", scene);
  stackMaterial.diffuseColor = new Color3(0.94, 0.93, 0.88);
  stackMaterial.specularColor = Color3.Black();
  stackMaterial.alpha = 0.06;
  stackMaterial.disableDepthWrite = true;
  const stack = MeshBuilder.CreateBox("drillChartPageStack", {
    width: PAD_WIDTH, height: PAD_HEIGHT, depth: 0.004,
  }, scene);
  stack.material = stackMaterial;
  stack.position.z = 0.002;

  const bindingMaterial = new StandardMaterial("drillChartBindingMaterial", scene);
  bindingMaterial.diffuseColor = Color3.FromHexString(PANEL_FRAME_COLOR);
  bindingMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
  const binding = MeshBuilder.CreateBox("drillChartBinding", {
    width: PAD_WIDTH + 0.024, height: 0.026, depth: 0.018,
  }, scene);
  binding.material = bindingMaterial;
  binding.position.set(0, PAD_HEIGHT / 2 + 0.01, 0.003);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const texture = new DynamicTexture("drillChartPageTexture", canvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const pageMaterial = new StandardMaterial("drillChartPageMaterial", scene);
  pageMaterial.diffuseTexture = texture;
  pageMaterial.emissiveColor = Color3.White();
  pageMaterial.disableLighting = true;
  pageMaterial.specularColor = Color3.Black();
  pageMaterial.alpha = 0.65;
  pageMaterial.disableDepthWrite = true;
  const page = MeshBuilder.CreatePlane("drillChartPage", { width: PAD_WIDTH, height: PAD_HEIGHT }, scene);
  page.material = pageMaterial;
  page.position.z = -0.0005;

  const buttonDefinitions: { label: string; name: string; x: number; hit: HandMenuHit }[] = [
    { label: "◀ Prev", name: "-1", x: -1, hit: { action: "drillChartPage", direction: -1 } },
    { label: "X", name: "hide", x: 0, hit: { action: "drillChartHide" } },
    { label: "Next ▶", name: "1", x: 1, hit: { action: "drillChartPage", direction: 1 } },
  ];
  for (const { label, name, x, hit } of buttonDefinitions) {
    const buttonMaterial = new StandardMaterial(`drillChartButtonMaterial-${name}`, scene);
    const buttonTexture = createButtonTexture(label);
    buttonMaterial.diffuseTexture = buttonTexture;
    buttonMaterial.opacityTexture = buttonTexture;
    buttonMaterial.emissiveColor = Color3.White();
    buttonMaterial.disableLighting = true;
    const isClose = name === "hide";
    const button = MeshBuilder.CreatePlane(`drillChartButton-${name}`, {
      width: isClose ? BUTTON_HEIGHT : BUTTON_WIDTH, height: BUTTON_HEIGHT,
    }, scene);
    button.material = buttonMaterial;
    button.position.set(x * (PAD_WIDTH / 2 - BUTTON_WIDTH / 2 - 0.012), -PAD_HEIGHT / 2 + BUTTON_HEIGHT / 2 + 0.01, -0.002);
    if (isClose) button.position.set(PAD_WIDTH / 2 - BUTTON_HEIGHT / 2, PAD_HEIGHT / 2 + 0.01, -0.008);
    registerMenuButton(button, hit);
    buttons.set(button, hit);
    button.parent = root;
    meshes.add(button);
  }

  for (const mesh of [backing, stack, binding, page] as Mesh[]) {
    mesh.parent = root;
    meshes.add(mesh);
  }
  root.setEnabled(false);
  const slider = new PanelTransparencySlider(root, 'drillChartTransparency', PAD_WIDTH / 2 - 0.085,
    PAD_HEIGHT / 2 + 0.01, 0.026, 0.06, opacity => {
      pageMaterial.alpha = opacity;
      backingMaterial.alpha = opacity * 0.08 / 0.65;
      stackMaterial.alpha = opacity * 0.06 / 0.65;
    });
  meshes.add(slider.mesh);
  const interaction = new FloatingPanel(root, meshes, root, new Vector3(PAD_WIDTH / 2 + 0.012, PAD_HEIGHT / 2 + 0.03, BACKING_DEPTH), buttons, undefined, slider);
  return { root, meshes, buttons, texture, ctx, interaction };
}

function fieldPoint(position: Vector3) {
  // Top-down, matching the video board: +X (field width) is up the page and
  // the field's length runs left to right.
  return {
    x: FIELD_LEFT + (0.5 - position.z / FIELD_LENGTH_YARDS) * (FIELD_RIGHT - FIELD_LEFT),
    y: FIELD_TOP + (0.5 - position.x / FIELD_WIDTH_YARDS) * (FIELD_BOTTOM - FIELD_TOP),
  };
}

function drawField(ctx: CanvasRenderingContext2D) {
  const yardsToPixels = (FIELD_RIGHT - FIELD_LEFT) / FIELD_LENGTH_YARDS;
  const goal = FIELD_LENGTH_YARDS / 2 - END_ZONE_DEPTH_YARDS;
  ctx.fillStyle = "#ecebe2";
  for (const z of [goal, -FIELD_LENGTH_YARDS / 2]) {
    const left = fieldPoint(new Vector3(0, 0, z + END_ZONE_DEPTH_YARDS)).x;
    ctx.fillRect(left, FIELD_TOP, END_ZONE_DEPTH_YARDS * yardsToPixels, FIELD_BOTTOM - FIELD_TOP);
  }
  ctx.strokeStyle = "#9aa7b8";
  for (let z = -goal; z <= goal; z += 5) {
    ctx.lineWidth = z % 10 === 0 ? 2 : 1;
    const x = fieldPoint(new Vector3(0, 0, z)).x;
    ctx.beginPath();
    ctx.moveTo(x, FIELD_TOP);
    ctx.lineTo(x, FIELD_BOTTOM);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  const hash = HASH_OFFSETS_YARDS[getSelectedFieldLevel()] ?? HASH_OFFSETS_YARDS.nfl;
  for (let z = -goal; z <= goal; z++) {
    const x = fieldPoint(new Vector3(0, 0, z)).x;
    for (const side of [-hash, hash]) {
      const y = fieldPoint(new Vector3(side, 0, 0)).y;
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 3);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = "#2f3b4d";
  ctx.lineWidth = 3;
  ctx.strokeRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP);
  ctx.fillStyle = "#6c7889";
  ctx.font = "bold 18px 'Segoe UI', Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let z = -goal + 10; z <= goal - 10; z += 10) {
    const x = fieldPoint(new Vector3(0, 0, z)).x;
    const label = String(goal - Math.abs(z));
    ctx.fillText(label, x, FIELD_BOTTOM - 22);
    ctx.fillText(label, x, FIELD_TOP + 22);
  }
}

function drawPage(target: Pad, setCounts: number[], page: number) {
  const { ctx } = target;
  const count = setCounts[page];
  const previousCount = page > 0 ? setCounts[page - 1] : count;
  const current = getRobotPositionsAtCount(count);
  const previous = getRobotPositionsAtCount(previousCount);
  const povRobot = getMarcherPOVRobot();

  ctx.fillStyle = PANEL_PAPER_COLOR;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(28, 0, 2, CANVAS_HEIGHT);

  ctx.fillStyle = "#1d2636";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "bold 44px 'Segoe UI', Arial";
  ctx.fillText(`Set ${page + 1}`, FIELD_LEFT, 66);
  ctx.font = "24px 'Segoe UI', Arial";
  ctx.fillStyle = "#4a5568";
  const moveCounts = count - previousCount;
  ctx.fillText(
    `Count ${count}${page > 0 ? `  ·  ${moveCounts} count${moveCounts === 1 ? "" : "s"} from Set ${page}` : "  ·  Opening"}`,
    FIELD_LEFT + 170, 64
  );
  ctx.textAlign = "right";
  ctx.fillText(`Page ${page + 1} / ${setCounts.length}`, FIELD_RIGHT, 64);
  ctx.textAlign = "left";
  ctx.font = "16px 'Segoe UI', Arial";
  ctx.fillStyle = "#7a8596";
  ctx.fillText("OPENCHARTXR DRILL CHART", FIELD_LEFT, 96);

  drawField(ctx);

  if (page > 0 && previous.length === current.length) {
    ctx.strokeStyle = "rgba(63, 124, 247, 0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    previous.forEach((from, index) => {
      if (povRobot) return;
      const a = fieldPoint(from);
      const b = fieldPoint(current[index]);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 2) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    if (povRobot) {
      const from = getRobotPositionAtCount(povRobot, previousCount);
      const to = getRobotPositionAtCount(povRobot, count);
      if (from && to) {
        const a = fieldPoint(from);
        const b = fieldPoint(to);
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.strokeStyle = "rgba(63, 124, 247, 0.6)";
    previous.forEach((from) => {
      const p = fieldPoint(from);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
  ctx.fillStyle = "#111827";
  current.forEach((position) => {
    const p = fieldPoint(position);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#4a5568";
  ctx.font = "20px 'Segoe UI', Arial";
  if (povRobot) {
    const setPosition = getRobotPositionAtCount(povRobot, count);
    if (setPosition) {
      const setPoint = fieldPoint(setPosition);
      ctx.strokeStyle = "#bd5700";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(setPoint.x, setPoint.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
    const me = fieldPoint(povRobot.position);
    ctx.fillStyle = "#ffb23e";
    ctx.strokeStyle = "#713500";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(me.x, me.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.font = "20px 'Segoe UI', Arial";
  ctx.fillStyle = "#24324a";
  ctx.fillText(
    `${current.length} marcher${current.length === 1 ? "" : "s"}  ·  playhead count ${getGlobalCountIndex()}`,
    CANVAS_WIDTH / 2, FIELD_BOTTOM + 44
  );
  ctx.font = "16px 'Segoe UI', Arial";
  ctx.fillStyle = "#7a8596";
  ctx.fillText(povRobot ? `${getMarcherPOVLabel()}  ·  orange dot: live position  ·  orange ring: this set`
    : page > 0 ? "● this set   ○ previous set   - - path" : "● opening set", CANVAS_WIDTH / 2, FIELD_BOTTOM + 72);
  ctx.strokeStyle = "#c9d3e2";
  ctx.lineWidth = 1;
  for (let y = FIELD_BOTTOM + 96; y < CANVAS_HEIGHT - 70; y += 26) {
    ctx.beginPath();
    ctx.moveTo(FIELD_LEFT, y);
    ctx.lineTo(FIELD_RIGHT, y);
    ctx.stroke();
  }
  target.texture.update(true);
}

function getPageSignature(setCounts: number[], page: number) {
  const count = setCounts[page];
  const previous = page > 0 ? setCounts[page - 1] : count;
  let hash = 0;
  for (const positionCount of [count, previous]) {
    for (const position of getRobotPositionsAtCount(positionCount)) {
      hash = (hash * 31 + Math.round(position.x * 10) * 7 + Math.round(position.z * 10)) | 0;
    }
  }
  const povRobot = getMarcherPOVRobot();
  const povSignature = povRobot ? `${povRobot.uniqueId}:${povRobot.position.x.toFixed(3)}:${povRobot.position.z.toFixed(3)}` : '';
  return `${setCounts.length}:${page}:${count}:${hash}:${getGlobalCountIndex()}:${getSelectedFieldLevel()}:${povSignature}`;
}

function refreshPage(force = false) {
  if (!pad) return;
  const setCounts = getDrillChartSetCounts();
  const page = getCurrentPage(setCounts);
  const signature = getPageSignature(setCounts, page);
  if (!force && signature === lastSignature) return;
  lastSignature = signature;
  drawPage(pad, setCounts, page);
}

// Floats the pad below eye level on the viewer's left.
function placeInFrontOfViewer() {
  if (!pad) return;
  pad.interaction.placeForViewer({
    desktop: { distance: DESKTOP_SPAWN_DISTANCE, height: -DESKTOP_SPAWN_DROP, side: -0.45 },
    xr: { distance: SPAWN_DISTANCE, height: -SPAWN_DROP },
    side: -0.3,
  });
}

export function isDrillChartPadVisible() {
  return visible;
}

export function summonDrillChartPad() {
  setDrillChartPadVisible(true);
  placeInFrontOfViewer();
}

export function onDrillChartPadVisibilityChange(listener: (visible: boolean) => void) {
  visibilityListeners.add(listener);
}

export function setDrillChartPadVisible(show: boolean) {
  if (show) {
    pad ??= createPad();
    const eye = scene.activeCamera?.globalPosition;
    if (!pad.interaction.userPlaced || !eye || Vector3.Distance(eye, pad.root.position) > USER_PLACEMENT_MAX_DISTANCE) {
      pad.interaction.userPlaced = false;
      placeInFrontOfViewer();
    }
    refreshPage(true);
  }
  if (!show) {
    pad?.interaction.release();
  }
  pad?.root.setEnabled(show);
  if (visible === show) return;
  visible = show;
  visibilityListeners.forEach((listener) => listener(show));
}

export function isDrillChartPadMesh(mesh: AbstractMesh) {
  return pad?.meshes.has(mesh) ?? false;
}

export function isPointNearDrillChartPad(point: Vector3, tolerance = 0.03) {
  return pad?.interaction.near(point, tolerance) ?? false;
}

export function pickDrillChartPad(ray: Ray) {
  return pad?.interaction.pick(ray) ?? null;
}

export function getDrillChartButtonNearPoint(point: Vector3): HandMenuHit | null {
  if (!pad || !visible) return null;
  for (const [button, action] of pad.buttons) {
    const local = Vector3.TransformCoordinates(point, button.computeWorldMatrix(true).clone().invert());
    if (Math.abs(local.x) <= BUTTON_WIDTH / 2 + 0.01 &&
      Math.abs(local.y) <= BUTTON_HEIGHT / 2 + 0.01 && Math.abs(local.z) <= 0.04) return action;
  }
  return null;
}

// Grabs keep the pad's pose fixed relative to the grabbing hand/controller;
// a second hand grabbing takes it over from the first.
export function beginDrillChartPadGrab(source: string, sourceWorld: Matrix) {
  pad?.interaction.begin(source, sourceWorld);
}

export function updateDrillChartPadGrab(source: string, sourceWorld: Matrix) {
  pad?.interaction.update(source, sourceWorld);
}

export function endDrillChartPadGrab(source: string) {
  pad?.interaction.end(source);
}

// Desktop mouse drags slide the pad across a camera-facing plane through its
// grab point, turning it to keep facing the viewer.
export function beginDrillChartPadPointerDrag(ray: Ray) {
  return pad?.interaction.beginPointer(ray) ?? false;
}

export function updateDrillChartPadPointerDrag(ray: Ray) {
  pad?.interaction.updatePointer(ray);
}

export function endDrillChartPadPointerDrag() {
  endDrillChartPadGrab(POINTER_SOURCE);
}

// Mouse wheel over the pad pushes it away from or pulls it toward the viewer.
export function nudgeDrillChartPadDistance(ray: Ray, wheelDelta: number) {
  return pad?.interaction.nudge(ray, wheelDelta) ?? false;
}

export function isDrillChartPadGrabbed(source?: string) {
  return pad?.interaction.grabbed(source) ?? false;
}

scene.onBeforeRenderObservable.add(() => {
  if (!visible || --framesUntilRedraw > 0) return;
  framesUntilRedraw = REDRAW_INTERVAL_FRAMES;
  refreshPage();
});
