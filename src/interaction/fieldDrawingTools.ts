import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh.pure';
import type { Camera } from '@babylonjs/core/Cameras/camera.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { DetachableFloatingPanel, FloatingPanel } from '../menu/floatingPanel';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import { drawPanelButton } from '../menu/panelStyle';
import { FIELD_SURFACE_Y } from '../field/constants';
import { buildLaserGuide, buildToolGuide, guideTouchesSweep, isGuideOnField, type FieldDrawingTool } from './fieldDrawingGeometry';
import { drawingToolsButton, stencilTrayButton, cookieCutterTrayButton, floorCalibrationToggle,
  draftingToolsButton, draftingSpacing, draftingAngle, draftingText } from '../ui/dom';
import { draftingSaveButton, draftingRestoreButton, draftingDeleteButton, draftingSaveStatus,
  fieldGridToggle, fieldGridInterval, draftingCameraButton, draftingPhotoRestoreButton,
  draftingPhotoDownloadButton, draftingPhotoPreview } from '../ui/dom';
import { createMemoryWire } from './memoryWire';
import { constrainedDraftLine, divideDraftLine, measureDraftLine, offsetDraftLine, sampleDraftSpline } from './draftingGeometry';
import { createDraftingHandles } from './draftingHandles';
import { DRAFTING_WORKSPACE_KEY, parseDraftingWorkspace, serializeDraftingWorkspace,
  type DraftingWorkspace } from './draftingWorkspace';
import { captureDraftingPhoto, DRAFTING_CAMERA_KEY, parseDraftingPhoto, type DraftingPhoto } from './draftingCamera';

interface DrawingDependencies {
  root: TransformNode;
  notify(message: string): void;
  prepare(): void;
  createFormation(points: Vector3[]): boolean;
  createPath(points: Vector3[]): boolean;
  createSynchronizedRoutes(points: Vector3[]): boolean;
}
interface GuideOptions {
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
  handles?: ReturnType<typeof createDraftingHandles>;
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
}

let drawing: ReturnType<typeof createFieldDrawingTools> | null = null;

export function initFieldDrawingTools(deps: DrawingDependencies) {
  drawing ??= createFieldDrawingTools(deps);
}
export function executeDrawingToolAction(action: Extract<HandMenuHit, { action: 'drawingTool' }>) {
  drawing?.action(action.tool);
}
export function handleDrawingPointer(type: 'down' | 'move' | 'up', point: Vector3 | null) {
  return drawing?.pointer(type, point) ?? false;
}
export function isDrawingPointerActive() { return drawing?.pointerActive() ?? false; }
export function isFieldDrawingToolActive() { return drawing?.active() ?? false; }
/** Toggles selection of the guide nearest a root-local point. `vertical` also requires the point near the yarn height. */
export function selectDrawingGuideNear(point: Vector3, radius: number, vertical = false) {
  return drawing?.selectNear(point, radius, vertical) ?? false;
}
/** Nearest root-local point on the selected guide (keeping the input height), or null with no selection. */
export function snapToSelectedDrawingGuide(point: Vector3): Vector3 | null {
  return drawing?.snapToSelected(point) ?? null;
}
/** Removes every drafted guide (e.g. for a new blank chart page); returns how many were removed. */
export function clearDrawingGuides() {
  return drawing?.clearGuides() ?? 0;
}
/** Root-local points of the selected guide, or null with no selection. */
export function getSelectedDrawingGuidePoints(): readonly Vector3[] | null {
  return drawing?.selectedPoints() ?? null;
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
  let selected: FieldDrawingTool | null = null;
  let pointerStroke: Vector3[] | null = null;
  let pointerAnchor: Vector3 | null = null;
  let pointerCamera: Camera | null = null;
  let preview: LinesMesh | null = null;
  let previewPoints: Vector3[] = [];
  let laserBeam: ReturnType<typeof MeshBuilder.CreateTube> | null = null;
  let laserPoints: Vector3[] = [];
  let desktopLaserAim = false;
  let span = 1;
  let offsetSide = 1;
  let parallelReference = false;
  let restoreArmedUntil = 0;
  let restoringPhoto = false;
  let takingPhoto = false;
  const yarnRadius = 0.012;
  const tackSpacing = 3.5;
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
  const tackHeadMaterial = new StandardMaterial('drawingGuideTackHeadMaterial', scene);
  tackHeadMaterial.diffuseColor = new Color3(0.92, 0.12, 0.14);
  tackHeadMaterial.specularColor = new Color3(0.45, 0.35, 0.35);
  const selectedYarnMaterial = new StandardMaterial('drawingGuideSelectedYarnMaterial', scene);
  selectedYarnMaterial.diffuseColor = new Color3(1, 0.82, 0.1);
  selectedYarnMaterial.emissiveColor = new Color3(0.75, 0.55, 0.05);
  selectedYarnMaterial.specularColor = Color3.Black();
  const tackPinMaterial = new StandardMaterial('drawingGuideTackPinMaterial', scene);
  tackPinMaterial.diffuseColor = new Color3(0.68, 0.72, 0.78);
  tackPinMaterial.specularColor = new Color3(0.75, 0.75, 0.75);
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
    backing.parent = parent; backing.material = felt; targets.add(backing);
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
  button('Pin laser line', 0.2, 0.5, 0.3, 'laserPin');
  button('Advanced tools', 0.55, 0.1, 0.25, 'drafting');
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
    trayRoot.setEnabled(true);
    tray.placeForViewer({ desktop: { distance: 1.6, height: 0, side: 0 },
      xr: { distance: 0.7, height: -0.12 }, side: 0, uprightInXR: true });
  }
  drawingToolsButton?.addEventListener('click', show);
  function showStencils() {
    stencilRoot.setEnabled(true);
    stencilTray.placeForViewer({ desktop: { distance: 1.6, height: 0, side: 0 },
      xr: { distance: 0.7, height: -0.12 }, side: 0.35, uprightInXR: true });
  }
  stencilTrayButton?.addEventListener('click', showStencils);
  function showCutters() {
    cutterRoot.setEnabled(true);
    cutterTray.placeForViewer({ desktop: { distance: 1.6, height: 0, side: 0 },
      xr: { distance: 0.7, height: -0.12 }, side: -0.35, uprightInXR: true });
  }
  cookieCutterTrayButton?.addEventListener('click', showCutters);
  buildTray(draftingRoot, draftingMeshes, 'advancedDraftingTrayBacking', 1.4, 1.6);
  const draftCommands = [
    ['Spacing -', 'draftSpacingLess'], ['Spacing +', 'draftSpacingMore'], ['Angle', 'draftAngle'],
    ['Offset side', 'draftSide'], ['Parallel ref', 'draftReference'], ['Add tack', 'addTack'],
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
  function showDrafting() {
    draftingRoot.setEnabled(true);
    draftingTray.placeForViewer({ desktop: { distance: 1.8, height: 0, side: 0 },
      xr: { distance: 0.85, height: -0.1 }, side: 0, uprightInXR: true });
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
  }
  draftingSpacing?.addEventListener('change', updateDraftStatus);
  draftingAngle?.addEventListener('change', updateDraftStatus);
  updateDraftStatus();

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
  function tackPositions(points: Vector3[]) {
    const positions = [points[0].clone()];
    let distanceToNextTack = tackSpacing;
    let distanceAlongLine = 0;
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1];
      const end = points[index];
      const segmentLength = Vector3.Distance(start, end);
      if (segmentLength <= 1e-6) continue;
      while (distanceToNextTack < distanceAlongLine + segmentLength) {
        positions.push(Vector3.Lerp(start, end,
          (distanceToNextTack - distanceAlongLine) / segmentLength));
        distanceToNextTack += tackSpacing;
      }
      if (index < points.length - 1) {
        const incoming = end.subtract(start).normalize();
        const outgoing = points[index + 1].subtract(end).normalize();
        if (Vector3.Dot(incoming, outgoing) < Math.cos(Math.PI / 5)) positions.push(end.clone());
      }
      distanceAlongLine += segmentLength;
    }
    const last = points[points.length - 1];
    if (Vector3.Distance(positions[0], last) > 0.08) positions.push(last.clone());
    return positions.filter((position, index) =>
      positions.findIndex(candidate => Vector3.Distance(candidate, position) < 0.08) === index);
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
    const tacks: AbstractMesh[] = [];
    const anchors = options.editable ? [] : options.divisions ?? tackPositions(points);
    anchors.forEach((point, index) => {
      const pin = MeshBuilder.CreateCylinder(`drawingGuideTackPin-${index}`, {
        height: 0.08, diameterTop: 0.002, diameterBottom: 0.012, tessellation: 8,
      }, scene);
      pin.parent = deps.root;
      pin.position.set(point.x, FIELD_SURFACE_Y - 0.025, point.z);
      pin.material = tackPinMaterial;
      pin.isPickable = false;
      tacks.push(pin);
      const head = MeshBuilder.CreateSphere(`drawingGuideTackHead-${index}`, {
        diameter: 0.08, segments: 8,
      }, scene);
      head.parent = deps.root;
      head.position.set(point.x, FIELD_SURFACE_Y + 0.035, point.z);
      head.scaling.y = 0.45;
      head.material = tackHeadMaterial;
      head.isPickable = false;
      tacks.push(head);
    });
    const result: AbstractMesh[] = [yarn, ...tacks];
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
        { width: options.sticky ? 2.4 : 3.2, height: options.sticky ? 1.2 : 0.4 }, scene);
      plaque.parent = deps.root; plaque.position.copyFrom(points[Math.floor(points.length / 2)]);
      plaque.position.y += 0.08; plaque.rotation.x = Math.PI / 2;
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
  }
  function setSelectedGuide(guide: Guide | null) {
    const previous = selectedGuide;
    selectedGuide = guide;
    if (previous) highlightGuide(previous);
    if (guide) highlightGuide(guide);
  }
  function selectNear(point: Vector3, radius: number, vertical: boolean) {
    if (floorCalibrationToggle?.checked || takingPhoto) return false;
    let nearest: Guide | null = null;
    let nearestDistance = radius;
    for (const guide of guides) {
      if (guide.options.sticky) continue;
      const hit = closestPointOnGuide(guide.points, point);
      if (!hit) continue;
      const distance = vertical
        ? Math.hypot(hit.distance, point.y - (FIELD_SURFACE_Y + yarnRadius + 0.002)) : hit.distance;
      if (distance <= nearestDistance) { nearest = guide; nearestDistance = distance; }
    }
    if (!nearest) return false;
    const deselect = nearest === selectedGuide;
    setSelectedGuide(deselect ? null : nearest);
    deps.notify(deselect ? 'Guide deselected. Released marchers place freely.'
      : 'Guide selected. Released marchers snap onto it; drafting actions use it.');
    return true;
  }
  function snapToSelected(point: Vector3) {
    return selectedGuide ? closestPointOnGuide(selectedGuide.points, point)?.point ?? null : null;
  }
  function disposeGuide(guide: Guide) {
    if (guide === selectedGuide) selectedGuide = null;
    guide.handles?.dispose();
    guide.meshes.forEach(mesh => mesh.dispose());
  }
  function attachGuideHandles(guide: Guide) {
    guide.handles?.dispose();
    const controls = guide.options.controls;
    if (!controls || !guide.options.editable) return;
    guide.handles = createDraftingHandles({
      field: deps.root, points: controls, material: tackHeadMaterial,
      translate: guide.options.sticky,
      allowed: () => !floorCalibrationToggle?.checked && !takingPhoto,
      prepare: deps.prepare, notify: deps.notify,
      changed: next => {
        restoreArmedUntil = 0;
        const points = guide.options.editable === 'spline' ? sampleDraftSpline(next) : next.map(p => p.clone());
        if (!isGuideOnField(points) || measureDraftLine(points).yards < 0.05 ||
          next.some((p, i) => i > 0 && Vector3.Distance(p, next[i - 1]) < 0.05)) return false;
        guide.points = points;
        guide.meshes.forEach(mesh => mesh.dispose());
        guide.meshes = createGuideMeshes(points, guide.options);
        highlightGuide(guide);
        return true;
      },
    });
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
    const committedPoints = points.map(point => point.clone());
    const guide: Guide = { points: committedPoints, meshes: createGuideMeshes(committedPoints, options), options };
    guides.push(guide);
    attachGuideHandles(guide);
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
    if (kind === 'tape' || kind === 'yarn' || kind === 'annotation' || kind === 'dividers') {
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
      tSquare: 'T-square: drag or touch its edge to draw field-axis lines. Parallel ref switches to the newest guide direction.',
      setSquare: `Set square: drag or touch its edge to draw at multiples of ${getDraftAngle()} degrees. Angle cycles 30/45/60/90.`,
      dividers: 'Dividers: drag or touch/lift to mark equal intervals along the newest guide (or the drawn segment). Spacing +/- sets yards.',
      tape: 'Tape: drag two field points or touch/lift its edge to save a yards, 8-to-5 steps, and angle label. Drag its endpoint pins to remeasure.',
      spline: 'French curve: drag endpoints or touch/lift to create a smooth curve. Drag its three red pins to adjust endpoints and bend.',
      offset: 'Offset: drag or touch/lift to copy the newest guide at the configured spacing. Offset side swaps left/right. Draw a source guide first.',
      annotation: 'Annotation: drag a leader or touch/lift to place your Settings note text on the field.',
      stickyNote: 'Sticky note: click or touch/lift on the field to place the text from Settings. Drag its red pins to move it. Save locally preserves notes.',
      camera: 'Camera: use Take photo on the advanced tray or Camera in Settings to capture the field and save drafting together. Restore photo recalls drafting; Download PNG exports the image.',
      yarn: 'Yarn: drag or touch/lift to place two movable thumbtacks. Add tack inserts a pin in the longest span; drag pins to stretch the yarn.',
    };
    return instructions[kind];
  }
  function makeTool(kind: FieldDrawingTool, dock: TransformNode, index: number) {
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
      shutter.parent = root; shutter.position.set(0.05, 0.05, 0); shutter.material = tackHeadMaterial;
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
    } else if (kind === 'yarn') {
      tip.set(-0.12, -0.12, 0); edge.set(0.12, -0.12, 0);
      rod('draftingYarnSpool', new Vector3(0, -0.07, 0), new Vector3(0, 0.07, 0), 0.045).material = yarnMaterial;
      rod('draftingYarnLooseEnd', tip, edge, 0.004).material = yarnMaterial;
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
        span = root.scaling.x;
        super.begin(source, world);
        deps.notify(toolInstructions(kind) ?? (kind === 'laser'
          ? 'Laser: rotate the held level to project a green line across the field. Use Pin laser line on the Tools tray to save a guide. Desktop: drag on the field to aim.'
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
    const tool: Tool = { kind, root, panel, tip, edge, stroke: null, dock, dockPosition, dockRotation };
    tools.push(tool);
    return tool;
  }
  (['pencil', 'eraser', 'ruler', 'protractor', 'compass', 'laser', 'camera'] as const).forEach((kind, index) =>
    makeTool(kind, trayRoot, index));
  stencils.forEach(([, kind], index) => makeTool(kind, stencilRoot, index));
  cutters.forEach(([, kind], index) => makeTool(kind, cutterRoot, index));
  (['tSquare', 'setSquare', 'dividers', 'tape', 'spline', 'offset', 'annotation', 'yarn', 'stickyNote'] as const)
    .forEach((kind, index) => makeTool(kind, draftingRoot, index));
  const memoryWire = createMemoryWire({
    dock: trayRoot, field: deps.root, commit,
    allowed: () => !floorCalibrationToggle?.checked,
    prepare: () => {
      if (floorCalibrationToggle?.checked) {
        deps.notify('Finish floor calibration before using drawing tools.');
        return false;
      }
      deps.prepare();
      return true;
    },
    selected: () => {
      selected = 'wire';
      span = memoryWire.root.scaling.x;
      deps.notify('Memory wire: hold the copper grip to move it; pull cyan beads to bend. Press flat onto turf and lift to stamp. Desktop: drag on the field to stamp the remembered shape.');
    },
  });
  function finishTool(tool: Tool) {
    if (tool.stroke && tool.kind !== 'eraser') finishStroke(tool.kind, tool.stroke);
    tool.stroke = null;
  }
  function finishStroke(kind: FieldDrawingTool, points: Vector3[]) {
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
    } else if (kind === 'yarn' || kind === 'tape') {
      commit(points, { editable: 'yarn', controls: points.map(p => p.clone()), measure: kind === 'tape' });
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
  function action(value: FieldDrawingTool | 'show' | 'stencils' | 'cutters' | 'hide' | 'smaller' | 'larger' | 'stop' |
    'formation' | 'path' | 'synchronizedRoutes' | 'undo' | 'clear' | 'wireReset' | 'laserPin' | 'drafting' |
    'draftSpacingLess' | 'draftSpacingMore' | 'draftAngle' | 'draftSide' | 'draftReference' | 'addTack' |
    'saveDrafting' | 'restoreDrafting' | 'deleteDrafting' | 'takePhoto' | 'restorePhoto' | 'downloadPhoto') {
    if (takingPhoto) { workspaceMessage('Wait for the field snapshot to finish.'); return; }
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
      deps.notify(parallelReference ? 'T-square uses the newest guide direction.' : 'T-square aligns to field axes.');
      updateDraftStatus();
      return;
    }
    if (value === 'addTack') {
      const guide = activeGuide();
      const controls = guide?.options.controls;
      if (!guide || guide.options.editable !== 'yarn' || guide.options.sticky || !controls) {
        deps.notify('Create a yarn line or tape measurement before adding a tack.');
        return;
      }
      if (controls.length >= 64) { deps.notify('Pin limit reached (64 per editable yarn line).'); return; }
      let longest = 1;
      for (let i = 2; i < controls.length; i++) {
        if (Vector3.Distance(controls[i - 1], controls[i]) >
          Vector3.Distance(controls[longest - 1], controls[longest])) longest = i;
      }
      if (Vector3.Distance(controls[longest - 1], controls[longest]) < 0.1) {
        deps.notify('Spread the yarn pins apart before inserting another tack.');
        return;
      }
      controls.splice(longest, 0, controls[longest - 1].add(controls[longest]).scale(0.5));
      guide.points = controls.map(p => p.clone());
      attachGuideHandles(guide);
      deps.notify('Tack added at the longest span midpoint. Drag it anywhere on the field.');
      return;
    }
    if (value === 'laserPin') {
      if (laserPoints.length !== 2) {
        deps.notify('Aim the laser across the field before pinning a line.');
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
      if (value === 'formation' ? deps.createFormation(points) : deps.createPath(points)) {
        deps.notify(value === 'formation' ? 'Standing formation created from guide.' : 'Marching path created from guide.');
      }
      return;
    }
    if (value === 'smaller' || value === 'larger') {
      span = Math.max(0.5, Math.min(3, span * (value === 'larger' ? 1.25 : 0.8)));
      tools.filter(tool => tool.kind === selected).forEach(tool => { tool.stroke = null; tool.root.scaling.setAll(span); });
      if (selected === 'wire') memoryWire.root.scaling.setAll(span);
      display([]);
      deps.notify(`Tool span: ${Math.round(span * 100)}%.`);
      return;
    }
    pointerStroke = null; pointerAnchor = null; releasePointerCamera(); display([]);
    desktopLaserAim = false; displayLaser([]);
    if (value === 'stop') {
      memoryWire.returnToDock();
      tools.forEach(tool => {
        tool.stroke = null; tool.panel.release();
        tool.root.parent = tool.dock;
        tool.root.position.copyFrom(tool.dockPosition);
        tool.root.rotationQuaternion!.copyFrom(tool.dockRotation);
        tool.root.scaling.setAll(0.65);
      });
      selected = null; deps.notify('Drawing tools returned to their trays.'); return;
    }
    deps.prepare();
    selected = value;
    if (value === 'wire') {
      memoryWire.root.setParent(null);
      memoryWire.root.scaling.setAll(span);
      memoryWire.panel.placeForViewer({ desktop: { distance: 0.6, height: -0.08, side: 0.3 },
        xr: { distance: 0.35, height: -0.15 }, side: 0.25, uprightInXR: true });
      return;
    }
    const tool = tools.find(tool => tool.kind === value);
    if (!tool) throw new Error(`Unknown physical drawing tool: ${value}`);
    tool.panel.release();
    tool.root.setParent(null);
    tool.root.scaling.setAll(span);
    tool.root.setEnabled(true);
    tool.panel.placeForViewer({ desktop: { distance: 0.6, height: -0.08, side: 0.3 },
      xr: { distance: 0.35, height: -0.15 }, side: 0.25, uprightInXR: true });
    deps.notify(toolInstructions(value) ?? (value === 'laser'
      ? 'Laser: drag on the field to aim a live line, then use Pin laser line on the Tools tray. In XR, hold and rotate the level; release turns the beam off.'
      : value.endsWith('Cutter')
      ? `${value}: press onto the field and lift to stamp a formation. Desktop: drag center to radius. Span +/- changes size.`
      : `${value}: grab the tool and touch its tip/edge to the field; lift to finish. Desktop: drag on the field. Span +/- changes size.`));
  }
  function pointer(type: 'down' | 'move' | 'up', point: Vector3 | null) {
    if (!selected || selected === 'camera' || floorCalibrationToggle?.checked || takingPhoto) return false;
    restoreArmedUntil = 0;
    if (type === 'down') {
      if (!point) return false;
      pointerStroke = [point.clone()];
      pointerAnchor = point.clone();
      if (!pointerCamera) {
        pointerCamera = scene.activeCamera;
        pointerCamera?.detachControl();
      }
    } else if (!pointerStroke) return false;
    if (point && pointerStroke) {
      const previous = pointerStroke[pointerStroke.length - 1];
      if (selected === 'eraser') erase(previous, point, 0.5);
      if (selected === 'pencil' || selected === 'eraser') append(pointerStroke, point);
      else if (pointerAnchor) pointerStroke = selected === 'wire'
        ? memoryWire.shapeAt(pointerAnchor, point) : makeStroke(selected, pointerAnchor, point);
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
    if (floorCalibrationToggle?.checked || pointerStroke || guides.some(guide => guide.handles?.grabbed()) ||
      tools.some(tool => tool.kind !== 'camera' && (tool.panel.grabbed() || tool.stroke !== null)) ||
      memoryWire.panel.grabbed() || memoryWire.handles.some(handle => handle.grabbed())) {
      workspaceMessage('Finish floor calibration and release drawing tools/pins before taking a snapshot.');
      return;
    }
    takingPhoto = true; restoreArmedUntil = 0;
    workspaceMessage('Taking top-down field snapshot...');
    try {
      const photo = await captureDraftingPhoto(deps.root, collectWorkspace(),
        guides.flatMap(guide => [...guide.meshes, ...(guide.handles?.meshes ?? [])]));
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
    if (pointerStroke || tools.some(tool => tool.panel.grabbed()) || memoryWire.panel.grabbed() ||
      memoryWire.handles.some(handle => handle.grabbed()) || guides.some(guide => guide.handles?.grabbed())) {
      workspaceMessage('Release drafting tools and pins before saving or restoring.');
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
    // Build and validate the replacement before removing any current guide.
    const replacements: Guide[] = [];
    try {
      for (const saved of snapshot.guides) {
        const guide: Guide = { ...saved, meshes: createGuideMeshes(saved.points, saved.options) };
        replacements.push(guide);
        attachGuideHandles(guide);
      }
    } catch (error) {
      replacements.forEach(disposeGuide);
      workspaceMessage(`Could not build saved drafting; current guides unchanged: ${String(error)}`);
      return;
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
    workspaceMessage(`Restored ${guides.length} drafting guides. Marchers and routes are unchanged.`);
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
        } else if (!desktopLaserAim) displayLaser([]);
        continue;
      }
      if (!tool.root.isEnabled()) continue;
      if (floorCalibrationToggle?.checked) {
        tool.stroke = null; cancelPointer();
        continue;
      }
      if (!tool.panel.grabbed()) { finishTool(tool); continue; }
      const world = tool.root.computeWorldMatrix(true);
      if (tool.kind !== 'pencil' && tool.kind !== 'eraser') {
        const toolUp = Vector3.TransformNormal(Vector3.Up(), world).normalize();
        const fieldUp = Vector3.TransformNormal(Vector3.Up(), deps.root.computeWorldMatrix(true)).normalize();
        if (Vector3.Dot(toolUp, fieldUp) < 0.95) { finishTool(tool); continue; }
      }
      const tipWorld = Vector3.TransformCoordinates(tool.tip, world);
      let tip = local(tipWorld);
      const scaleY = Vector3.TransformNormal(Vector3.Up(), deps.root.getWorldMatrix()).length();
      if (Math.abs(tip.y - FIELD_SURFACE_Y) * scaleY > 0.025) { finishTool(tool); continue; }
      tip.y = FIELD_SURFACE_Y + 0.025;
      if (tool.kind === 'pencil') {
        const ruler = tools.find(candidate => candidate.kind === 'ruler' && candidate.root.parent === null);
        if (ruler?.root.isEnabled()) {
          const rulerWorld = ruler.root.computeWorldMatrix(true);
          const a = local(Vector3.TransformCoordinates(ruler.tip, rulerWorld));
          const b = local(Vector3.TransformCoordinates(ruler.edge, rulerWorld));
          const direction = b.subtract(a);
          const length = direction.lengthSquared();
          if (length > 0 && Math.abs(a.y - FIELD_SURFACE_Y) * scaleY <= 0.025 &&
            Math.abs(b.y - FIELD_SURFACE_Y) * scaleY <= 0.025) {
            const t = Math.max(0, Math.min(1, Vector3.Dot(tip.subtract(a), direction) / length));
            const projected = a.add(direction.scale(t));
            if (Vector3.Distance(projected, tip) * scaleY <= 0.035) {
              projected.y = tip.y;
              tip = projected;
            }
          }
        }
      }
      if (tool.kind === 'eraser') {
        const previous = tool.stroke?.[0] ?? tip;
        erase(previous, tip, Math.max(0.1, 0.04 * span / scaleY));
        tool.stroke = [tip];
      } else if (tool.kind === 'pencil') {
        tool.stroke ??= [tip.clone()];
        append(tool.stroke, tip);
        display(tool.stroke);
      } else {
        const edge = local(Vector3.TransformCoordinates(tool.edge, world));
        tool.stroke = makeStroke(tool.kind, tip, edge);
        display(tool.stroke);
      }
    }
  });
  scene.onDisposeObservable.addOnce(() => {
    scene.onBeforeRenderObservable.remove(observer);
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('blur', cancelPointer);
    releasePointerCamera();
    drawingToolsButton?.removeEventListener('click', show);
    stencilTrayButton?.removeEventListener('click', showStencils);
    cookieCutterTrayButton?.removeEventListener('click', showCutters);
    draftingToolsButton?.removeEventListener('click', showDrafting);
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
    metal.dispose(); felt.dispose(); wood.dispose(); graphite.dispose(); plastic.dispose();
    pencilMaterial.dispose(); eraserMaterial.dispose();
    yarnMaterial.dispose(); selectedYarnMaterial.dispose(); tackHeadMaterial.dispose(); tackPinMaterial.dispose();
    laserMaterial.dispose();
    drawing = null;
  });
  return { action, pointer, pointerActive: () => pointerStroke !== null, active: () => selected !== null,
    selectNear, snapToSelected,
    clearGuides: () => { const count = guides.length; guides.splice(0).forEach(disposeGuide); return count; },
    selectedPoints: () => selectedGuide?.points ?? null };
}
