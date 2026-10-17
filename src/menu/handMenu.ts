import { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { Ray } from '@babylonjs/core/Culling/ray';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Axis } from '@babylonjs/core/Maths/math.axis';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import { WebXRHandJoint, WebXRHandTracking } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
import { scene } from '../scene/engine';
import type { MarcherInstrument } from '../robot/robot';
import { addInstrumentButtonModel } from './instrumentButtonModel';
import { DetachableFloatingPanel, type FloatingPanel } from './floatingPanel';
import type { FieldDrawingTool } from '../interaction/fieldDrawingGeometry';
import { getHandMenuPose, getTrackedHandMenuPose, type HandMenuPose } from './handMenuPose';

// How closely the controller's local "up" must line up with world up to
// count as palm-up (like checking a smartwatch). May need tuning per headset.
const PALM_UP_DOT_THRESHOLD = 0.6;
const BAR_WIDTH = 0.14;
const BAR_HEIGHT = 0.03;
const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 64;
const BUTTON_SIZE = 0.022;
const BUTTON_Y = 0.09;
const WATCH_Y = 0.035;
const WATCH_Z = 0.13;

export type FormationLetter =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M"
  | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z";

export type HandMenuHit =
  | { action: "fieldProjector"; command: import('../interaction/fieldImageProjector').FieldProjectorCommand }
  | { action: "marcherPaint"; command: "show" | "done" | "paintSelected" }
  | { action: "marcherPaintColor"; color: string }
  | { action: "drawingTool"; tool: FieldDrawingTool | "camera" | "takePhoto" | "restorePhoto" | "downloadPhoto" | "saveDrafting" | "restoreDrafting" | "deleteDrafting" | "drafting" | "draftSpacingLess" | "draftSpacingMore" | "draftAngle" | "draftSide" | "draftReference" | "addTack" | "laserPin" | "wireReset" | "show" | "stencils" | "cutters" | "hide" | "smaller" | "larger" | "stop" | "formation" | "path" | "synchronizedRoutes" | "undo" | "clear" }
  | { action: "playPause" | "rewind" | "fastForward" | "stepBack" | "stepForward" | "fullScaleVR" | "tabletopScale" | "commitFormation" | "eraseMode" | "undoErase" | "redoErase" | "musicStandStaffToggle" }
  | { action: "formationLibrary" | "formationLibraryBack" | "formationLibraryClose" | "lettersLibrary" }
  | { action: "formationGridSnap" }
  | { action: "formationSpacing"; factor: number }
  | { action: "formationRotate"; radians: number }
  | { action: "formationScale"; factor: number }
  | { action: "formationPreset"; preset: "line" | "arc" | "circle" | "block" | "triangle" | "square" | "pentagon" | "hexagon" | "star" }
  | { action: "formationLetter"; letter: FormationLetter }
  | { action: "drillChartPad" }
  | { action: "musicStandSummon" }
  | { action: "marcherPOV" }
  | { action: "drillChartHide" | "musicStandHide" }
  | { action: "instrument"; instrument: MarcherInstrument }
  | { action: "createMarcher"; instrument: MarcherInstrument }
  | { action: "instrumentPanelSummon" | "instrumentPanelHide" | "finishMarcherPlacement" }
  | { action: "drillChartPage"; direction: 1 | -1 }
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

function drawProgressBar(ctx: CanvasRenderingContext2D, texture: DynamicTexture, progress: number) {
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

  const texture = new DynamicTexture(
    "handProgressBarTexture",
    canvas,
    scene,
    false,
    Texture.TRILINEAR_SAMPLINGMODE
  );
  texture.hasAlpha = true;

  const material = new StandardMaterial("handProgressBarMaterial", scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = new Color3(1, 1, 1);
  material.disableLighting = true;
  material.specularColor = new Color3(0, 0, 0);
  material.backFaceCulling = false;

  const plane = MeshBuilder.CreatePlane(
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

function createButton(label: string, x: number, action: HandMenuHit): Mesh {
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
  if (action.action !== "instrument" && action.action !== "createMarcher") ctx.fillText(label, 32, 34);

  const texture = new DynamicTexture(`handMenuButtonTexture-${label}`, canvas, scene, false);
  texture.hasAlpha = true;
  texture.update(true);

  const material = new StandardMaterial(`handMenuButtonMaterial-${label}`, scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = new Color3(1, 1, 1);
  material.disableLighting = true;
  material.specularColor = new Color3(0, 0, 0);
  material.backFaceCulling = false;

  const button = MeshBuilder.CreatePlane(
    `handMenuButton-${label}`,
    { width: BUTTON_SIZE, height: BUTTON_SIZE },
    scene
  );
  button.material = material;
  button.setEnabled(false);
  button.rotation.x = Math.PI / 2;
  button.position = new Vector3(x, BUTTON_Y, 0);

  buttonActions.set(button, action);
  if (action.action === "instrument" || action.action === "createMarcher") {
    addInstrumentButtonModel(button, action.instrument, BUTTON_SIZE);
  }
  return button;
}

const buttonActions = new Map<AbstractMesh, HandMenuHit>();
let progressBar: ReturnType<typeof createProgressBarPlane> | null = null;
let buttons: Mesh[] = [];
let watchButtons: Mesh[] = [];
let watchMeshes: Mesh[] = [];
let watchRoot: TransformNode | null = null;
let watchPanel: FloatingPanel | null = null;
let instrumentPlateRoot: TransformNode | null = null;
let instrumentPlatePanel: FloatingPanel | null = null;
let instrumentPlateButtons: Mesh[] = [];
let formationButtons: Mesh[] = [];
let letterButtons: Mesh[] = [];
let attachedTo: AbstractMesh | null = null;
let handMenuAnchor: TransformNode | null = null;
let watchAnchor: TransformNode | null = null;
let lastDrawnProgress = -1;
let trackedHands: WebXRHandTracking | null = null;

class MediaWatchPanel extends DetachableFloatingPanel {
  override get canGrab() { return !trackedHands; }
}
let formationCommitAvailable = false;
let formationLibraryPage: "closed" | "shapes" | "letters" = "closed";
let formationAnchorAvailable = false;
let eraseModeActive = false;
let drillChartPadActive = false;
let marcherPOVActive = false;
let undoEraseAvailable = false;
let redoEraseAvailable = false;
let activeInstrument: MarcherInstrument = "trumpet";

// Highlights the hand-menu button for the instrument currently being picked.
export function setInstrumentMenuActive(instrument: MarcherInstrument) {
  activeInstrument = instrument;
}

export function setEraseHistoryAvailable(undo: boolean, redo: boolean) {
  undoEraseAvailable = undo;
  redoEraseAvailable = redo;
}

export function setDrillChartPadActive(active: boolean) {
  drillChartPadActive = active;
}

export function setMarcherPOVMenuActive(active: boolean) {
  marcherPOVActive = active;
}

export function setEraseModeActive(active: boolean) {
  eraseModeActive = active;
}

export function setFormationCommitAvailable(available: boolean) {
  formationCommitAvailable = available;
}

export function setFormationLibraryOpen(open: boolean) {
  formationLibraryPage = open ? "shapes" : "closed";
}

export function setFormationLibraryPage(page: "closed" | "shapes" | "letters") {
  formationLibraryPage = page;
}

export function setFormationLibraryAnchorAvailable(available: boolean) {
  formationAnchorAvailable = available;
}

export function setMenuHandTracking(tracking: WebXRHandTracking | null) {
  trackedHands = tracking;
  if (tracking && watchPanel) {
    watchPanel.release();
    watchPanel.userPlaced = false;
  }
}

export function getHandMenuHitNearPoint(point: Vector3): HandMenuHit | null {
  for (const [mesh, action] of buttonActions) {
    if (!mesh.isEnabled() || !mesh.isVisible) continue;
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    const distance = Math.hypot(
      Math.max(bounds.minimumWorld.x - point.x, 0, point.x - bounds.maximumWorld.x),
      Math.max(bounds.minimumWorld.y - point.y, 0, point.y - bounds.maximumWorld.y),
      Math.max(bounds.minimumWorld.z - point.z, 0, point.z - bounds.maximumWorld.z)
    );
    if (distance < 0.015) return action;
  }
  return null;
}

// Lets other menus (e.g. the stadium video board) reuse the same trigger-pick
// dispatch in interaction.ts, by tagging any mesh with a hand-menu action.
export function registerMenuButton(mesh: AbstractMesh, action: HandMenuHit) {
  buttonActions.set(mesh, action);
}

export function isMenuControl(mesh: AbstractMesh): boolean {
  return buttonActions.has(mesh) || mesh === progressBar?.plane;
}

export function pickMenuControl(ray: Ray): PickingInfo | null {
  return scene.pickWithRay(new Ray(ray.origin, ray.direction.normalizeToNew(), 250), isMenuControl);
}

export function isHandMenuVisible(): boolean {
  return attachedTo !== null && (progressBar?.plane.isEnabled() ?? false);
}

function ensureMenuMeshes() {
  if (progressBar) return;
  handMenuAnchor = new TransformNode("handMenuAnchor", scene);
  watchAnchor = new TransformNode("mediaWatchAnchor", scene);
  progressBar = createProgressBarPlane();
  const spacing = BUTTON_SIZE + 0.006;
  buttons = [
    createButton("<<", -spacing * 2, { action: "rewind" }),
    createButton("<|", -spacing, { action: "stepBack" }),
    createButton(">||", 0, { action: "playPause" }),
    createButton("|>", spacing, { action: "stepForward" }),
    createButton(">>", spacing * 2, { action: "fastForward" }),
  ];
  watchButtons = [...buttons];
  watchRoot = new TransformNode("mediaWatchRoot", scene);
  watchRoot.scaling.setAll(0.48);
  watchButtons.forEach(button => {
    button.parent = watchRoot;
    button.position.y = 0;
    button.position.z = 0.014;
  });
  progressBar.plane.parent = watchRoot;
  progressBar.plane.position.set(0, 0, -0.019);
  const watchMaterial = new StandardMaterial("mediaWatchMaterial", scene);
  watchMaterial.diffuseColor = new Color3(0.04, 0.06, 0.1);
  watchMaterial.emissiveColor = new Color3(0.015, 0.025, 0.04);
  watchMaterial.specularColor = Color3.Black();
  const caseMaterial = new StandardMaterial("mediaWatchCaseMaterial", scene);
  caseMaterial.diffuseColor = new Color3(0.26, 0.29, 0.33);
  caseMaterial.specularColor = new Color3(0.7, 0.72, 0.75);
  caseMaterial.specularPower = 64;
  const face = MeshBuilder.CreateBox("mediaWatchFace",
    { width: 0.164, height: 0.012, depth: 0.09 }, scene);
  const bezel = MeshBuilder.CreateBox("mediaWatchBezel",
    { width: 0.18, height: 0.025, depth: 0.106 }, scene);
  const crown = MeshBuilder.CreateCylinder("mediaWatchCrown",
    { diameter: 0.025, height: 0.018, tessellation: 12 }, scene);
  crown.rotation.z = Math.PI / 2;
  crown.position.x = 0.096;
  watchMeshes = [bezel, face, crown];
  watchMeshes.forEach(mesh => {
    mesh.material = mesh === bezel || mesh === crown ? caseMaterial : watchMaterial;
    mesh.isPickable = true;
    mesh.parent = watchRoot;
    mesh.position.y = mesh === bezel ? -0.016 : -0.008;
    mesh.setEnabled(false);
  });
  watchPanel = new MediaWatchPanel(watchRoot,
    new Set([...watchMeshes, ...watchButtons, progressBar.plane]),
    watchRoot, new Vector3(0.09, 0.025, 0.045),
    new Map(watchButtons.map(button => [button, buttonActions.get(button)!])));
  watchRoot.setEnabled(false);
  const fullScaleButton = createButton("1:1", -spacing / 2, { action: "fullScaleVR" });
  fullScaleButton.position.z = 0.04;
  const tabletopButton = createButton("Table", spacing / 2, { action: "tabletopScale" });
  tabletopButton.position.z = 0.04;
  buttons.push(fullScaleButton, tabletopButton);
  const povButton = createButton("POV", spacing * 2, { action: "marcherPOV" });
  povButton.position.z = 0.04;
  buttons.push(povButton);
  const scoreButton = createButton("Score", -spacing * 2, { action: "musicStandSummon" });
  scoreButton.position.z = 0.04;
  buttons.push(scoreButton);
  const commitButton = createButton("Commit", 0, { action: "commitFormation" });
  commitButton.position.z = 0.075;
  commitButton.scaling.x = 3;
  buttons.push(commitButton);
  const formationsButton = createButton("Form", 0, { action: "formationLibrary" });
  formationsButton.position.z = -0.09;
  buttons.push(formationsButton);
  const eraseButton = createButton("Erase", spacing * 2, { action: "eraseMode" });
  eraseButton.position.z = -0.09;
  buttons.push(eraseButton);
  const chartButton = createButton("Chart", -spacing * 2, { action: "drillChartPad" });
  chartButton.position.z = -0.09;
  buttons.push(chartButton);
  const undoButton = createButton("Undo", -spacing / 2, { action: "undoErase" });
  const redoButton = createButton("Redo", spacing / 2, { action: "redoErase" });
  undoButton.position.z = redoButton.position.z = -0.125;
  buttons.push(undoButton, redoButton);
  const instrumentPanelButton = createButton("Add", spacing * 2, { action: "instrumentPanelSummon" });
  instrumentPanelButton.position.z = -0.125;
  buttons.push(instrumentPanelButton);
  const drawingButton = createButton("Tools", -spacing * 2, { action: "drawingTool", tool: "show" });
  drawingButton.position.z = -0.125;
  buttons.push(drawingButton);
  const stencilButton = createButton("Sten", -spacing, { action: "drawingTool", tool: "stencils" });
  stencilButton.position.z = 0.075;
  buttons.push(stencilButton);
  const cutterButton = createButton("Cut", spacing, { action: "drawingTool", tool: "cutters" });
  cutterButton.position.z = 0.075;
  buttons.push(cutterButton);
  const paintButton = createButton("Paint", spacing * 2, { action: "marcherPaint", command: "show" });
  paintButton.position.z = 0.075;
  buttons.push(paintButton);
  const projectorButton = createButton("Project", 0, { action: "fieldProjector", command: "show" });
  projectorButton.position.z = 0.11;
  buttons.push(projectorButton);
  // Brass row, then woodwind and percussion rows beneath it.
  const instrumentButtons = ([
    ["Tpt", "trumpet", -spacing * 2, -0.16],
    ["Mel", "mellophone", -spacing, -0.16],
    ["Tbn", "trombone", 0, -0.16],
    ["Eup", "euphonium", spacing, -0.16],
    ["Sou", "sousaphone", spacing * 2, -0.16],
    ["Alto", "altoSax", -spacing * 1.5, -0.195],
    ["Bari", "bariSax", -spacing / 2, -0.195],
    ["Cl", "clarinet", spacing / 2, -0.195],
    ["Fl", "flute", spacing * 1.5, -0.195],
    ["Sn", "snare", -spacing * 2, -0.23],
    ["Ten", "tenors", -spacing, -0.23],
    ["BD", "bassDrum", 0, -0.23],
    ["Glk", "glockenspiel", spacing, -0.23],
    ["Cym", "cymbals", spacing * 2, -0.23],
    ["Flag", "guardFlag", -spacing, -0.265],
    ["Rifle", "guardRifle", 0, -0.265],
    ["Sabre", "guardSabre", spacing, -0.265],
  ] as const).map(([label, instrument, x, z]) => {
    const button = createButton(label, x, { action: "createMarcher", instrument });
    button.position.z = z;
    return button;
  });
  buttons.push(...instrumentButtons);
  instrumentPlateButtons = instrumentButtons;
  instrumentPlateRoot = new TransformNode("instrumentPlateRoot", scene);
  instrumentButtons.forEach(button => {
    button.parent = instrumentPlateRoot;
    button.position.y = 0;
    button.position.z += 0.195;
  });
  const plate = MeshBuilder.CreateBox("instrumentPlate",
    { width: 0.155, height: 0.008, depth: 0.145 }, scene);
  plate.parent = instrumentPlateRoot;
  plate.position.set(0, -0.006, -0.0175);
  plate.material = watchMaterial;
  instrumentPlatePanel = new DetachableFloatingPanel(instrumentPlateRoot,
    new Set([plate, ...instrumentButtons]), instrumentPlateRoot,
    new Vector3(0.0775, 0.025, 0.09),
    new Map(instrumentButtons.map(button => [button, buttonActions.get(button)!])));
  instrumentPlateRoot.setEnabled(false);
  const presets: Array<{
    label: string;
    preset: "line" | "arc" | "circle" | "block" | "triangle" | "square" | "pentagon" | "hexagon" | "star";
  }> = [
    { label: "Line", preset: "line" },
    { label: "Arc", preset: "arc" },
    { label: "Circle", preset: "circle" },
    { label: "Block", preset: "block" },
    { label: "Triangle", preset: "triangle" },
    { label: "Square", preset: "square" },
    { label: "Pentagon", preset: "pentagon" },
    { label: "Hexagon", preset: "hexagon" },
    { label: "Star", preset: "star" },
  ];
  const librarySpacing = BUTTON_SIZE + 0.006;
  formationButtons = presets.map(({ label, preset }, index) => {
    const columnCount = 5;
    const row = Math.floor(index / columnCount);
    const column = index % columnCount;
    const buttonsInRow = Math.min(columnCount, presets.length - row * columnCount);
    const button = createButton(label, (column - (buttonsInRow - 1) / 2) * librarySpacing, {
      action: "formationPreset",
      preset,
    });
    button.position.z = row * librarySpacing;
    return button;
  });
  const backButton = createButton("Back", 0, { action: "formationLibraryClose" });
  backButton.position.z = Math.ceil(presets.length / 5) * librarySpacing + 0.01;
  formationButtons.push(backButton);
  const lettersButton = createButton("Letters", 0, { action: "lettersLibrary" });
  lettersButton.position.z = backButton.position.z;
  lettersButton.position.x = librarySpacing * 2;
  formationButtons.push(lettersButton);
  const editButtons: Array<{ label: string; action: HandMenuHit }> = [
    { label: "Snap", action: { action: "formationGridSnap" } },
    { label: "Space-", action: { action: "formationSpacing", factor: 0.8 } },
    { label: "Space+", action: { action: "formationSpacing", factor: 1.25 } },
    { label: "Turn-", action: { action: "formationRotate", radians: -Math.PI / 4 } },
    { label: "Turn+", action: { action: "formationRotate", radians: Math.PI / 4 } },
    { label: "Size-", action: { action: "formationScale", factor: 0.8 } },
    { label: "Size+", action: { action: "formationScale", factor: 1.25 } },
  ];
  editButtons.forEach(({ label, action }, index) => {
    const button = createButton(label, (index % 4 - 1.5) * librarySpacing, action);
    button.position.z = backButton.position.z + librarySpacing * (1 + Math.floor(index / 4));
    formationButtons.push(button);
  });

  const alphabet: FormationLetter[] = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  ];
  letterButtons = alphabet.map((letter, index) => {
    const columns = 7;
    const row = Math.floor(index / columns);
    const column = index % columns;
    const lettersInRow = Math.min(columns, alphabet.length - row * columns);
    const button = createButton(letter, (column - (lettersInRow - 1) / 2) * librarySpacing, {
      action: "formationLetter",
      letter,
    });
    button.position.z = row * librarySpacing;
    return button;
  });
  const lettersBack = createButton("Back", 0, { action: "formationLibraryBack" });
  lettersBack.position.z = Math.ceil(alphabet.length / 7) * librarySpacing + 0.01;
  letterButtons.push(lettersBack);
}

// Instruments hover above the palm; transport controls sit on the wrist.
export function updateHandMenu(
  controllers: ReadonlyMap<string, WebXRInputSource>,
  progress: number | null
) {
  ensureMenuMeshes();
  if (!progressBar) return;

  let palmUpGrip: AbstractMesh | null = null;
  let menuPose: HandMenuPose | null = null;
  let trackedPose: HandMenuPose | null = null;
  let flatPalm = false;
  for (const controller of controllers.values()) {
    const grip = controller.grip;
    if (!grip || controller.inputSource.hand) continue;
    grip.computeWorldMatrix(true);
    const pose = getHandMenuPose(grip.getAbsolutePosition(), grip.getDirection(Axis.Y), grip.getDirection(Axis.Z));
    if (pose && pose.normal.y > PALM_UP_DOT_THRESHOLD) {
      palmUpGrip = grip;
      menuPose = pose;
      break;
    }
  }
  if (!palmUpGrip && trackedHands) {
    for (const handedness of ['left', 'right'] as const) {
      const hand = trackedHands.getHandByHandedness(handedness);
      if (!hand) continue;
      const joint = (name: WebXRHandJoint) => {
        const mesh = hand.getJointMesh(name);
        mesh.computeWorldMatrix(true);
        return mesh.getAbsolutePosition();
      };
      const pose = getTrackedHandMenuPose(
        joint(WebXRHandJoint.WRIST),
        joint(WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL),
        joint(WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL),
        joint(WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL),
        handedness, scene.useRightHandedSystem
      );
      if (pose && !trackedPose) trackedPose = pose;
      if (pose && pose.normal.y > PALM_UP_DOT_THRESHOLD) {
        const wrist = hand.getJointMesh(WebXRHandJoint.WRIST);
        if (!palmUpGrip) {
          palmUpGrip = wrist;
          menuPose = pose;
        }
        const wristPoint = joint(WebXRHandJoint.WRIST);
        const fingers = [
          [WebXRHandJoint.INDEX_FINGER_TIP, WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL],
          [WebXRHandJoint.MIDDLE_FINGER_TIP, WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL],
          [WebXRHandJoint.RING_FINGER_TIP, WebXRHandJoint.RING_FINGER_PHALANX_PROXIMAL],
          [WebXRHandJoint.PINKY_FINGER_TIP, WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL],
        ] as const;
        if (fingers.every(([tip, knuckle]) =>
          Vector3.Distance(joint(tip), wristPoint) > Vector3.Distance(joint(knuckle), wristPoint) * 1.35)) {
          flatPalm = true;
          menuPose = pose;
          palmUpGrip = wrist;
        }
      }
    }
  }

  if (!menuPose && trackedPose) menuPose = trackedPose;
  if (handMenuAnchor && menuPose) {
    handMenuAnchor.position.copyFrom(menuPose.position);
    handMenuAnchor.rotationQuaternion = menuPose.rotation;
    handMenuAnchor.computeWorldMatrix(true);
  }
  if (watchRoot && watchPanel && !watchPanel.userPlaced) {
    if (trackedPose && watchAnchor) {
      const wristDirection = Vector3.Forward().rotateByQuaternionToRef(trackedPose.rotation, new Vector3());
      const pose = getHandMenuPose(trackedPose.position, trackedPose.normal.negate(), wristDirection);
      if (pose) {
        watchAnchor.position.copyFrom(pose.position);
        watchAnchor.rotationQuaternion = pose.rotation;
      }
      watchRoot.parent = watchAnchor;
      watchRoot.position.set(0, 0.025, 0.045);
    } else {
      watchRoot.parent = handMenuAnchor;
      watchRoot.position.set(0, WATCH_Y, WATCH_Z);
    }
    watchRoot.setEnabled(palmUpGrip !== null || trackedPose !== null);
  }
  if (instrumentPlateRoot && instrumentPlatePanel && !instrumentPlatePanel.userPlaced) {
    instrumentPlateRoot.parent = handMenuAnchor;
    instrumentPlateRoot.position.set(0, BUTTON_Y, -0.195);
    instrumentPlateRoot.setEnabled(trackedPose ? flatPalm : palmUpGrip !== null && formationLibraryPage === "closed");
  }
  instrumentPlateButtons.forEach(button => {
    button.setEnabled(instrumentPlateRoot?.isEnabled() ?? false);
    const hit = buttonActions.get(button);
    if (hit?.action === "createMarcher" && button.material instanceof StandardMaterial) {
      const active = hit.instrument === activeInstrument;
      button.material.emissiveColor.set(1, active ? 0.85 : 1, active ? 0.35 : 1);
    }
  });
  const watchVisible = watchRoot?.isEnabled() ?? false;
  progressBar.plane.setEnabled(watchVisible);
  watchButtons.forEach(button => button.setEnabled(watchVisible));
  watchMeshes.forEach(mesh => mesh.setEnabled(watchVisible));
  const shownProgress = progress ?? 0;
  if (Math.abs(shownProgress - lastDrawnProgress) > 0.002) {
    lastDrawnProgress = shownProgress;
    drawProgressBar(progressBar.ctx, progressBar.texture, shownProgress);
  }

  if (!palmUpGrip || trackedPose) {
    buttons.filter(button => !watchButtons.includes(button) && !instrumentPlateButtons.includes(button))
      .forEach(button => button.setEnabled(false));
    formationButtons.forEach((button) => button.setEnabled(false));
    letterButtons.forEach((button) => button.setEnabled(false));
    attachedTo = null;
    return;
  }

  if (attachedTo !== palmUpGrip) {
    attachedTo = palmUpGrip;
    buttons.filter(button => !watchButtons.includes(button) && !instrumentPlateButtons.includes(button))
      .forEach(button => { button.parent = handMenuAnchor; });
  }
  const menuHeight = BUTTON_Y;
  const menuRotation = Math.PI / 2;
  buttons.forEach((button) => {
    if (watchButtons.includes(button) || instrumentPlateButtons.includes(button)) return;
    button.position.y = menuHeight;
    button.rotation.x = menuRotation;
  });
  formationButtons.forEach((button) => {
    button.parent = handMenuAnchor;
    button.position.y = menuHeight;
    button.rotation.x = menuRotation;
  });
  letterButtons.forEach((button) => {
    button.parent = handMenuAnchor;
    button.position.y = menuHeight;
    button.rotation.x = menuRotation;
  });
  buttons.forEach((button) => {
    if (watchButtons.includes(button) || instrumentPlateButtons.includes(button)) return;
    const hit = buttonActions.get(button);
    const action = hit?.action;
    if ((hit?.action === "instrument" || hit?.action === "createMarcher") && button.material instanceof StandardMaterial) {
      const active = hit.instrument === activeInstrument;
      button.material.emissiveColor.set(1, active ? 0.85 : 1, active ? 0.35 : 1);
    }
    if (action === "eraseMode" && button.material instanceof StandardMaterial) {
      button.material.emissiveColor.set(1, eraseModeActive ? 0.35 : 1, eraseModeActive ? 0.15 : 1);
    }
    if (action === "drillChartPad" && button.material instanceof StandardMaterial) {
      button.material.emissiveColor.set(drillChartPadActive ? 0.45 : 1, drillChartPadActive ? 0.8 : 1, 1);
    }
    if (action === "marcherPOV" && button.material instanceof StandardMaterial) {
      button.material.emissiveColor.set(marcherPOVActive ? 0.45 : 1, marcherPOVActive ? 0.8 : 1, 1);
    }
    button.setEnabled((watchButtons.includes(button) || formationLibraryPage === "closed") &&
      (action !== "formationLibrary" || formationAnchorAvailable) &&
      (action !== "undoErase" || undoEraseAvailable) &&
      (action !== "redoErase" || redoEraseAvailable) &&
      (action !== "commitFormation" || formationCommitAvailable));
  });
  formationButtons.forEach((button) => button.setEnabled(formationLibraryPage === "shapes"));
  letterButtons.forEach((button) => button.setEnabled(formationLibraryPage === "letters"));

}

// Resolves a pick against the hand menu (a button, or a tap along the
// progress bar's track for seeking) into an action, or null if it missed.
export function getHandMenuHit(pick: PickingInfo): HandMenuHit | null {
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
