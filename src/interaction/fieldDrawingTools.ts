import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh.pure';
import type { Camera } from '@babylonjs/core/Cameras/camera.pure';
import type { Ray } from '@babylonjs/core/Culling/ray';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { DetachableFloatingPanel, FloatingPanel } from '../menu/floatingPanel';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import { drawPanelButton } from '../menu/panelStyle';
import { FIELD_SURFACE_Y } from '../field/constants';
import { buildLaserGuide, buildToolGuide, guideTouchesSweep, isGuideOnField, type FieldDrawingTool,
  type DrawingToolCommand } from './fieldDrawingGeometry';
import { drawingToolsButton, stencilTrayButton, cookieCutterTrayButton, floorCalibrationToggle,
  draftingToolsButton, draftingSpacing, draftingAngle, draftingText } from '../ui/dom';
import { draftingSaveButton, draftingRestoreButton, draftingDeleteButton, draftingSaveStatus,
  fieldGridToggle, fieldGridInterval, draftingCameraButton, draftingPhotoRestoreButton,
  draftingPhotoDownloadButton, draftingPhotoPreview } from '../ui/dom';
import { createMemoryWire } from './memoryWire';
import { getARScale, getARScaleRange, onARScaleChangedObservable } from '../xr/ar';
import { constrainedDraftLine, divideDraftLine, measureDraftLine, offsetDraftLine, sampleDraftSpline, snapDraftingPoint } from './draftingGeometry';
import { createDraftingTablePanel } from './draftingTablePanel';
import { draftingModeToggle, draftingTableControls, draftingTableStatus } from '../ui/dom';
import { tabletopScaleButton } from '../ui/dom';
import { setMarcherPOVEnabled } from '../camera/marcherPOV';
import { createDraftingFieldPreview } from '../field/draftingFieldPreview';
import { getARPosition, setARPosition, getARRotation, setARRotation, setARScale,
  getFieldHeightMode, setFieldHeightMode, getFieldHeightSetting, setARSurfaceHeight,
  placeTabletopInFrontOfCamera } from '../xr/ar';
import { DRAFTING_WORKSPACE_KEY, parseDraftingWorkspace, serializeDraftingWorkspace,
  type DraftingWorkspace, type WorkspaceGuide } from './draftingWorkspace';
import { captureDraftingPhoto, DRAFTING_CAMERA_KEY, parseDraftingPhoto, type DraftingPhoto } from './draftingCamera';
import { getGuideMarcherSettings, sampleGuideMarchers, type GuideMarcherSettings } from './guideMarcherLayout';
import { setDraftingToolsEnabled } from './editingMode';
import { createDraftingToolbox } from './draftingToolbox';

interface DrawingDependencies {
  root: TransformNode;
  notify(message: string): void;
  prepare(): void;
  createFormation(points: Vector3[], settings?: GuideMarcherSettings): boolean;
  createPath(points: Vector3[]): boolean;
  createSynchronizedRoutes(points: Vector3[]): boolean;
}
interface GuideOptions extends Partial<GuideMarcherSettings> {
  editable?: 'yarn' | 'spline';
  controls?: Vector3[];
  label?: string;
  measure?: boolean;
  divisions?: Vector3[];
  sticky?: boolean;
}
interface Guide {
  points: Vector3[];
  meshes: AbstractMesh[];
  options: GuideOptions;
}
interface Tool {
  kind: FieldDrawingTool;
  root: TransformNode;
  panel: FloatingPanel;
  tip: Vector3;
  edge: Vector3;
  stroke: Vector3[] | null;
  dock: TransformNode;
  dockPosition: Vector3;
  dockRotation: Quaternion;
  dockIndex: number;
  compassAnchor?: Vector3;
  fieldPose?: Matrix;
}

let drawing: ReturnType<typeof createFieldDrawingTools> | null = null;

export function initFieldDrawingTools(deps: DrawingDependencies) {
  drawing ??= createFieldDrawingTools(deps);
}
export function executeDrawingToolAction(action: Extract<HandMenuHit, { action: 'drawingTool' }>) {
  drawing?.action(action.tool);
  drawing?.updateTableStatus();
}
export function handleDrawingPointer(type: 'down' | 'move' | 'up', point: Vector3 | null) {
  return drawing?.pointer(type, point) ?? false;
}
export function isDrawingPointerActive() { return drawing?.pointerActive() ?? false; }
export function isFieldDrawingToolActive() { return drawing?.active() ?? false; }
export function isDraftingTableMode() { return drawing?.tableMode() ?? false; }
/** Toggles selection of the guide nearest a root-local point. `vertical` also requires the point near the yarn height. */
export function selectDrawingGuideNear(point: Vector3, radius: number, vertical = false) {
  return drawing?.selectNear(point, radius, vertical) ?? false;
}
/** Nearest root-local point on the selected guide (keeping the input height), or null with no selection. */
export function snapToSelectedDrawingGuide(point: Vector3): Vector3 | null {
  return drawing?.snapToSelected(point) ?? null;
}
export function snapToNearbyDrawingGuide(point: Vector3, radius = 0.25): Vector3 | null {
  return drawing?.snapToNearby(point, radius)?.position ?? null;
}
export function getNearbyDrawingGuidePose(point: Vector3, radius = 0.25) {
  return drawing?.snapToNearby(point, radius) ?? null;
}
/** Removes every drafted guide (e.g. for a new blank chart page); returns how many were removed. */
export function clearDrawingGuides() {
  return drawing?.clearGuides() ?? 0;
}
/** Root-local points of the selected guide, or null with no selection. */
export function getSelectedDrawingGuidePoints(): readonly Vector3[] | null {
  return drawing?.selectedPoints() ?? null;
}
/** Serialized drafting guides and settings (same format as Save drafting), or null before init. */
export function exportDrawingWorkspace(): string | null {
  return drawing?.exportWorkspace() ?? null;
}
/** Replaces guides/settings from exportDrawingWorkspace JSON; throws if the JSON is invalid. */
export function importDrawingWorkspace(json: string): true | string {
  return drawing?.importWorkspace(json) ?? 'Drafting tools are not ready.';
}
/** Shows `next` as the field's guides and returns the ones removed, or null while guides are being edited. */
export function swapDrawingGuides(next: readonly WorkspaceGuide[]): WorkspaceGuide[] | null {
  return drawing ? drawing.swapGuides(next) : null;
}
/** Whether a guide is being drawn, so the field's guides cannot be swapped. */
export function areDrawingGuidesBusy() {
  return drawing?.guidesBusy() ?? true;
}

export function closestPointOnGuide(points: readonly Vector3[], point: Vector3) {
  let best: Vector3 | null = null;
  let bestDistance = Infinity;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 1e-12
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq)) : 0;
    const x = a.x + dx * t, z = a.z + dz * t;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < bestDistance) { bestDistance = distance; best = new Vector3(x, point.y, z); }
  }
  return best ? { point: best, distance: bestDistance } : null;
}

function createFieldDrawingTools(deps: DrawingDependencies) {
  const guides: Guide[] = [];
  let selectedGuide: Guide | null = null;
  const activeGuide = () => selectedGuide ?? guides[guides.length - 1];
  const tools: Tool[] = [];
  let activeTool: Tool | null = null;
  let activeWire: TransformNode | null = null;
  let selected: FieldDrawingTool | null = null;
  let pointerStroke: Vector3[] | null = null;
  let pointerAnchor: Vector3 | null = null;
  let pointerCompassRadius = 0;
  let pointerCamera: Camera | null = null;
  let preview: LinesMesh | null = null;
  let previewPoints: Vector3[] = [];
  let laserBeam: ReturnType<typeof MeshBuilder.CreateTube> | null = null;
  let laserPoints: Vector3[] = [];
  let desktopLaserAim = false;
  let span = 1;
  // In XR, held tools grow with the field so they cover the same yardage at every scale.
  function fieldToolScale() {
    if (scene.activeCamera?.getClassName() !== 'WebXRCamera') return 1;
    const factor = getARScale() / getARScaleRange().default;
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
  }
  const heldSpans = new WeakMap<TransformNode, number>();
  function sizeHeld(root: TransformNode, base: number) {
    heldSpans.set(root, base);
    root.scaling.setAll(base * fieldToolScale());
  }
  function heldSpan(root: TransformNode) {
    return heldSpans.get(root) ?? root.scaling.x / fieldToolScale();
  }
  function placeHeldTool(panel: FloatingPanel, root: TransformNode) {
    const factor = fieldToolScale();
    panel.placeForViewer({ desktop: { distance: 0.6, height: -0.08, side: 0.3 },
      xr: { distance: 0.35 * factor, height: -0.15 * Math.min(1, factor) }, side: 0.25 * factor, uprightInXR: true }, false);
    if (factor <= 1) return;
    const surfaceY = Vector3.TransformCoordinates(new Vector3(0, FIELD_SURFACE_Y, 0), deps.root.computeWorldMatrix(true)).y;
    root.position.y = Math.max(root.position.y, surfaceY + 0.16 * root.scaling.y);
  }
  let offsetSide = 1;
  let parallelReference = false;
  let restoreArmedUntil = 0;
  let restoringPhoto = false;
  let takingPhoto = false;
  const noteWidth = 2.4, noteDepth = 1.2;
  let tableMode = false;
  let fullSizePreview = false;
  let previousFieldPose: { position: Vector3; scale: number; yaw: number; heightMode: 'floor' | 'table' } | null = null;
  const fieldPreview = createDraftingFieldPreview(deps.root);
  let tableSnap = true;
  let previousGridVisible = false;
  const tablePanel = createDraftingTablePanel();
  const yarnRadius = 0.012;
  const trayRoot = new TransformNode('drawingToolTray', scene);
  const stencilRoot = new TransformNode('fieldStencilTray', scene);
  const cutterRoot = new TransformNode('fieldCookieCutterTray', scene);
  const draftingRoot = new TransformNode('advancedDraftingTray', scene);
  const draftingMeshes = new Set<AbstractMesh>();
  const draftingButtons = new Map<AbstractMesh, HandMenuHit>();
  const meshes = new Set<AbstractMesh>();
  const buttons = new Map<AbstractMesh, HandMenuHit>();
  const stencilMeshes = new Set<AbstractMesh>();
  const stencilButtons = new Map<AbstractMesh, HandMenuHit>();
  const cutterMeshes = new Set<AbstractMesh>();
  const cutterButtons = new Map<AbstractMesh, HandMenuHit>();
  const metal = new StandardMaterial('drawingToolMetal', scene);
  metal.diffuseColor = new Color3(0.65, 0.7, 0.75);
  metal.specularColor = new Color3(0.6, 0.6, 0.6);
  const felt = new StandardMaterial('drawingTrayFelt', scene);
  felt.diffuseColor = new Color3(0.05, 0.08, 0.1);
  felt.specularColor = Color3.Black();
  const trayBackground = new StandardMaterial('drawingTrayBackground', scene);
  trayBackground.diffuseColor = felt.diffuseColor.clone();
  trayBackground.specularColor = Color3.Black();
  trayBackground.alpha = 0.45;
  trayBackground.disableDepthWrite = true;
  const wood = new StandardMaterial('drawingToolWood', scene);
  wood.diffuseColor = new Color3(0.75, 0.53, 0.29);
  const graphite = new StandardMaterial('drawingToolGraphite', scene);
  graphite.diffuseColor = new Color3(0.07, 0.07, 0.08);
  const plastic = new StandardMaterial('drawingToolPlastic', scene);
  plastic.diffuseColor = new Color3(0.95, 0.72, 0.25);
  plastic.alpha = 0.7;
  plastic.backFaceCulling = false;
  const pencilMaterial = new StandardMaterial('drawingPencilMaterial', scene);
  pencilMaterial.diffuseColor = new Color3(1, 0.7, 0.05);
  const eraserMaterial = new StandardMaterial('drawingEraserMaterial', scene);
  eraserMaterial.diffuseColor = new Color3(1, 0.4, 0.5);
  const yarnMaterial = new StandardMaterial('drawingGuideYarnMaterial', scene);
  yarnMaterial.diffuseColor = new Color3(0.72, 0.12, 0.16);
  yarnMaterial.specularColor = new Color3(0.16, 0.08, 0.08);
  const divisionMarkMaterial = new StandardMaterial('drawingGuideDivisionMarkMaterial', scene);
  divisionMarkMaterial.diffuseColor = new Color3(0.92, 0.12, 0.14);
  divisionMarkMaterial.specularColor = Color3.Black();
  divisionMarkMaterial.backFaceCulling = false;
  const selectedYarnMaterial = new StandardMaterial('drawingGuideSelectedYarnMaterial', scene);
  selectedYarnMaterial.diffuseColor = new Color3(1, 0.82, 0.1);
  selectedYarnMaterial.emissiveColor = new Color3(0.75, 0.55, 0.05);
  selectedYarnMaterial.specularColor = Color3.Black();
  const laserMaterial = new StandardMaterial('fieldLaserMaterial', scene);
  laserMaterial.emissiveColor = new Color3(0.1, 1, 0.2);
  laserMaterial.diffuseColor = laserMaterial.emissiveColor;
  laserMaterial.disableLighting = true;

  function button(label: string, x: number, y: number, width: number, tool: Parameters<typeof action>[0],
    parent = trayRoot) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Drawing tool tray requires a 2D canvas context.');
    drawPanelButton(ctx, 512, 128, label);
    const texture = new DynamicTexture(`drawingTool-${tool}Texture`, canvas, scene, false);
    texture.update();
    const material = new StandardMaterial(`drawingTool-${tool}Material`, scene);
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    const mesh = MeshBuilder.CreatePlane(`drawingTool-${tool}`, { width, height: 0.055 }, scene);
    mesh.parent = parent; mesh.position.set(x, y - 0.16, -0.024); mesh.material = material;
    const hit: HandMenuHit = { action: 'drawingTool', tool };
    (parent === trayRoot ? meshes : parent === stencilRoot ? stencilMeshes :
      parent === draftingRoot ? draftingMeshes : cutterMeshes).add(mesh);
    (parent === trayRoot ? buttons : parent === stencilRoot ? stencilButtons :
      parent === draftingRoot ? draftingButtons : cutterButtons).set(mesh, hit);
    registerMenuButton(mesh, hit);
    mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
  }
  function buildTray(parent: TransformNode, targets: Set<AbstractMesh>, name: string, width = 0.95, height = 0.78) {
    const backing = MeshBuilder.CreateBox(name, { width, height, depth: 0.025 }, scene);
    backing.parent = parent; backing.material = trayBackground; targets.add(backing);
    for (const side of [-1, 1]) {
      const rim = MeshBuilder.CreateBox(`${name}Side`, { width: 0.02, height: height + 0.02, depth: 0.06 }, scene);
      rim.parent = parent; rim.position.set(side * width / 2, 0, -0.015);
      rim.material = metal; targets.add(rim);
      const edge = MeshBuilder.CreateBox(`${name}Edge`, { width, height: 0.02, depth: 0.06 }, scene);
      edge.parent = parent; edge.position.set(0, side * height / 2, -0.015);
      edge.material = metal; targets.add(edge);
    }
  }
  buildTray(trayRoot, meshes, 'drawingToolTrayBacking', 1.4);
  button('Straighten wire', -0.2, 0.5, 0.3, 'wireReset');
  button('Save laser line', 0.2, 0.5, 0.3, 'laserPin');
  button('Advanced tools', 0.55, 0.1, 0.25, 'drafting');
  button('Drafting table', 0.55, -0.005, 0.25, 'table');
  button('Span -', -0.235, -0.005, 0.22, 'smaller');
  button('Span +', 0, -0.005, 0.22, 'larger');
  button('Put away', 0.235, -0.005, 0.22, 'stop');
  button('Create formation', -0.18, -0.085, 0.34, 'formation');
  button('Create path', 0.18, -0.085, 0.34, 'path');
  button('Route selected form', 0, -0.125, 0.46, 'synchronizedRoutes');
  button('Undo guide', -0.235, -0.245, 0.22, 'undo');
  button('Clear guides', 0, -0.245, 0.22, 'clear');
  button('Hide tray', 0.235, -0.245, 0.22, 'hide');
  const tray = new FloatingPanel(trayRoot, meshes, trayRoot, new Vector3(0.71, 0.4, 0.01), buttons);
  trayRoot.setEnabled(false);
  buildTray(stencilRoot, stencilMeshes, 'stencilTrayBacking');
  const stencils = [
    ['Circle', 'circleStencil'], ['Square', 'squareStencil'], ['Triangle', 'triangleStencil'],
    ['Pentagon', 'pentagonStencil'], ['Hexagon', 'hexagonStencil'], ['Star', 'starStencil'],
  ] as const;
  button('Span -', -0.235, -0.005, 0.22, 'smaller', stencilRoot);
  button('Span +', 0, -0.005, 0.22, 'larger', stencilRoot);
  button('Put away', 0.235, -0.005, 0.22, 'stop', stencilRoot);
  button('Create formation', -0.18, -0.085, 0.34, 'formation', stencilRoot);
  button('Create path', 0.18, -0.085, 0.34, 'path', stencilRoot);
  button('Route selected form', 0, -0.125, 0.46, 'synchronizedRoutes', stencilRoot);
  button('Undo guide', -0.235, -0.245, 0.22, 'undo', stencilRoot);
  button('Clear guides', 0, -0.245, 0.22, 'clear', stencilRoot);
  button('Hide trays', 0.235, -0.245, 0.22, 'hide', stencilRoot);
  const stencilTray = new FloatingPanel(stencilRoot, stencilMeshes, stencilRoot,
    new Vector3(0.48, 0.4, 0.01), stencilButtons);
  stencilRoot.setEnabled(false);
  buildTray(cutterRoot, cutterMeshes, 'cookieCutterTrayBacking');
  const cutters = [
    ['Circle', 'circleCutter'], ['Square', 'squareCutter'], ['Triangle', 'triangleCutter'],
    ['Pentagon', 'pentagonCutter'], ['Hexagon', 'hexagonCutter'], ['Star', 'starCutter'],
  ] as const;
  button('Span -', -0.235, -0.005, 0.22, 'smaller', cutterRoot);
  button('Span +', 0, -0.005, 0.22, 'larger', cutterRoot);
  button('Put away', 0.235, -0.005, 0.22, 'stop', cutterRoot);
  button('Cookie cutters: press / lift to stamp a formation', 0, -0.085, 0.69, 'cutters', cutterRoot);
  button('Drawing tools', -0.235, -0.165, 0.22, 'show', cutterRoot);
  button('Stencils', 0, -0.165, 0.22, 'stencils', cutterRoot);
  button('Hide trays', 0.235, -0.165, 0.22, 'hide', cutterRoot);
  const cutterTray = new FloatingPanel(cutterRoot, cutterMeshes, cutterRoot,
    new Vector3(0.48, 0.4, 0.01), cutterButtons);
  cutterRoot.setEnabled(false);

  function show() {
    showToolTray(trayRoot, tray, 1.6, 0.7, 0);
  }
  drawingToolsButton?.addEventListener('click', show);
  function showStencils() {
    showToolTray(stencilRoot, stencilTray, 1.6, 0.7, 0.35);
  }
  stencilTrayButton?.addEventListener('click', showStencils);
  function showCutters() {
    showToolTray(cutterRoot, cutterTray, 1.6, 0.7, -0.35);
  }
  cookieCutterTrayButton?.addEventListener('click', showCutters);
  buildTray(draftingRoot, draftingMeshes, 'advancedDraftingTrayBacking', 1.4, 1.6);
  const draftCommands = [
    ['Spacing -', 'draftSpacingLess'], ['Spacing +', 'draftSpacingMore'], ['Angle', 'draftAngle'],
    ['Offset side', 'draftSide'], ['Parallel ref', 'draftReference'],
    ['Formation', 'formation'], ['Path', 'path'], ['Route selected form', 'synchronizedRoutes'], ['Undo guide', 'undo'],
    ['Clear guides', 'clear'], ['Put away', 'stop'], ['Hide trays', 'hide'],
  ] as const;
  draftCommands.forEach(([label, command], index) =>
    button(label, (index % 3 - 1) * 0.4, -0.1 - Math.floor(index / 3) * 0.09, 0.36, command, draftingRoot));
  button('Save locally', -0.4, -0.48, 0.36, 'saveDrafting', draftingRoot);
  button('Restore saved', 0, -0.48, 0.36, 'restoreDrafting', draftingRoot);
  button('Delete saved', 0.4, -0.48, 0.36, 'deleteDrafting', draftingRoot);
  button('Take photo', -0.4, -0.57, 0.36, 'takePhoto', draftingRoot);
  button('Restore photo', 0, -0.57, 0.36, 'restorePhoto', draftingRoot);
  button('Download PNG', 0.4, -0.57, 0.36, 'downloadPhoto', draftingRoot);
  const draftingTray = new FloatingPanel(draftingRoot, draftingMeshes, draftingRoot,
    new Vector3(0.71, 0.81, 0.01), draftingButtons);
  draftingRoot.setEnabled(false);
  const toolbox = createDraftingToolbox([
    { root: trayRoot, panel: tray }, { root: draftingRoot, panel: draftingTray },
    { root: stencilRoot, panel: stencilTray }, { root: cutterRoot, panel: cutterTray },
  ]);
  function showDrafting() {
    showToolTray(draftingRoot, draftingTray, 1.8, 0.85, 0);
  }
  draftingToolsButton?.addEventListener('click', showDrafting);
  const draftStatusCanvas = document.createElement('canvas');
  draftStatusCanvas.width = 1024; draftStatusCanvas.height = 96;
  const draftStatusContext = draftStatusCanvas.getContext('2d');
  if (!draftStatusContext) throw new Error('Drafting status requires a 2D canvas context.');
  const draftStatusTexture = new DynamicTexture('draftingStatusTexture', draftStatusCanvas, scene, false);
  const draftStatusMaterial = new StandardMaterial('draftingStatusMaterial', scene);
  draftStatusMaterial.diffuseTexture = draftStatusTexture;
  draftStatusMaterial.emissiveColor = Color3.White(); draftStatusMaterial.disableLighting = true;
  const draftStatus = MeshBuilder.CreatePlane('draftingStatus', { width: 1.2, height: 0.065 }, scene);
  draftStatus.parent = draftingRoot; draftStatus.position.set(0, -0.7, -0.03);
  draftStatus.material = draftStatusMaterial; draftStatus.isPickable = false;
  draftStatus.onDisposeObservable.addOnce(() => draftStatusMaterial.dispose(false, true));
  function updateDraftStatus() {
    const spacing = getDraftSpacing();
    drawPanelButton(draftStatusContext!, 1024, 96,
      `${spacing === null ? 'Invalid spacing' : `${spacing.toFixed(3)} yd`} | ${getDraftAngle()} deg | ` +
      `Offset ${offsetSide > 0 ? 'left' : 'right'} | ${parallelReference ? 'Guide parallel' : 'Field axes'}`);
    draftStatusTexture.update();
    updateTableStatus();
  }
  draftingSpacing?.addEventListener('change', updateDraftStatus);
  draftingAngle?.addEventListener('change', updateDraftStatus);
  updateDraftStatus();

  function showToolTray(active: TransformNode, activePanel: FloatingPanel,
    distance: number, xrDistance: number, side: number) {
    const xrTable = tableMode && scene.activeCamera?.getClassName() === 'WebXRCamera';
    active.setParent(null);
    if (tableMode) {
      for (const [root, panel] of [[trayRoot, tray], [stencilRoot, stencilTray],
        [cutterRoot, cutterTray], [draftingRoot, draftingTray]] as const) {
        if (root !== active) { panel.release(); root.setEnabled(false); }
      }
    }
    if (!activePanel.userPlaced) active.scaling.setAll(xrTable ? 0.65 : 1);
    active.setEnabled(true);
    activePanel.showForViewer({ desktop: { distance, height: 0, side: 0 },
      xr: { distance: xrTable ? 0.65 : xrDistance, height: -0.12 },
      side: xrTable ? 0.4 : side, uprightInXR: true });
  }
  function updateTableStatus() {
    const step = getDraftSpacing();
    const layout = selectedGuide ? getGuideMarcherSettings(selectedGuide.options) : null;
    const message = `${tableMode ? 'Drafting table' : 'Field'} | ${selected ?? 'Select guides'} | ` +
      `Snap ${tableSnap ? 'on' : 'off'} | View ${fullSizePreview ? 'on' : 'off'} | ${guides.length} guides | ` +
      `${selectedGuide ? `Selected: ${measureDraftLine(selectedGuide.points).yards.toFixed(2)} yd` : 'No selection'} | ` +
      `Step ${step ?? '?'} yd / ${getDraftAngle()} deg` +
      (layout ? ` | Guide ${layout.spacing.toFixed(3)} yd / ${layout.facing}` +
        (layout.facing === 'fixed' ? ` ${layout.facingAngle} deg` : '') : '');
    tablePanel.status(message);
    if (draftingTableStatus) draftingTableStatus.value = message;
  }
  function setTableMode(enabled: boolean) {
    if (guidesBusy() || tools.some(tool => tool.panel.grabbed()) ||
      memoryWire.instances().some(wire => wire.panel.grabbed() || wire.handles.some(handle => handle.grabbed()))) {
      deps.notify('Finish the stroke and release drafting tools before changing drafting mode.');
      if (draftingModeToggle) draftingModeToggle.checked = tableMode;
      return;
    }
    if (enabled && floorCalibrationToggle?.checked) {
      deps.notify('Finish floor calibration before entering drafting mode.');
      if (draftingModeToggle) draftingModeToggle.checked = tableMode;
      return;
    }
    if (enabled !== tableMode) {
      if (enabled) {
        deps.prepare();
        setMarcherPOVEnabled(false);
        const camera = scene.activeCamera;
        const immersive = camera?.getClassName() === 'WebXRCamera';
        previousFieldPose = immersive ? { position: getARPosition(), scale: getARScale(),
          yaw: getARRotation(), heightMode: getFieldHeightMode() } : null;
        if (immersive && camera) {
          tabletopScaleButton?.click();
          setARScale(getARScaleRange().default);
          setFieldHeightMode('table');
          camera.computeWorldMatrix();
          placeTabletopInFrontOfCamera(camera);
          const surface = Math.max(getFieldHeightSetting('floor'),
            Math.min(getFieldHeightSetting('table'), camera.globalPosition.y - 0.45));
          setARSurfaceHeight(surface);
        }
        previousGridVisible = fieldGridToggle?.checked ?? false;
        if (fieldGridToggle) {
          fieldGridToggle.checked = true;
          fieldGridToggle.dispatchEvent(new Event('change'));
        }
      } else if (fieldGridToggle) {
        fieldGridToggle.checked = previousGridVisible;
        fieldGridToggle.dispatchEvent(new Event('change'));
      }
      tableMode = enabled;
      setDraftingToolsEnabled(enabled);
      action('stop');
      if (!enabled) {
        fieldPreview.setEnabled(false);
        if (previousFieldPose && scene.activeCamera?.getClassName() === 'WebXRCamera') {
          setFieldHeightMode(previousFieldPose.heightMode);
          setARScale(previousFieldPose.scale);
          setARRotation(previousFieldPose.yaw);
          setARPosition(previousFieldPose.position);
        }
        previousFieldPose = null;
      } else if (fullSizePreview) showFullSizePreview();
    }
    if (draftingModeToggle) draftingModeToggle.checked = tableMode;
    if (draftingTableControls) draftingTableControls.hidden = !tableMode;
    if (enabled) { tablePanel.show(); show(); }
    else { tablePanel.hide(); action('hide'); toolbox.store(); }
    updateTableStatus();
    deps.notify(enabled ? `Drafting ${scene.activeCamera?.getClassName() === 'WebXRCamera' ? 'table' : 'field at 1:1'} ready. Select a tool or select a guide to edit it without pins.`
      : 'Drafting mode closed. Guides are preserved and the previous field placement is restored.');
  }
  function showFullSizePreview() {
    const camera = scene.activeCamera;
    const floor = camera && camera.getClassName() !== 'WebXRCamera'
      ? camera.globalPosition.y - 1.7 : getFieldHeightSetting('floor');
    fieldPreview.setEnabled(true, floor);
  }
  function snapForDrafting(point: Vector3) {
    if (!tableMode || !tableSnap) return point.clone();
    const snapped = snapDraftingPoint(point, guides.filter(g => !g.options.sticky).map(g => g.points),
      fieldGridToggle?.checked ? fieldGridInterval?.valueAsNumber ?? null : null);
    return isGuideOnField([snapped, snapped]) ? snapped : point.clone();
  }
  function editSelectedGuide(command: DrawingToolCommand) {
    if (!selectedGuide) { deps.notify('Select a drafted guide first.'); return; }
    if (guidesBusy()) { deps.notify('Finish drawing before editing a guide.'); return; }
    deps.prepare();
    const guide = selectedGuide;
    if (command === 'guideDelete') {
      guides.splice(guides.indexOf(guide), 1);
      disposeGuide(guide); updateTableStatus();
      deps.notify('Selected guide deleted.'); return;
    }
    const step = getDraftSpacing();
    if (step === null) return;
    if (command === 'guideDuplicate' && guides.length >= 100) {
      deps.notify('Guide limit reached (100). Erase or clear guides before duplicating.'); return;
    }
    const dx = command === 'guideLeft' ? -step :
      command === 'guideRight' || command === 'guideDuplicate' ? step : 0;
    const dz = command === 'guideBack' ? -step : command === 'guideForward' ? step : 0;
    const angle = (command === 'guideRotateLeft' ? -getDraftAngle() :
      command === 'guideRotateRight' ? getDraftAngle() : 0) * Math.PI / 180;
    const centerX = (Math.min(...guide.points.map(p => p.x)) + Math.max(...guide.points.map(p => p.x))) / 2;
    const centerZ = (Math.min(...guide.points.map(p => p.z)) + Math.max(...guide.points.map(p => p.z))) / 2;
    const transform = (p: Vector3) => new Vector3(
      centerX + (p.x - centerX) * Math.cos(angle) - (p.z - centerZ) * Math.sin(angle) + dx, p.y,
      centerZ + (p.x - centerX) * Math.sin(angle) + (p.z - centerZ) * Math.cos(angle) + dz);
    const points = guide.points.map(transform);
    const options = { ...guide.options,
      controls: guide.options.controls?.map(transform), divisions: guide.options.divisions?.map(transform) };
    if (!isGuideOnField(points) || (options.controls && !isGuideOnField(options.controls)) ||
      (options.divisions && !isGuideOnField(options.divisions))) {
      deps.notify('Guide edit rejected: keep the whole guide inside the field.'); return;
    }
    const meshes = createGuideMeshes(points, options);
    if (command === 'guideDuplicate') {
      const copy: Guide = { points, options, meshes };
      guides.push(copy); setSelectedGuide(copy);
    } else {
      guide.meshes.forEach(mesh => mesh.dispose());
      guide.points = points; guide.options = options; guide.meshes = meshes;
      highlightGuide(guide);
    }
    updateTableStatus();
    deps.notify(command === 'guideDuplicate' ? 'Guide duplicated and selected.' : 'Selected guide updated.');
  }
  const tableModeChanged = () => setTableMode(draftingModeToggle?.checked ?? false);
  draftingModeToggle?.addEventListener('change', tableModeChanged);
  const tableControlListeners: Array<readonly [HTMLButtonElement, () => void]> = [];
  draftingTableControls?.querySelectorAll<HTMLButtonElement>('button[data-drafting-action]').forEach(control => {
    const command = control.dataset.draftingAction;
    const match = [...tablePanel.commands].find(item => item === command);
    if (!match) throw new Error(`Unknown drafting-table control: ${command}`);
    const listener = () => action(match);
    control.addEventListener('click', listener);
    tableControlListeners.push([control, listener]);
  });
  updateTableStatus();
  function local(world: Vector3) {
    return Vector3.TransformCoordinates(world, deps.root.computeWorldMatrix(true).clone().invert());
  }
  function guideMesh(points: Vector3[], name: string) {
    const mesh = MeshBuilder.CreateLines(name, { points }, scene);
    mesh.parent = deps.root;
    mesh.color = new Color3(0.15, 0.95, 1);
    mesh.isPickable = false;
    return mesh;
  }
  function displayLaser(points: Vector3[]) {
    if (points.length === 2) {
      if (laserBeam) {
        MeshBuilder.CreateTube('fieldLaserBeam', { path: points, instance: laserBeam });
      } else {
        laserBeam = MeshBuilder.CreateTube('fieldLaserBeam', {
          path: points, radius: 0.025, tessellation: 6, updatable: true,
        }, scene);
        laserBeam.parent = deps.root;
        laserBeam.material = laserMaterial;
        laserBeam.isPickable = false;
      }
    } else {
      laserBeam?.dispose();
      laserBeam = null;
    }
    laserPoints = points.map(point => point.clone());
  }
  function createGuideMeshes(points: Vector3[], options: GuideOptions = {}) {
    const yarnPath = points.map(point => new Vector3(
      point.x, FIELD_SURFACE_Y + yarnRadius + 0.002, point.z
    ));
    const yarn = MeshBuilder.CreateTube('drawingGuide', {
      path: yarnPath, radius: yarnRadius, tessellation: 6, cap: 3,
    }, scene);
    yarn.parent = deps.root;
    yarn.material = yarnMaterial;
    yarn.isVisible = !options.sticky;
    yarn.isPickable = false;
    const result: AbstractMesh[] = [yarn];
    // Divider steps are flat turf marks so the guide stays pin-free.
    (options.divisions ?? []).forEach((point, index) => {
      const mark = MeshBuilder.CreateDisc(`drawingGuideDivisionMark-${index}`, { radius: 0.06, tessellation: 12 }, scene);
      mark.parent = deps.root;
      mark.position.set(point.x, FIELD_SURFACE_Y + 0.004, point.z);
      mark.rotation.x = Math.PI / 2;
      mark.material = divisionMarkMaterial;
      mark.isPickable = false;
      result.push(mark);
    });
    if (options.label || options.measure) {
      const { yards, steps } = measureDraftLine(points);
      const start = points[0], end = points[points.length - 1];
      const angle = Math.atan2(end.z - start.z, end.x - start.x) * 180 / Math.PI;
      const label = options.measure ? `${yards.toFixed(2)} yd | ${steps.toFixed(2)} steps | ${angle.toFixed(1)} deg`
        : options.label!;
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = options.sticky ? 512 : 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Drafting labels require a 2D canvas context.');
      if (options.sticky) {
        ctx.fillStyle = '#ffeb76'; ctx.fillRect(0, 0, 1024, 512);
        ctx.fillStyle = '#302508'; ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const words = label.split(/\s+/);
        const lines: string[] = [];
        let line = '';
        for (const word of words) {
          if ((line + ' ' + word).trim().length > 32 && line) { lines.push(line); line = word; }
          else line = (line + ' ' + word).trim();
        }
        if (line) lines.push(line);
        lines.forEach((text, index) => ctx.fillText(text, 512, 128 + index * 100, 980));
      } else drawPanelButton(ctx, 1024, 128, label);
      const texture = new DynamicTexture('draftingLabelTexture', canvas, scene, false);
      texture.hasAlpha = true; texture.update();
      const material = new StandardMaterial('draftingLabelMaterial', scene);
      material.diffuseTexture = texture; material.opacityTexture = texture;
      material.disableLighting = true; material.emissiveColor = Color3.White();
      material.backFaceCulling = false;
      const plaque = MeshBuilder.CreatePlane(options.sticky ? 'draftingStickyNote' : 'draftingGuideLabel',
        { width: options.sticky ? noteWidth : 3.2, height: options.sticky ? noteDepth : 0.4 }, scene);
      plaque.parent = deps.root; plaque.position.copyFrom(points[Math.floor(points.length / 2)]);
      plaque.position.y += 0.08; plaque.rotation.x = Math.PI / 2;
      if (options.sticky) plaque.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
      plaque.material = material; plaque.isPickable = false;
      plaque.metadata = { label };
      plaque.onDisposeObservable.addOnce(() => material.dispose(false, true));
      result.push(plaque);
    }
    return result;
  }
  function display(points: Vector3[]) {
    if (points.length === previewPoints.length &&
      points.every((point, index) => point.equalsWithEpsilon(previewPoints[index], 0.0001))) return;
    preview?.dispose(); preview = null;
    if (points.length >= 2) preview = guideMesh(points, 'drawingGuidePreview');
    previewPoints = points.map(point => point.clone());
  }
  function highlightGuide(guide: Guide) {
    const yarn = guide.meshes.find(mesh => mesh.name === 'drawingGuide');
    if (yarn) yarn.material = guide === selectedGuide ? selectedYarnMaterial : yarnMaterial;
    const note = guide.meshes.find(mesh => mesh.name === 'draftingStickyNote');
    if (note && note.material instanceof StandardMaterial) {
      note.material.emissiveColor = guide === selectedGuide ? new Color3(1, 0.75, 0.25) : Color3.White();
    }
  }
  function setSelectedGuide(guide: Guide | null) {
    const previous = selectedGuide;
    selectedGuide = guide;
    if (previous) highlightGuide(previous);
    if (guide) highlightGuide(guide);
    updateTableStatus();
  }
  function selectNear(point: Vector3, radius: number, vertical: boolean) {
    if (floorCalibrationToggle?.checked || takingPhoto) return false;
    let nearest: Guide | null = null;
    let nearestDistance = radius;
    for (const guide of guides) {
      if (guide.options.sticky && !tableMode) continue;
      const hit = closestPointOnGuide(guide.points, point);
      if (!hit) continue;
      let distance = vertical
        ? Math.hypot(hit.distance, point.y - (FIELD_SURFACE_Y + yarnRadius + 0.002)) : hit.distance;
      if (guide.options.sticky) {
        const start = guide.points[0], end = guide.points[guide.points.length - 1];
        const center = guide.points[Math.floor(guide.points.length / 2)];
        const angle = Math.atan2(end.z - start.z, end.x - start.x);
        const dx = point.x - center.x, dz = point.z - center.z;
        distance = Math.hypot(
          Math.max(0, Math.abs(dx * Math.cos(angle) + dz * Math.sin(angle)) - noteWidth / 2),
          Math.max(0, Math.abs(-dx * Math.sin(angle) + dz * Math.cos(angle)) - noteDepth / 2),
          vertical ? point.y - (center.y + 0.08) : 0);
      }
      if (distance <= nearestDistance) { nearest = guide; nearestDistance = distance; }
    }
    if (!nearest) return false;
    const deselect = nearest === selectedGuide;
    setSelectedGuide(deselect ? null : nearest);
    deps.notify(tableMode ? (deselect ? 'Guide deselected.' : 'Guide selected. Use Move, Rotate, Duplicate or Delete in the drafting workspace.')
      : deselect ? 'Guide deselected. Grabbed marchers still snap to nearby guides.'
      : 'Guide selected for click placement and drafting. Grabbed marchers snap to nearby guides.');
    return true;
  }
  function snapToSelected(point: Vector3) {
    return selectedGuide && !selectedGuide.options.sticky
      ? closestPointOnGuide(selectedGuide.points, point)?.point ?? null : null;
  }
  function snapToNearby(point: Vector3, radius: number) {
    let nearest: { position: Vector3; rotationY: number } | null = null;
    let distance = radius;
    for (const guide of guides) {
      if (guide.options.sticky) continue;
      const hit = closestPointOnGuide(guide.points, point);
      if (hit && hit.distance <= distance) {
        const poses = sampleGuideMarchers(guide.points, guide.options);
        const pose = poses.reduce<(typeof poses)[number] | null>((best, candidate) =>
          !best || Math.hypot(candidate.position.x - point.x, candidate.position.z - point.z) <
            Math.hypot(best.position.x - point.x, best.position.z - point.z) ? candidate : best, null);
        if (pose) {
          nearest = { position: new Vector3(pose.position.x, point.y, pose.position.z), rotationY: pose.rotationY };
          distance = hit.distance;
        }
      }
    }
    return nearest;
  }
  function disposeGuide(guide: Guide) {
    if (guide === selectedGuide) selectedGuide = null;
    guide.meshes.forEach(mesh => mesh.dispose());
  }
  function commit(points: Vector3[], options: GuideOptions = {}) {
    display([]);
    if (points.length < 2 || measureDraftLine(points).yards < 0.05) {
      deps.notify('Guide rejected: draw at least 0.05 yards.');
      return;
    }
    if (!isGuideOnField(points) || (options.controls && !isGuideOnField(options.controls))) {
      deps.notify('Guide rejected: keep the entire line, arc, or circle inside the field.');
      return;
    }
    if (guides.length >= 100) {
      deps.notify('Guide limit reached (100). Erase or clear guides before drawing more.');
      return;
    }
    const marcherSpacing = getDraftSpacing();
    if (marcherSpacing === null) return;
    options = { spacing: Math.max(0.625, Math.min(10, marcherSpacing)),
      facing: 'along', facingAngle: 0, ...options };
    const committedPoints = points.map(point => point.clone());
    const guide: Guide = { points: committedPoints, meshes: createGuideMeshes(committedPoints, options), options };
    guides.push(guide);
    updateTableStatus();
    deps.notify(`Guide ready (${guides.length}). Create formation or Create path uses the ${selectedGuide
      ? 'selected' : 'newest'} guide; tap or pinch a guide to select it.`);
  }
  function erase(from: Vector3, to: Vector3, radius: number) {
    for (let index = guides.length - 1; index >= 0; index--) {
      if (guideTouchesSweep(guides[index].points, from, to, radius)) {
        disposeGuide(guides[index]);
        guides.splice(index, 1);
      }
    }
  }
  function append(stroke: Vector3[], point: Vector3) {
    if (Vector3.Distance(stroke[stroke.length - 1], point) >= 0.05 && stroke.length < 512) stroke.push(point.clone());
  }
  const pencilExtensions = new WeakMap<Vector3[], {
    guide: Guide; index: number; endpoint: Vector3; direction: Vector3;
  }>();
  function beginPencilStroke(point: Vector3) {
    let nearest = 0.25;
    let extension: { guide: Guide; index: number; endpoint: Vector3; direction: Vector3 } | null = null;
    for (const guide of guides) {
      if (guide.options.sticky || guide.options.editable === 'spline' ||
        guide.options.divisions || (guide.options.label && !guide.options.measure)) continue;
      const start = guide.points[0], end = guide.points[guide.points.length - 1];
      const direction = new Vector3(end.x - start.x, 0, end.z - start.z);
      const length = direction.length();
      if (length < 0.05) continue;
      direction.scaleInPlace(1 / length);
      if (guide.points.some(p => {
        const offset = p.subtract(start);
        const along = Vector3.Dot(offset, direction);
        return Math.abs(offset.x * direction.z - offset.z * direction.x) > 0.01 ||
          along < -0.01 || along > length + 0.01;
      })) continue;
      for (const index of [0, guide.points.length - 1]) {
        const endpoint = guide.points[index];
        const distance = Math.hypot(point.x - endpoint.x, point.z - endpoint.z);
        if (distance > nearest) continue;
        nearest = distance;
        extension = { guide, index, endpoint: endpoint.clone(),
          direction: direction.scale(index === 0 ? -1 : 1) };
      }
    }
    const stroke = extension ? extension.guide.points.map(p => p.clone()) : [point.clone()];
    if (extension) pencilExtensions.set(stroke, extension);
    return stroke;
  }
  function updatePencilStroke(stroke: Vector3[], point: Vector3) {
    const extension = pencilExtensions.get(stroke);
    if (!extension) { append(stroke, point); return; }
    const { endpoint, direction, index } = extension;
    const boundary = buildLaserGuide(endpoint, direction);
    if (boundary.length !== 2) return;
    const limit = Math.max(0, Vector3.Dot(boundary[1].subtract(endpoint), direction));
    const distance = Math.max(0, Math.min(limit, Vector3.Dot(point.subtract(endpoint), direction)));
    stroke[index] = endpoint.add(direction.scale(distance));
  }
  function finishPencilExtension(points: Vector3[]) {
    const extension = pencilExtensions.get(points);
    if (!extension) return false;
    pencilExtensions.delete(points);
    display([]);
    if (!guides.includes(extension.guide)) {
      deps.notify('Line extension canceled: the original guide was removed.');
      return true;
    }
    if (Vector3.Distance(points[extension.index], extension.endpoint) < 0.05) {
      deps.notify('Line unchanged. Draw outward at least 0.05 yards to extend it.');
      return true;
    }
    const guide = extension.guide;
    const options = { ...guide.options };
    if (options.controls) options.controls = points.map(p => p.clone());
    const meshes = createGuideMeshes(points, options);
    guide.meshes.forEach(mesh => mesh.dispose());
    guide.points = points.map(p => p.clone());
    guide.options = options;
    guide.meshes = meshes;
    highlightGuide(guide);
    deps.notify('Straight guide extended. Its direction and selection are preserved.');
    return true;
  }
  function releasePointerCamera() {
    if (pointerCamera && !pointerCamera.isDisposed()) pointerCamera.attachControl(true);
    pointerCamera = null;
  }
  function getDraftSpacing() {
    const value = draftingSpacing?.valueAsNumber ?? 1.25;
    if (!Number.isFinite(value) || value < 0.05 || value > 20) {
      deps.notify('Enter a drafting spacing from 0.05 to 20 yards.');
      return null;
    }
    return value;
  }
  function getDraftAngle() {
    const angle = Number(draftingAngle?.value ?? 45);
    return [30, 45, 60, 90].includes(angle) ? angle : 45;
  }
  function makeStroke(kind: FieldDrawingTool, start: Vector3, end: Vector3) {
    if (kind === 'tSquare' || kind === 'setSquare') {
      const reference = activeGuide()?.points;
      if (kind === 'tSquare' && parallelReference) {
        if (!reference) return [];
        const direction = reference[reference.length - 1].subtract(reference[0]);
        direction.y = 0;
        if (direction.length() < 0.05) return [];
        direction.normalize();
        return [start.clone(), start.add(direction.scale(Vector3.Dot(end.subtract(start), direction)))];
      }
      return constrainedDraftLine(start, end, kind === 'tSquare' ? null : getDraftAngle());
    }
    if (kind === 'spline') {
      const delta = end.subtract(start);
      const middle = start.add(end).scale(0.5).add(new Vector3(-delta.z, 0, delta.x).scale(0.25));
      return sampleDraftSpline([start, middle, end]);
    }
    if (kind === 'stickyNote') {
      return [new Vector3(start.x, FIELD_SURFACE_Y + 0.025, start.z),
        new Vector3(start.x + 0.1, FIELD_SURFACE_Y + 0.025, start.z)];
    }
    if (kind === 'tape' || kind === 'annotation' || kind === 'dividers') {
      return [start.clone(), end.clone()];
    }
    if (kind === 'offset') {
      const source = activeGuide()?.points;
      const spacing = getDraftSpacing();
      return source && spacing !== null ? offsetDraftLine(source, spacing * offsetSide) : [];
    }
    return kind === 'wire' ? memoryWire.shapeAt(start, end) : buildToolGuide(kind, start, end);
  }
  function toolInstructions(kind: FieldDrawingTool) {
    const instructions: Partial<Record<FieldDrawingTool, string>> = {
      pencil: 'Pencil: draw freehand or along a ruler. Start within 0.25 yards of a straight guide endpoint and draw outward to extend that guide along its original direction.',
      ruler: 'Ruler: slide and rotate the flat straightedge on the field. Draw along its edge with a pencil. Desktop field drags still create straight guides.',
      protractor: 'Protractor: slide and rotate it flat on the field. Desktop field drags still create semicircular guides.',
      compass: 'Compass: set the radius with Span -/+, then touch the needle to the field. The needle stays pinned while the pencil rotates around it. Release to finish the circle. Desktop: drag to rotate about the starting point at the preset radius.',
      tSquare: 'T-square: drag or touch its edge to draw field-axis lines. Parallel ref switches to the newest guide direction.',
      setSquare: `Set square: drag or touch its edge to draw at multiples of ${getDraftAngle()} degrees. Angle cycles 30/45/60/90.`,
      dividers: 'Dividers: drag or touch/lift to mark equal intervals along the newest guide (or the drawn segment). Spacing +/- sets yards.',
      tape: 'Tape: drag two field points or touch/lift its edge to save a yards, 8-to-5 steps, and       angle label. Erase and redraw to remeasure.',
            spline: 'French curve: drag endpoints or touch/lift to create a smooth curve.',
      offset: 'Offset: drag or touch/lift to copy the newest guide at the configured spacing. Offset side swaps left/right. Draw a source guide first.',
      annotation: 'Annotation: drag a leader or touch/lift to place your Settings note text on the field.',
      stickyNote: 'Sticky note: click or touch/lift on the field to place the text from Settings. Save locally preserves notes.',
      camera: 'Camera: use Take photo on the advanced tray or Camera in Settings to capture the field and save drafting together. Restore photo recalls drafting; Download PNG exports the image.',
    };
    return instructions[kind];
  }
  function makeTool(kind: FieldDrawingTool, dock: TransformNode, index: number, label = true): Tool {
    const root = new TransformNode(`fieldTool-${kind}`, scene);
    const parts = new Set<AbstractMesh>();
    const tip = new Vector3(0, -0.12, 0);
    const edge = new Vector3(0.24, -0.12, 0);
    function rod(name: string, a: Vector3, b: Vector3, radius: number) {
      const mesh = MeshBuilder.CreateTube(name, { path: [a, b], radius, tessellation: 6, cap: 3 }, scene);
      mesh.parent = root; mesh.material = kind === 'pencil' ? pencilMaterial : metal;
      parts.add(mesh); return mesh;
    }
    function marking(text: string, position: Vector3, size: number) {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Tool graduations require a 2D canvas context.');
      ctx.fillStyle = '#101820'; ctx.font = 'bold 42px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 64, 32);
      const texture = new DynamicTexture(`toolMark-${kind}-${text}`, canvas, scene, false);
      texture.hasAlpha = true; texture.update();
      const material = new StandardMaterial(`toolMark-${kind}-${text}Material`, scene);
      material.diffuseTexture = texture; material.opacityTexture = texture;
      material.disableLighting = true; material.emissiveColor = Color3.White();
      material.backFaceCulling = false;
      const mesh = MeshBuilder.CreatePlane(`toolMark-${kind}-${text}`, { width: size * 2, height: size }, scene);
      mesh.parent = root; mesh.position.copyFrom(position); mesh.rotation.x = Math.PI / 2;
      mesh.material = material; mesh.isPickable = false;
      mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
    }
    if (kind === 'camera') {
      const body = MeshBuilder.CreateBox('draftingCameraBody', { width: 0.16, height: 0.09, depth: 0.07 }, scene);
      body.parent = root; body.material = graphite; parts.add(body);
      const lens = MeshBuilder.CreateCylinder('draftingCameraLens', { height: 0.05, diameter: 0.065, tessellation: 16 }, scene);
      lens.parent = root; lens.rotation.x = Math.PI / 2; lens.position.z = -0.05;
      lens.material = metal; parts.add(lens);
      const shutter = MeshBuilder.CreateSphere('draftingCameraShutter', { diameter: 0.025, segments: 8 }, scene);
      shutter.parent = root; shutter.position.set(0.05, 0.05, 0); shutter.material = divisionMarkMaterial;
      const shutterAction: HandMenuHit = { action: 'drawingTool', tool: 'takePhoto' };
      registerMenuButton(shutter, shutterAction);
      new FloatingPanel(root, new Set([shutter]), root, Vector3.Zero(), new Map([[shutter, shutterAction]]));
    } else if (kind === 'tSquare' || kind === 'setSquare' || kind === 'offset') {
      tip.set(-0.12, -0.12, 0); edge.set(0.12, -0.12, 0);
      rod(`draftingBody-${kind}`, tip, edge, 0.009);
      if (kind === 'tSquare') {
        rod('draftingTSquareCross', new Vector3(-0.12, -0.12, -0.1), new Vector3(-0.12, -0.12, 0.1), 0.012);
      } else if (kind === 'setSquare') {
        rod('draftingSetSquareVertical', tip, new Vector3(-0.12, -0.12, 0.2), 0.009);
        rod('draftingSetSquareHypotenuse', new Vector3(-0.12, -0.12, 0.2), edge, 0.009);
      } else {
        rod('draftingOffsetParallel', tip.add(new Vector3(0, 0, 0.08)), edge.add(new Vector3(0, 0, 0.08)), 0.009);
        rod('draftingOffsetLink', tip, tip.add(new Vector3(0, 0, 0.08)), 0.006);
      }
    } else if (kind === 'dividers') {
      edge.set(0.12, -0.12, 0);
      rod('draftingDividerLegA', new Vector3(0.06, 0.08, 0), tip, 0.006);
      rod('draftingDividerLegB', new Vector3(0.06, 0.08, 0), edge, 0.006);
      rod('draftingDividerHinge', new Vector3(0.04, 0.08, 0), new Vector3(0.08, 0.08, 0), 0.012);
    } else if (kind === 'tape') {
      tip.set(-0.12, -0.12, 0); edge.set(0.12, -0.12, 0);
      const housing = MeshBuilder.CreateBox('draftingTapeHousing', { width: 0.07, height: 0.065, depth: 0.04 }, scene);
      housing.parent = root; housing.position.copyFrom(tip); housing.material = pencilMaterial; parts.add(housing);
      rod('draftingTapeBlade', tip, edge, 0.009).material = pencilMaterial;
      rod('draftingTapeHook', edge, edge.add(new Vector3(0, 0.025, 0)), 0.004);
    } else if (kind === 'spline') {
      tip.set(-0.12, -0.12, 0); edge.set(0.12, -0.12, 0);
      const curve = sampleDraftSpline([tip, new Vector3(0, -0.12, 0.2), edge])
        .map(p => new Vector3(p.x, -0.12, p.z));
      const frame = MeshBuilder.CreateTube('draftingFrenchCurve', { path: curve, radius: 0.01, tessellation: 6 }, scene);
      frame.parent = root; frame.material = plastic; parts.add(frame);
    } else if (kind === 'stickyNote') {
      const pad = MeshBuilder.CreateBox('draftingStickyPad', { width: 0.13, height: 0.018, depth: 0.13 }, scene);
      pad.parent = root; pad.position.y = -0.12; pad.material = pencilMaterial; parts.add(pad);
      edge.set(0.12, -0.12, 0);
    } else if (kind === 'annotation') {
      rod('draftingAnnotationPen', new Vector3(0, 0.1, 0), tip, 0.012).material = plastic;
      edge.set(0.12, -0.12, 0);
    } else if (kind === 'laser') {
      tip.set(-0.08, 0, 0);
      edge.set(0.08, 0, 0);
      const body = MeshBuilder.CreateBox('fieldLaserBody', { width: 0.16, height: 0.05, depth: 0.06 }, scene);
      body.parent = root; body.material = graphite; parts.add(body);
      const lens = MeshBuilder.CreateSphere('fieldLaserLens', { diameter: 0.035, segments: 8 }, scene);
      lens.parent = root; lens.position.copyFrom(edge); lens.material = laserMaterial; parts.add(lens);
    } else if (kind === 'pencil') {
      rod('fieldPencilShaft', new Vector3(0, 0.12, 0), new Vector3(0, -0.09, 0), 0.009);
      const cone = MeshBuilder.CreateCylinder('fieldPencilWood',
        { height: 0.025, diameterTop: 0.018, diameterBottom: 0.003, tessellation: 6 }, scene);
      cone.parent = root; cone.position.y = -0.1025; cone.material = wood; parts.add(cone);
      const lead = rod('fieldPencilTip', new Vector3(0, -0.115, 0), tip, 0.0015);
      lead.material = graphite;
      const ferrule = MeshBuilder.CreateCylinder('fieldPencilFerrule',
        { height: 0.02, diameter: 0.019, tessellation: 8 }, scene);
      ferrule.parent = root; ferrule.position.y = 0.12; ferrule.material = metal; parts.add(ferrule);
      const rubber = MeshBuilder.CreateCylinder('fieldPencilRubber',
        { height: 0.018, diameter: 0.018, tessellation: 8 }, scene);
      rubber.parent = root; rubber.position.y = 0.139; rubber.material = eraserMaterial; parts.add(rubber);
    } else if (kind === 'eraser') {
      const mesh = MeshBuilder.CreateBox('fieldEraser', { width: 0.07, height: 0.04, depth: 0.04 }, scene);
      mesh.parent = root; mesh.position.y = -0.1; mesh.material = eraserMaterial; parts.add(mesh);
      const sleeve = MeshBuilder.CreateBox('fieldEraserSleeve', { width: 0.035, height: 0.041, depth: 0.041 }, scene);
      sleeve.parent = root; sleeve.position.y = -0.1; sleeve.material = felt; parts.add(sleeve);
    } else if (kind === 'ruler') {
      tip.x = -0.12; edge.x = 0.12;
      const body = MeshBuilder.CreateBox('fieldRulerBody', { width: 0.26, height: 0.004, depth: 0.035 }, scene);
      body.parent = root; body.position.set(0, -0.118, 0.015); body.material = plastic; parts.add(body);
      rod('fieldRulerEdge', tip, edge, 0.006);
      for (let index = 0; index <= 12; index++) {
        const x = -0.12 + index * 0.02;
        rod('fieldRulerTick', new Vector3(x, -0.12, 0), new Vector3(x, -0.12, index % 3 ? 0.015 : 0.025), 0.0015);
        if (index % 3 === 0) marking(String(index), new Vector3(x, -0.114, 0.025), 0.008);
      }
    } else if (kind === 'protractor') {
      const path = Array.from({ length: 33 }, (_, i) => new Vector3(Math.cos(i * Math.PI / 32) * 0.12,
        -0.12, Math.sin(i * Math.PI / 32) * 0.12));
      const arc = MeshBuilder.CreateTube('fieldProtractorArc', { path, radius: 0.004, tessellation: 6 }, scene);
      arc.parent = root; arc.material = metal; parts.add(arc);
      const band = MeshBuilder.CreateRibbon('fieldProtractorBody', {
        pathArray: [path, path.map(point => new Vector3(point.x * 0.72, point.y, point.z * 0.72))],
        sideOrientation: 2,
      }, scene);
      band.parent = root; band.material = plastic; parts.add(band);
      rod('fieldProtractorBase', new Vector3(-0.12, -0.12, 0), new Vector3(0.12, -0.12, 0), 0.004);
      edge.x = 0.12;
      for (let angle = 0; angle <= 180; angle += 15) {
        const theta = angle * Math.PI / 180;
        rod('fieldProtractorTick', new Vector3(Math.cos(theta) * 0.1, -0.12, Math.sin(theta) * 0.1),
          new Vector3(Math.cos(theta) * 0.12, -0.12, Math.sin(theta) * 0.12), 0.0015);
        if (angle % 30 === 0) marking(String(angle),
          new Vector3(Math.cos(theta) * 0.087, -0.118, Math.sin(theta) * 0.087), 0.012);
      }
    } else if (kind === 'compass') {
      edge.x = 0.12;
      rod('fieldCompassPivotLeg', new Vector3(0.06, 0.08, 0), tip, 0.006);
      const pencil = rod('fieldCompassPencilLeg', new Vector3(0.06, 0.08, 0), edge, 0.006);
      pencil.material = pencilMaterial;
      rod('fieldCompassNeedle', new Vector3(0, -0.1, 0), tip, 0.002).material = graphite;
      rod('fieldCompassLead', new Vector3(0.114, -0.1, 0), edge, 0.002).material = graphite;
      rod('fieldCompassHinge', new Vector3(0.045, 0.08, 0), new Vector3(0.075, 0.08, 0), 0.01);
      rod('fieldCompassKnob', new Vector3(0.06, 0.08, 0), new Vector3(0.06, 0.115, 0), 0.009);
    } else {
      edge.x = 0.12;
      const outline = buildToolGuide(kind, Vector3.Zero(), new Vector3(0.12, 0, 0));
      const path = outline.map(point => new Vector3(point.x, -0.12, point.z));
      const frame = MeshBuilder.CreateTube(`fieldStencil-${kind}`, { path, radius: 0.006, tessellation: 6 }, scene);
      frame.parent = root; frame.material = metal; parts.add(frame);
      if (kind.endsWith('Cutter')) {
        const upper = MeshBuilder.CreateTube(`fieldCutterRim-${kind}`,
          { path: path.map(p => p.add(new Vector3(0, 0.045, 0))), radius: 0.009, tessellation: 6 }, scene);
        upper.parent = root; upper.material = metal; parts.add(upper);
        const wall = MeshBuilder.CreateRibbon(`fieldCutterWall-${kind}`, {
          pathArray: [path, path.map(point => point.add(new Vector3(0, 0.045, 0)))], sideOrientation: 2,
        }, scene);
        wall.parent = root; wall.material = metal; parts.add(wall);
      } else {
        const plate = MeshBuilder.CreateRibbon(`fieldStencilPlate-${kind}`, {
          pathArray: [path, path.map(point => new Vector3(point.x * 0.78, point.y, point.z * 0.78))],
          sideOrientation: 2,
        }, scene);
        plate.parent = root; plate.material = plastic; parts.add(plate);
      }
    }
    class PhysicalDrawingTool extends DetachableFloatingPanel {
      override get hasPanelChrome() { return false; }
      override beginPointer(ray: Ray) {
        if (floorCalibrationToggle?.checked || takingPhoto) return false;
        return super.beginPointer(ray);
      }
      override update(source: string, world: Matrix) {
        super.update(source, world);
        if (isSlidingTool(kind) && root.parent === null) flattenTool(tool);
        if (kind === 'compass') constrainCompass(tool);
      }
      override updatePointer(ray: Ray) {
        super.updatePointer(ray);
        if (isSlidingTool(kind) && root.parent === null) flattenTool(tool);
        if (kind === 'compass') constrainCompass(tool);
      }
      override end(source: string) {
        super.end(source);
        if (!this.grabbed()) tool.compassAnchor = undefined;
        if (isSlidingTool(kind) && root.parent === null) flattenTool(tool);
      }
      override begin(source: string, world: Matrix) {
        if (floorCalibrationToggle?.checked || takingPhoto) {
          deps.notify('Finish floor calibration before using drawing tools.');
          return;
        }
        deps.prepare();
        restoreArmedUntil = 0;
        desktopLaserAim = false;
        displayLaser([]);
        selected = kind;
        activeTool = tool;
        updateTableStatus();
        if (root.parent === dock) {
          makeTool(kind, dock, index, false);
          span = root.scaling.x;
          root.setParent(null);
          sizeHeld(root, span);
        } else span = heldSpan(root);
        super.begin(source, world);
        if (isSlidingTool(kind)) flattenTool(tool);
        if (kind === 'compass') constrainCompass(tool);
        deps.notify(toolInstructions(kind) ?? (kind === 'laser'
          ? 'Laser: rotate the held level to project a green line across the field. Use Save laser line on the Tools tray to save a guide. Desktop: drag on the field to aim.'
          : `${kind}: touch the working edge to the field, then lift. Desktop: drag on the field after picking up the tool.`));
      }
    }
    const panel = new PhysicalDrawingTool(root, parts, root, new Vector3(0.14, 0.15, 0.14));
    const dockPosition = new Vector3((index % 3 - 1) * 0.3, 0.23 - Math.floor(index / 3) * 0.2, -0.12);
    if (dock === draftingRoot) dockPosition.set((index % 3 - 1) * 0.43, 0.5 - Math.floor(index / 3) * 0.23, -0.12);
    if (kind === 'laser') dockPosition.set(0.55, 0.23, -0.12);
    if (kind === 'camera') dockPosition.set(-0.55, 0.23, -0.12);
    const dockRotation = Quaternion.FromEulerAngles(
      ['pencil', 'eraser', 'compass', 'dividers', 'annotation'].includes(kind) ? 0 : -Math.PI / 2, 0, 0);
    root.parent = dock;
    root.position.copyFrom(dockPosition);
    root.rotationQuaternion!.copyFrom(dockRotation);
    root.scaling.setAll(0.65);
    if (label) {
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 96;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Physical tool labels require a 2D canvas context.');
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 36px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = kind === 'tSquare' ? 'T-square' : kind === 'setSquare' ? 'Set square' :
        kind === 'spline' ? 'French curve' : kind.replace(/Stencil$/, ' stencil').replace(/Cutter$/, ' cutter');
      ctx.fillText(label, 256, 48, 500);
      const texture = new DynamicTexture(`physicalToolLabel-${kind}`, canvas, scene, false);
      texture.hasAlpha = true; texture.update();
      const material = new StandardMaterial(`physicalToolLabel-${kind}Material`, scene);
      material.diffuseTexture = texture; material.opacityTexture = texture;
      material.disableLighting = true; material.emissiveColor = Color3.White();
      const plaque = MeshBuilder.CreatePlane(`physicalToolLabel-${kind}`, { width: 0.26, height: 0.035 }, scene);
      plaque.parent = dock; plaque.position.set(dockPosition.x, dockPosition.y - 0.1, -0.026);
      plaque.material = material; plaque.isPickable = false;
      plaque.onDisposeObservable.addOnce(() => material.dispose(false, true));
    }
    const tool: Tool = { kind, root, panel, tip, edge, stroke: null, dock, dockPosition, dockRotation, dockIndex: index };
    if (!label) {
      for (const node of [root, ...root.getDescendants()]) node.name += `-copy-${root.uniqueId}`;
    }
    tools.push(tool);
    return tool;
  }
  function isSlidingTool(kind: FieldDrawingTool) {
    return kind === 'ruler' || kind === 'protractor';
  }
  function constrainCompass(tool: Tool) {
    if (!tool.panel.grabbed()) return;
    if (!tool.compassAnchor) {
      const tip = local(Vector3.TransformCoordinates(tool.tip, tool.root.computeWorldMatrix(true)));
      if (!isGuideOnField([tip, tip])) return;
      const scale = Vector3.TransformNormal(Vector3.Up(), deps.root.computeWorldMatrix(true)).length();
      if (Math.abs(tip.y - FIELD_SURFACE_Y) * scale > 0.025 * fieldToolScale()) return;
      tool.compassAnchor = tip.clone();
    }
    flattenTool(tool);
  }
  function flattenTool(tool: Tool) {
    const field = deps.root.computeWorldMatrix(true);
    const inverse = field.clone().invert();
    const world = tool.root.computeWorldMatrix(true);
    const tip = Vector3.TransformCoordinates(Vector3.TransformCoordinates(tool.tip, world), inverse);
    const edge = Vector3.TransformCoordinates(Vector3.TransformCoordinates(tool.edge, world), inverse);
    const yaw = -Math.atan2(edge.z - tip.z, edge.x - tip.x);
    if (tool.kind === 'compass' && tool.compassAnchor) {
      tip.x = tool.compassAnchor.x;
      tip.z = tool.compassAnchor.z;
    }
    const fieldRotation = Quaternion.Identity();
    field.decompose(new Vector3(), fieldRotation, new Vector3());
    tool.root.rotationQuaternion!.copyFrom(fieldRotation.multiply(Quaternion.RotationAxis(Vector3.Up(), yaw)));
    tool.root.computeWorldMatrix(true);
    const offset = Vector3.TransformNormal(tool.tip, tool.root.getWorldMatrix());
    tip.y = FIELD_SURFACE_Y + (tool.kind === 'compass' ? 0 : 0.008);
    tool.root.position.copyFrom(Vector3.TransformCoordinates(tip, field).subtract(offset));
    tool.root.computeWorldMatrix(true);
    if (isSlidingTool(tool.kind) && !tool.panel.grabbed()) {
      tool.fieldPose = tool.root.getWorldMatrix().multiply(inverse);
    }
  }
  (['pencil', 'eraser', 'ruler', 'protractor', 'compass', 'laser', 'camera'] as const).forEach((kind, index) =>
    makeTool(kind, trayRoot, index));
  stencils.forEach(([, kind], index) => makeTool(kind, stencilRoot, index));
  cutters.forEach(([, kind], index) => makeTool(kind, cutterRoot, index));
  (['tSquare', 'setSquare', 'dividers', 'tape', 'spline', 'offset', 'annotation', 'stickyNote'] as const)
    .forEach((kind, index) => makeTool(kind, draftingRoot, index));
  const memoryWire = createMemoryWire({
    dock: trayRoot, field: deps.root,
    commit: points => {
      if (points.length < 2) { commit(points); return; }
      const delta = snapForDrafting(points[0]).subtract(points[0]);
      commit(points.map(point => point.add(delta)));
    },
    contactScale: fieldToolScale,
    allowed: () => !floorCalibrationToggle?.checked && !takingPhoto,
    prepare: () => {
      if (floorCalibrationToggle?.checked) {
        deps.notify('Finish floor calibration before using drawing tools.');
        return false;
      }
      deps.prepare();
      return true;
    },
    selected: (fromGrip: boolean, wireRoot: TransformNode) => {
      selected = 'wire';
      activeWire = wireRoot;
      if (wireRoot.parent === null) span = heldSpan(wireRoot);
      else {
        span = wireRoot.scaling.x;
        if (fromGrip) {
          wireRoot.setParent(null);
          sizeHeld(wireRoot, span);
        }
      }
      deps.notify('Memory wire: hold the copper grip to move it; pull cyan beads to bend. Press flat onto turf and lift to stamp. Desktop: drag on the field to stamp the remembered shape.');
    },
  });
  function finishTool(tool: Tool) {
    if (tool.stroke && tool.kind !== 'eraser') finishStroke(tool.kind, tool.stroke);
    tool.stroke = null;
  }
  function finishStroke(kind: FieldDrawingTool, points: Vector3[]) {
    if (kind === 'pencil' && finishPencilExtension(points)) return;
    if (kind === 'dividers') {
      const spacing = getDraftSpacing();
      if (spacing === null) return;
      const source = activeGuide()?.points ?? points;
      const divisions = divideDraftLine(source, spacing);
      if (divisions.length < 2) {
        deps.notify('Dividers need a guide at least one interval long, with no more than 512 divisions.');
        display([]);
        return;
      }
      commit(source, { divisions, label: `${spacing} yd intervals | ${divisions.length} marks` });
    } else if (kind === 'spline') {
      if (points.length !== 65) { deps.notify('Draw spline endpoints before creating a curve.'); return; }
      const start = points[0].clone(), end = points[64].clone();
      const middle = points[32].scale(2).subtract(start.add(end).scale(0.5));
      commit(points, { editable: 'spline', controls: [start, middle, end] });
    } else if (kind === 'tape') {
      commit(points, { editable: 'yarn', controls: points.map(p => p.clone()), measure: true });
    } else if (kind === 'annotation' || kind === 'stickyNote') {
      const text = (draftingText?.value ?? 'Note').trim().slice(0, 80);
      if (!text) { deps.notify('Enter annotation text in Settings before placing a note.'); display([]); return; }
      commit(points, kind === 'stickyNote'
        ? { label: text, sticky: true, editable: 'yarn', controls: points.map(p => p.clone()) }
        : { label: text });
    } else if (kind === 'offset') {
      if (!guides.length) { deps.notify('Draw a source guide before using parallel offsets.'); display([]); return; }
      if (getDraftSpacing() === null) { display([]); return; }
      commit(points);
    } else if (kind === 'tSquare' && parallelReference && points.length < 2) {
      deps.notify('Parallel reference needs a guide with different start and end points. Draw an open source guide first.');
      display([]);
    } else if (kind.endsWith('Cutter')) {
      display([]);
      if (!isGuideOnField(points)) {
        deps.notify('Cutter rejected: keep the whole shape inside the field.');
      } else if (deps.createFormation(points.map(p => p.clone()))) {
        deps.notify('Cookie cutter stamped a standing formation.');
      }
    } else commit(points);
  }
  function action(value: DrawingToolCommand) {
    if (takingPhoto) { workspaceMessage('Wait for the field snapshot to finish.'); return; }
    if (value === 'toolboxStore') {
      if (guidesBusy()) {
        deps.notify('Finish the stroke before storing tools.'); return;
      }
      action('stop'); action('hide'); toolbox.store();
      deps.notify('All drafting tools are stored in the toolbox. Open a drawer to use them.');
      return;
    }
    if (value === 'guideSpacingLess' || value === 'guideSpacingMore' || value === 'guideSpacingApply' || value === 'guideFacing' ||
      value === 'guideFacingLeft' || value === 'guideFacingRight') {
      if (floorCalibrationToggle?.checked || guidesBusy()) {
        deps.notify('Finish drawing or floor calibration before changing guide settings.'); return;
      }
      if (!selectedGuide || selectedGuide.options.sticky) {
        deps.notify('Select a drafted line or curve to configure marcher spacing and facing.'); return;
      }
      const settings = getGuideMarcherSettings(selectedGuide.options);
      if (value === 'guideSpacingApply') {
        const spacing = getDraftSpacing();
        if (spacing === null || spacing < 0.625 || spacing > 10) {
          deps.notify('Enter a marcher spacing from 0.625 to 10 yards in Divider spacing, then apply it.'); return;
        }
        settings.spacing = spacing;
      } else if (value === 'guideSpacingLess' || value === 'guideSpacingMore') {
        settings.spacing = Number(Math.max(0.625, Math.min(10,
          settings.spacing * (value === 'guideSpacingMore' ? 1.25 : 0.8))).toFixed(3));
      } else if (value === 'guideFacing') {
        settings.facing = settings.facing === 'along' ? 'reverse' : settings.facing === 'reverse' ? 'fixed' : 'along';
      } else {
        settings.facing = 'fixed';
        settings.facingAngle = (settings.facingAngle + (value === 'guideFacingLeft' ? -15 : 15) + 360) % 360;
      }
      Object.assign(selectedGuide.options, settings);
      updateTableStatus();
      deps.notify(`Guide marchers: ${settings.spacing} yards, ${settings.facing}` +
        (settings.facing === 'fixed' ? ` ${settings.facingAngle} degrees.` : '.'));
      return;
    }
    if (value === 'table' || value === 'tableExit') { setTableMode(value === 'table'); return; }
    if (value === 'tablePreview') {
      if (!tableMode) { deps.notify('Enter drafting mode before showing the full-size field.'); return; }
      fullSizePreview = !fullSizePreview;
      if (fullSizePreview) showFullSizePreview();
      else fieldPreview.setEnabled(false);
      updateTableStatus();
      deps.notify(fullSizePreview ? 'Live full-size field shown in the distance. Editing stays on the tabletop.'
        : 'Full-size field preview hidden.');
      return;
    }
    if (value === 'tableSnap' || value === 'tableGrid' || value.startsWith('guide')) {
      if (!tableMode) { deps.notify('Enter Drafting table mode before using workspace editing controls.'); return; }
      if (floorCalibrationToggle?.checked) { deps.notify('Finish floor calibration before editing drafting.'); return; }
      if (value === 'tableSnap') {
        tableSnap = !tableSnap;
        deps.notify(`Drafting snap ${tableSnap ? 'on: endpoints, guide lines, then nearby grid points' : 'off'}.`);
      } else if (value === 'tableGrid') {
        if (fieldGridToggle) {
          fieldGridToggle.checked = !fieldGridToggle.checked;
          fieldGridToggle.dispatchEvent(new Event('change'));
        }
      } else if (value === 'guideSelect') {
        action('stop');
        deps.prepare();
        deps.notify('Select a guide on the field, then use the workspace editing controls.');
      } else editSelectedGuide(value);
      updateTableStatus(); return;
    }
    if (value === 'takePhoto') { void takePhoto(); return; }
    if (value === 'restorePhoto') {
      try {
        const photo = readPhoto();
        if (photo) {
          if (!restoringPhoto) restoreArmedUntil = 0;
          restoringPhoto = true;
          workspaceAction('restoreDrafting', parseDraftingWorkspace(photo.workspace));
          showPhoto(photo);
        }
      } catch (error) { workspaceMessage(`Could not restore camera snapshot: ${String(error)}`); }
      return;
    }
    if (value === 'downloadPhoto') {
      try {
        const photo = readPhoto();
        if (photo) {
          const bytes = Uint8Array.from(atob(photo.image.slice(photo.image.indexOf(',') + 1)), char => char.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
          const link = document.createElement('a');
          try {
            link.href = url; link.download = `field-${photo.capturedAt.replace(/[:.]/g, '-')}.png`;
            document.body.appendChild(link);
            link.click();
          } finally {
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
          workspaceMessage('Field photo download requested. The PNG alone does not contain restorable drafting.');
        }
      } catch (error) { workspaceMessage(`Could not download camera snapshot: ${String(error)}`); }
      return;
    }
    if (restoringPhoto) { restoreArmedUntil = 0; restoringPhoto = false; }
    if (value !== 'restoreDrafting') restoreArmedUntil = 0;
    if (value === 'saveDrafting' || value === 'restoreDrafting' || value === 'deleteDrafting') {
      workspaceAction(value);
      return;
    }
    if (value === 'show') { show(); return; }
    if (value === 'stencils') { showStencils(); return; }
    if (value === 'cutters') { showCutters(); return; }
    if (value === 'drafting') { showDrafting(); return; }
    if (value === 'hide') {
      tray.release(); trayRoot.setEnabled(false);
      stencilTray.release(); stencilRoot.setEnabled(false);
      cutterTray.release(); cutterRoot.setEnabled(false);
      draftingTray.release(); draftingRoot.setEnabled(false);
      tablePanel.hide();
      return;
    }
    if (floorCalibrationToggle?.checked) { deps.notify('Finish floor calibration before using drawing tools.'); return; }
    if (value === 'synchronizedRoutes') {
      const guide = activeGuide();
      if (!guide) { deps.notify('Draw a destination guide on the field first.'); return; }
      if (deps.createSynchronizedRoutes(guide.points.map(point => point.clone()))) {
        deps.notify('Synchronized routes created from the destination guide.');
      }
      return;
    }
    if (value === 'draftSpacingLess' || value === 'draftSpacingMore') {
      const spacing = getDraftSpacing();
      if (spacing !== null && draftingSpacing) {
        draftingSpacing.value = String(Math.max(0.05, Math.min(20,
          spacing * (value === 'draftSpacingMore' ? 1.25 : 0.8))));
        deps.notify(`Divider spacing / offset: ${Number(draftingSpacing.value).toFixed(3)} yards.`);
        updateDraftStatus();
      }
      return;
    }
    if (value === 'draftAngle') {
      const angles = [30, 45, 60, 90];
      if (draftingAngle) draftingAngle.value = String(angles[(angles.indexOf(getDraftAngle()) + 1) % angles.length]);
      deps.notify(`Set-square angle: ${getDraftAngle()} degrees.`);
      updateDraftStatus();
      return;
    }
    if (value === 'draftSide') {
      offsetSide *= -1;
      deps.notify(`Offset side: ${offsetSide > 0 ? 'left' : 'right'} along the source guide.`);
      updateDraftStatus();
      return;
    }
    if (value === 'draftReference') {
      parallelReference = !parallelReference;
      deps.notify(parallelReference ? 'T-square uses the selected or newest guide direction.' : 'T-square aligns to field axes.');
      updateDraftStatus();
      return;
    }
    if (value === 'laserPin') {
      if (laserPoints.length !== 2) {
        deps.notify('Aim the laser across the field before saving a line.');
        return;
      }
      commit(laserPoints.map(point => point.clone()));
      return;
    }
    if (value === 'wireReset') {
      memoryWire.reset();
      deps.notify('Memory wire straightened.');
      return;
    }
    if (value === 'undo' || value === 'clear') {
      const count = value === 'undo' ? Math.min(1, guides.length) : guides.length;
      guides.splice(guides.length - count, count)
        .forEach(disposeGuide);
      deps.notify(value === 'undo' ? 'Newest guide removed.' : 'Drawing guides cleared.');
      return;
    }
    if (value === 'formation' || value === 'path') {
      const guide = activeGuide();
      if (!guide) { deps.notify('Draw a guide on the field first.'); return; }
      const points = guide.points.map(p => p.clone());
      if (value === 'formation' ? deps.createFormation(points, getGuideMarcherSettings(guide.options)) : deps.createPath(points)) {
        deps.notify(value === 'formation' ? 'Standing formation created from guide.' : 'Marching path created from guide.');
      }
      return;
    }
    if (value === 'smaller' || value === 'larger') {
      span = Math.max(0.5, Math.min(3, span * (value === 'larger' ? 1.25 : 0.8)));
      if (activeTool?.kind === selected && activeTool.root.parent === null) {
        activeTool.stroke = null;
        activeTool.fieldPose = undefined;
        sizeHeld(activeTool.root, span);
      }
      if (selected === 'wire' && activeWire?.parent === null) sizeHeld(activeWire, span);
      display([]);
      deps.notify(`Tool span: ${Math.round(span * 100)}%.`);
      return;
    }
    pointerStroke = null; pointerAnchor = null; releasePointerCamera(); display([]);
    desktopLaserAim = false; displayLaser([]);
    if (value === 'stop') {
      activeTool = null;
      activeWire = null;
      memoryWire.returnToDock();
      const retained = new Set<FieldDrawingTool>();
      for (let index = 0; index < tools.length;) {
        const tool = tools[index];
        if (retained.has(tool.kind)) {
          tool.panel.release();
          tool.root.dispose();
          tools.splice(index, 1);
        } else {
          retained.add(tool.kind);
          index++;
        }
      }
      tools.forEach(tool => {
        tool.fieldPose = undefined;
        tool.stroke = null; tool.panel.release();
        tool.root.parent = tool.dock;
        tool.root.position.copyFrom(tool.dockPosition);
        tool.root.rotationQuaternion!.copyFrom(tool.dockRotation);
        tool.root.scaling.setAll(0.65);
      });
      selected = null; deps.notify('Drawing tools returned to their toolbox drawers.'); return;
    }
    deps.prepare();
    if (value === 'wire') {
      selected = 'wire';
      const wire = memoryWire.withdraw();
      activeWire = wire.root;
      wire.root.setParent(null);
      sizeHeld(wire.root, span);
      placeHeldTool(wire.panel, wire.root);
      return;
    }
    const tool = tools.find(tool => tool.kind === value && tool.root.parent === tool.dock) ??
      tools.find(tool => tool.kind === value);
    if (!tool) throw new Error(`Unknown physical drawing tool: ${value}`);
    selected = tool.kind;
    activeTool = tool;
    tool.panel.release();
    if (tool.root.parent === tool.dock) {
      makeTool(tool.kind, tool.dock, tool.dockIndex, false);
    }
    tool.root.setParent(null);
    sizeHeld(tool.root, span);
    tool.root.setEnabled(true);
    placeHeldTool(tool.panel, tool.root);
    if (isSlidingTool(tool.kind)) flattenTool(tool);
    deps.notify(toolInstructions(tool.kind) ?? (value === 'laser'
      ? 'Laser: drag on the field to aim a live line, then use Save laser line on the Tools tray. In XR, hold and rotate the level; release turns the beam off.'
      : value.endsWith('Cutter')
      ? `${value}: press onto the field and lift to stamp a formation. Desktop: drag center to radius. Span +/- changes size.`
      : `${value}: grab the tool and touch its tip/edge to the field; lift to finish. Desktop: drag on the field. Span +/- changes size.`));
  }
  function pointer(type: 'down' | 'move' | 'up', point: Vector3 | null) {
    if (tableMode && !selected && !floorCalibrationToggle?.checked && !takingPhoto && point) {
      if (type === 'down') {
        deps.prepare();
        if (!selectNear(point, 0.35, false)) setSelectedGuide(null);
      }
      return true;
    }
    if (!selected || selected === 'camera' || floorCalibrationToggle?.checked || takingPhoto) return false;
    if (point && selected !== 'eraser' && selected !== 'laser') point = snapForDrafting(point);
    restoreArmedUntil = 0;
    if (type === 'down') {
      if (!point) return false;
      pointerStroke = selected === 'pencil' ? beginPencilStroke(point) : [point.clone()];
      pointerAnchor = point.clone();
      if (selected === 'compass' && activeTool?.kind === 'compass') {
        const world = activeTool.root.computeWorldMatrix(true);
        pointerCompassRadius = Vector3.Distance(
          local(Vector3.TransformCoordinates(activeTool.tip, world)),
          local(Vector3.TransformCoordinates(activeTool.edge, world)));
      }
      if (!pointerCamera) {
        pointerCamera = scene.activeCamera;
        pointerCamera?.detachControl();
      }
    } else if (!pointerStroke) return false;
    if (point && pointerStroke) {
      const previous = pointerStroke[pointerStroke.length - 1];
      if (selected === 'eraser') erase(previous, point, 0.5);
      if (selected === 'pencil') updatePencilStroke(pointerStroke, point);
      else if (selected === 'eraser') append(pointerStroke, point);
      else if (pointerAnchor) {
        if (selected === 'compass') {
          const direction = point.subtract(pointerAnchor);
          direction.y = 0;
          if (direction.lengthSquared() < 1e-10) direction.set(1, 0, 0);
          point = pointerAnchor.add(direction.normalize().scale(pointerCompassRadius));
        }
        pointerStroke = selected === 'wire'
          ? memoryWire.shapeAt(pointerAnchor, point) : makeStroke(selected, pointerAnchor, point);
      }
      if (selected === 'laser') {
        desktopLaserAim = true;
        displayLaser(pointerStroke);
      } else if (selected !== 'eraser') display(pointerStroke);
    }
    if (type === 'up') {
      if (pointerStroke && selected !== 'eraser' && selected !== 'laser') finishStroke(selected, pointerStroke);
      pointerStroke = null;
      pointerAnchor = null;
      releasePointerCamera();
    }
    return true;
  }
  const pointerUp = () => {
    if (pointerStroke) pointer('up', null);
  };
  const cancelPointer = () => {
    pointerStroke = null; pointerAnchor = null; display([]); releasePointerCamera();
    desktopLaserAim = false; displayLaser([]);
  };
  function workspaceMessage(message: string) {
    if (draftingSaveStatus) draftingSaveStatus.value = message;
    deps.notify(message);
  }
  function collectWorkspace(): DraftingWorkspace {
    return {
      version: 1, guides: guides.map(guide => ({ points: guide.points, options: guide.options })),
      settings: {
        spacing: draftingSpacing?.valueAsNumber ?? 1.25, angle: Number(draftingAngle?.value ?? 45),
        text: draftingText?.value ?? '', offsetSide, parallelReference,
        gridVisible: fieldGridToggle?.checked ?? false, gridInterval: fieldGridInterval?.valueAsNumber ?? 5,
      },
    };
  }
  function showPhoto(photo: DraftingPhoto) {
    if (draftingPhotoPreview) {
      draftingPhotoPreview.src = photo.image;
      draftingPhotoPreview.hidden = false;
    }
  }
  function readPhoto() {
    const json = localStorage.getItem(DRAFTING_CAMERA_KEY);
    if (json === null) { workspaceMessage('No camera snapshot saved for this browser and site.'); return null; }
    return parseDraftingPhoto(json);
  }
  async function takePhoto() {
    if (floorCalibrationToggle?.checked || pointerStroke ||
      tools.some(tool => tool.kind !== 'camera' && (tool.panel.grabbed() || tool.stroke !== null)) ||
      memoryWire.instances().some(wire => wire.panel.grabbed() || wire.handles.some(handle => handle.grabbed()))) {
      workspaceMessage('Finish floor calibration and release drawing tools before taking a snapshot.');
      return;
    }
    takingPhoto = true; restoreArmedUntil = 0;
    workspaceMessage('Taking top-down field snapshot...');
    try {
      const photo = await captureDraftingPhoto(deps.root, collectWorkspace(),
        guides.flatMap(guide => guide.meshes));
      if (scene.isDisposed || serializeDraftingWorkspace(collectWorkspace()) !== photo.workspace) {
        throw new Error('Drafting or settings changed during capture. Take another photo.');
      }
      const json = JSON.stringify(photo);
      parseDraftingPhoto(json);
      localStorage.setItem(DRAFTING_CAMERA_KEY, json);
      showPhoto(photo);
      workspaceMessage('Field photo and drafting workspace saved together. Use Restore photo to recall drafting.');
    } catch (error) {
      workspaceMessage(`Could not save camera snapshot: ${String(error)}. Previous snapshot is unchanged.`);
    } finally { takingPhoto = false; }
  }
  function workspaceAction(command: 'saveDrafting' | 'restoreDrafting' | 'deleteDrafting', photoWorkspace?: DraftingWorkspace) {
    if (floorCalibrationToggle?.checked) {
      workspaceMessage('Finish floor calibration before saving or restoring drafting.');
      return;
    }
    if (pointerStroke || tools.some(tool => tool.panel.grabbed()) ||
      memoryWire.instances().some(wire => wire.panel.grabbed() || wire.handles.some(handle => handle.grabbed()))) {
      workspaceMessage('Release drafting tools before saving or restoring.');
      return;
    }
    if (command === 'deleteDrafting') {
      try { localStorage.removeItem(DRAFTING_WORKSPACE_KEY); }
      catch (error) { workspaceMessage(`Could not delete saved drafting: ${String(error)}`); return; }
      workspaceMessage('Saved drafting deleted. Current guides are unchanged.');
      return;
    }
    if (command === 'saveDrafting') {
      const snapshot = collectWorkspace();
      try {
        const json = serializeDraftingWorkspace(snapshot);
        localStorage.setItem(DRAFTING_WORKSPACE_KEY, json);
      } catch (error) {
        workspaceMessage(`Could not save drafting: ${String(error)}`);
        return;
      }
      workspaceMessage(`Saved ${guides.length} drafting guides locally. Save again after making changes.`);
      return;
    }
    let snapshot: DraftingWorkspace;
    try {
      if (photoWorkspace) snapshot = photoWorkspace;
      else {
        const json = localStorage.getItem(DRAFTING_WORKSPACE_KEY);
        if (json === null) { workspaceMessage('No saved drafting workspace in this browser for this site.'); return; }
        snapshot = parseDraftingWorkspace(json);
      }
    } catch (error) {
      workspaceMessage(`Could not restore drafting; current guides unchanged: ${String(error)}`);
      return;
    }
    if (guides.length > 0 && Date.now() > restoreArmedUntil) {
      restoreArmedUntil = Date.now() + 10000;
      workspaceMessage(`Restore replaces current drafting guides. Press ${photoWorkspace ? 'Restore photo' : 'Restore saved'} again within 10 seconds to confirm.`);
      return;
    }
    restoreArmedUntil = 0;
    const result = applyWorkspace(snapshot);
    workspaceMessage(typeof result === 'string' ? result :
      `Restored ${guides.length} drafting guides. Marchers and routes are unchanged.`);
  }
  // Replaces the current guides and drafting settings; returns an error message on failure.
  function applyWorkspace(snapshot: DraftingWorkspace): true | string {
    // Build and validate the replacement before removing any current guide.
    const replacements: Guide[] = [];
    try {
      for (const saved of snapshot.guides) {
        const guide: Guide = { ...saved, meshes: createGuideMeshes(saved.points, saved.options) };
        replacements.push(guide);
      }
    } catch (error) {
      replacements.forEach(disposeGuide);
      return `Could not build saved drafting; current guides unchanged: ${String(error)}`;
    }
    cancelPointer();
    deps.prepare();
    guides.splice(0).forEach(disposeGuide);
    guides.push(...replacements);
    const settings = snapshot.settings;
    if (draftingSpacing) draftingSpacing.value = String(settings.spacing);
    if (draftingAngle) draftingAngle.value = String(settings.angle);
    if (draftingText) draftingText.value = settings.text;
    offsetSide = settings.offsetSide; parallelReference = settings.parallelReference;
    if (fieldGridInterval) fieldGridInterval.value = String(settings.gridInterval);
    if (fieldGridToggle) {
      fieldGridToggle.checked = settings.gridVisible;
      fieldGridToggle.dispatchEvent(new Event('change'));
    }
    updateDraftStatus();
    return true;
  }
  const saveWorkspace = () => action('saveDrafting');
  const restoreWorkspace = () => action('restoreDrafting');
  const deleteWorkspace = () => action('deleteDrafting');
  draftingSaveButton?.addEventListener('click', saveWorkspace);
  draftingRestoreButton?.addEventListener('click', restoreWorkspace);
  draftingDeleteButton?.addEventListener('click', deleteWorkspace);
  const capturePhoto = () => action('takePhoto');
  const restorePhoto = () => action('restorePhoto');
  const downloadPhoto = () => action('downloadPhoto');
  draftingCameraButton?.addEventListener('click', capturePhoto);
  draftingPhotoRestoreButton?.addEventListener('click', restorePhoto);
  draftingPhotoDownloadButton?.addEventListener('click', downloadPhoto);
  try {
    const json = localStorage.getItem(DRAFTING_CAMERA_KEY);
    if (json !== null) showPhoto(parseDraftingPhoto(json));
  } catch (error) { workspaceMessage(`Could not load saved camera snapshot: ${String(error)}`); }
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('blur', cancelPointer);
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (takingPhoto) return;
    if (!desktopLaserAim && !tools.some(tool =>
      tool.kind === 'laser' && tool.root.isEnabled() && tool.panel.grabbed())) displayLaser([]);
    for (const tool of tools) {
      if (tool.kind === 'camera') continue;
      if (tool.kind === 'laser') {
        if (floorCalibrationToggle?.checked) {
          cancelPointer();
        } else if (tool.root.isEnabled() && tool.panel.grabbed()) {
          desktopLaserAim = false;
          const world = tool.root.computeWorldMatrix(true);
          const start = local(Vector3.TransformCoordinates(tool.tip, world));
          const end = local(Vector3.TransformCoordinates(tool.edge, world));
          const direction = end.subtract(start);
          displayLaser(Math.hypot(direction.x, direction.z) >= direction.length() * 0.1
            ? buildLaserGuide(start, direction) : []);
        }
        continue;
      }
      if (!tool.root.isEnabled()) continue;
      if (floorCalibrationToggle?.checked) {
        tool.stroke = null; cancelPointer();
        continue;
      }
      if (isSlidingTool(tool.kind) && tool.root.parent === null) {
        if (!tool.panel.grabbed() && tool.fieldPose) {
          tool.fieldPose.multiply(deps.root.computeWorldMatrix(true)).decompose(
            tool.root.scaling, tool.root.rotationQuaternion!, tool.root.position);
        }
        flattenTool(tool);
        tool.stroke = null;
        continue;
      }
      if (!tool.panel.grabbed()) { finishTool(tool); continue; }
      if (tool.kind === 'compass') constrainCompass(tool);
      const world = tool.root.computeWorldMatrix(true);
      if (tool.kind !== 'pencil' && tool.kind !== 'eraser') {
        const toolUp = Vector3.TransformNormal(Vector3.Up(), world).normalize();
        const fieldUp = Vector3.TransformNormal(Vector3.Up(), deps.root.computeWorldMatrix(true)).normalize();
        if (Vector3.Dot(toolUp, fieldUp) < 0.95) { finishTool(tool); continue; }
      }
      const tipWorld = Vector3.TransformCoordinates(tool.tip, world);
      let tip = local(tipWorld);
      const scaleY = Vector3.TransformNormal(Vector3.Up(), deps.root.getWorldMatrix()).length();
      const contact = 0.025 * fieldToolScale();
      if (Math.abs(tip.y - FIELD_SURFACE_Y) * scaleY > contact) { finishTool(tool); continue; }
      tip.y = FIELD_SURFACE_Y + 0.025;
      if (tool.kind !== 'eraser' && tool.kind !== 'compass') tip = snapForDrafting(tip);
      if (tool.kind === 'pencil') {
        let nearest = Infinity;
        const pencilTip = tip.clone();
        for (const ruler of tools) {
          if (ruler.kind !== 'ruler' || ruler.root.parent !== null || !ruler.root.isEnabled()) continue;
          const rulerWorld = ruler.root.computeWorldMatrix(true);
          const a = local(Vector3.TransformCoordinates(ruler.tip, rulerWorld));
          const b = local(Vector3.TransformCoordinates(ruler.edge, rulerWorld));
          const direction = b.subtract(a);
          const length = direction.lengthSquared();
          if (length > 0 && Math.abs(a.y - FIELD_SURFACE_Y) * scaleY <= contact &&
            Math.abs(b.y - FIELD_SURFACE_Y) * scaleY <= contact) {
            const t = Math.max(0, Math.min(1, Vector3.Dot(pencilTip.subtract(a), direction) / length));
            const projected = a.add(direction.scale(t));
            const distance = Vector3.Distance(projected, pencilTip) * scaleY;
            if (distance <= contact * 1.4 && distance < nearest) {
              nearest = distance;
              projected.y = tip.y;
              tip = projected;
            }
          }
        }
      }
      if (tool.kind === 'eraser') {
        const previous = tool.stroke?.[0] ?? tip;
        erase(previous, tip, Math.max(0.1, 0.04 * tool.root.scaling.x / scaleY));
        tool.stroke = [tip];
      } else if (tool.kind === 'pencil') {
        tool.stroke ??= beginPencilStroke(tip);
        updatePencilStroke(tool.stroke, tip);
        display(tool.stroke);
      } else {
        const rawEdge = local(Vector3.TransformCoordinates(tool.edge, world));
        const edge = tool.kind === 'compass' ? rawEdge : snapForDrafting(rawEdge);
        tool.stroke = makeStroke(tool.kind, tip, edge);
        display(tool.stroke);
      }
    }
  });
  const scaleObserver = onARScaleChangedObservable.add(() => {
    for (const root of [...tools.map(tool => tool.root), ...memoryWire.instances().map(wire => wire.root)]) {
      const base = heldSpans.get(root);
      if (base !== undefined && root.parent === null) root.scaling.setAll(base * fieldToolScale());
    }
  });
  scene.onDisposeObservable.addOnce(() => {
    onARScaleChangedObservable.remove(scaleObserver);
    scene.onBeforeRenderObservable.remove(observer);
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('blur', cancelPointer);
    releasePointerCamera();
    drawingToolsButton?.removeEventListener('click', show);
    stencilTrayButton?.removeEventListener('click', showStencils);
    cookieCutterTrayButton?.removeEventListener('click', showCutters);
    draftingToolsButton?.removeEventListener('click', showDrafting);
    draftingModeToggle?.removeEventListener('change', tableModeChanged);
    tableControlListeners.forEach(([control, listener]) => control.removeEventListener('click', listener));
    tablePanel.dispose();
    fieldPreview.dispose();
    draftingSpacing?.removeEventListener('change', updateDraftStatus);
    draftingAngle?.removeEventListener('change', updateDraftStatus);
    draftingSaveButton?.removeEventListener('click', saveWorkspace);
    draftingRestoreButton?.removeEventListener('click', restoreWorkspace);
    draftingDeleteButton?.removeEventListener('click', deleteWorkspace);
    draftingCameraButton?.removeEventListener('click', capturePhoto);
    draftingPhotoRestoreButton?.removeEventListener('click', restorePhoto);
    draftingPhotoDownloadButton?.removeEventListener('click', downloadPhoto);
    preview?.dispose();
    laserBeam?.dispose();
    guides.forEach(disposeGuide);
    tools.forEach(tool => tool.root.dispose());
    memoryWire.dispose();
    trayRoot.dispose();
    stencilRoot.dispose();
    cutterRoot.dispose();
    draftingRoot.dispose();
    metal.dispose(); felt.dispose(); trayBackground.dispose(); wood.dispose(); graphite.dispose(); plastic.dispose();
    pencilMaterial.dispose(); eraserMaterial.dispose();
    yarnMaterial.dispose(); selectedYarnMaterial.dispose(); divisionMarkMaterial.dispose();
    laserMaterial.dispose();
    drawing = null;
  });
  function guidesBusy() {
    return pointerStroke !== null || takingPhoto || tools.some(tool => tool.stroke !== null);
  }
  return { action, pointer, updateTableStatus, tableMode: () => tableMode,
    pointerActive: () => pointerStroke !== null, active: () => selected !== null || tableMode,
    selectNear, snapToSelected, snapToNearby,
    clearGuides: () => {
      const count = guides.length;
      guides.splice(0).forEach(disposeGuide);
      updateTableStatus();
      return count;
    },
    selectedPoints: () => selectedGuide?.points ?? null,
    exportWorkspace: () => serializeDraftingWorkspace(collectWorkspace()),
    importWorkspace: (json: string) => applyWorkspace(parseDraftingWorkspace(json)),
    // Replaces the guides on the field (keeping settings) and returns the removed ones,
    // or null while a guide is being drawn.
    guidesBusy,
    swapGuides: (next: readonly WorkspaceGuide[]): WorkspaceGuide[] | null => {
      if (guidesBusy()) return null;
      const removed = guides.splice(0);
      removed.forEach(disposeGuide);
      for (const saved of next) {
        const guide: Guide = { points: saved.points, options: saved.options,
          meshes: createGuideMeshes(saved.points, saved.options) };
        guides.push(guide);
      }
      updateDraftStatus();
      return removed.map(guide => ({ points: guide.points, options: guide.options }));
    } };
}
