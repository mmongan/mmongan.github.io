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
import { buildToolGuide, guideTouchesSweep, isGuideOnField, type FieldDrawingTool } from './fieldDrawingGeometry';
import { drawingToolsButton, stencilTrayButton, cookieCutterTrayButton, floorCalibrationToggle } from '../ui/dom';
import { createMemoryWire } from './memoryWire';

interface DrawingDependencies {
  root: TransformNode;
  notify(message: string): void;
  prepare(): void;
  createFormation(points: Vector3[]): boolean;
  createPath(points: Vector3[]): boolean;
}
interface Guide { points: Vector3[]; mesh: LinesMesh }
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

function createFieldDrawingTools(deps: DrawingDependencies) {
  const guides: Guide[] = [];
  const tools: Tool[] = [];
  let selected: FieldDrawingTool | null = null;
  let pointerStroke: Vector3[] | null = null;
  let pointerAnchor: Vector3 | null = null;
  let pointerCamera: Camera | null = null;
  let preview: LinesMesh | null = null;
  let previewPoints: Vector3[] = [];
  let span = 1;
  const trayRoot = new TransformNode('drawingToolTray', scene);
  const stencilRoot = new TransformNode('fieldStencilTray', scene);
  const cutterRoot = new TransformNode('fieldCookieCutterTray', scene);
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
    (parent === trayRoot ? meshes : parent === stencilRoot ? stencilMeshes : cutterMeshes).add(mesh);
    (parent === trayRoot ? buttons : parent === stencilRoot ? stencilButtons : cutterButtons).set(mesh, hit);
    registerMenuButton(mesh, hit);
    mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
  }
  function buildTray(parent: TransformNode, targets: Set<AbstractMesh>, name: string) {
    const backing = MeshBuilder.CreateBox(name, { width: 0.95, height: 0.78, depth: 0.025 }, scene);
    backing.parent = parent; backing.material = felt; targets.add(backing);
    for (const side of [-1, 1]) {
      const rim = MeshBuilder.CreateBox(`${name}Side`, { width: 0.02, height: 0.8, depth: 0.06 }, scene);
      rim.parent = parent; rim.position.set(side * 0.475, 0, -0.015);
      rim.material = metal; targets.add(rim);
      const edge = MeshBuilder.CreateBox(`${name}Edge`, { width: 0.95, height: 0.02, depth: 0.06 }, scene);
      edge.parent = parent; edge.position.set(0, side * 0.39, -0.015);
      edge.material = metal; targets.add(edge);
    }
  }
  buildTray(trayRoot, meshes, 'drawingToolTrayBacking');
  button('Straighten wire', 0, 0.5, 0.3, 'wireReset');
  button('Span -', -0.235, -0.005, 0.22, 'smaller');
  button('Span +', 0, -0.005, 0.22, 'larger');
  button('Put away', 0.235, -0.005, 0.22, 'stop');
  button('Create formation', -0.18, -0.085, 0.34, 'formation');
  button('Create path', 0.18, -0.085, 0.34, 'path');
  button('Undo guide', -0.235, -0.165, 0.22, 'undo');
  button('Clear guides', 0, -0.165, 0.22, 'clear');
  button('Hide tray', 0.235, -0.165, 0.22, 'hide');
  const tray = new FloatingPanel(trayRoot, meshes, trayRoot, new Vector3(0.48, 0.4, 0.01), buttons);
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
  button('Undo guide', -0.235, -0.165, 0.22, 'undo', stencilRoot);
  button('Clear guides', 0, -0.165, 0.22, 'clear', stencilRoot);
  button('Hide trays', 0.235, -0.165, 0.22, 'hide', stencilRoot);
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
  function display(points: Vector3[]) {
    if (points.length === previewPoints.length &&
      points.every((point, index) => point.equalsWithEpsilon(previewPoints[index], 0.0001))) return;
    preview?.dispose(); preview = null;
    if (points.length >= 2) preview = guideMesh(points, 'drawingGuidePreview');
    previewPoints = points.map(point => point.clone());
  }
  function commit(points: Vector3[]) {
    display([]);
    if (points.length < 2 || Vector3.Distance(points[0], points[points.length - 1]) < 0.05 && points.length < 4) return;
    if (!isGuideOnField(points)) {
      deps.notify('Guide rejected: keep the entire line, arc, or circle inside the field.');
      return;
    }
    if (guides.length >= 100) {
      deps.notify('Guide limit reached (100). Erase or clear guides before drawing more.');
      return;
    }
    guides.push({ points: points.map(p => p.clone()), mesh: guideMesh(points, 'drawingGuide') });
    deps.notify(`Guide ready (${guides.length}). Create formation or Create path uses the newest guide.`);
  }
  function erase(from: Vector3, to: Vector3, radius: number) {
    for (let index = guides.length - 1; index >= 0; index--) {
      if (guideTouchesSweep(guides[index].points, from, to, radius)) {
        guides[index].mesh.dispose(); guides.splice(index, 1);
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
    if (kind === 'pencil') {
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
        if (floorCalibrationToggle?.checked) {
          deps.notify('Finish floor calibration before using drawing tools.');
          return;
        }
        deps.prepare();
        selected = kind;
        span = root.scaling.x;
        super.begin(source, world);
        deps.notify(`${kind}: touch the working edge to the field, then lift. Desktop: drag on the field after picking up the tool.`);
      }
    }
    const panel = new PhysicalDrawingTool(root, parts, root, new Vector3(0.14, 0.15, 0.14));
    const dockPosition = new Vector3((index % 3 - 1) * 0.3, 0.23 - Math.floor(index / 3) * 0.2, -0.12);
    const dockRotation = Quaternion.FromEulerAngles(
      kind === 'pencil' || kind === 'eraser' || kind === 'compass' ? 0 : -Math.PI / 2, 0, 0);
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
    const label = kind.replace(/Stencil$/, ' stencil').replace(/Cutter$/, ' cutter');
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
  (['pencil', 'eraser', 'ruler', 'protractor', 'compass'] as const).forEach((kind, index) =>
    makeTool(kind, trayRoot, index));
  stencils.forEach(([, kind], index) => makeTool(kind, stencilRoot, index));
  cutters.forEach(([, kind], index) => makeTool(kind, cutterRoot, index));
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
    if (kind.endsWith('Cutter')) {
      display([]);
      if (!isGuideOnField(points)) {
        deps.notify('Cutter rejected: keep the whole shape inside the field.');
      } else if (deps.createFormation(points.map(p => p.clone()))) {
        deps.notify('Cookie cutter stamped a standing formation.');
      }
    } else commit(points);
  }
  function action(value: FieldDrawingTool | 'show' | 'stencils' | 'cutters' | 'hide' | 'smaller' | 'larger' | 'stop' |
    'formation' | 'path' | 'undo' | 'clear' | 'wireReset') {
    if (value === 'show') { show(); return; }
    if (value === 'stencils') { showStencils(); return; }
    if (value === 'cutters') { showCutters(); return; }
    if (value === 'hide') {
      tray.release(); trayRoot.setEnabled(false);
      stencilTray.release(); stencilRoot.setEnabled(false);
      cutterTray.release(); cutterRoot.setEnabled(false);
      return;
    }
    if (floorCalibrationToggle?.checked) { deps.notify('Finish floor calibration before using drawing tools.'); return; }
    if (value === 'wireReset') {
      memoryWire.reset();
      deps.notify('Memory wire straightened.');
      return;
    }
    if (value === 'undo' || value === 'clear') {
      const count = value === 'undo' ? Math.min(1, guides.length) : guides.length;
      guides.splice(guides.length - count, count).forEach(guide => guide.mesh.dispose());
      deps.notify(value === 'undo' ? 'Newest guide removed.' : 'Drawing guides cleared.');
      return;
    }
    if (value === 'formation' || value === 'path') {
      const guide = guides[guides.length - 1];
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
    deps.notify(value.endsWith('Cutter')
      ? `${value}: press onto the field and lift to stamp a formation. Desktop: drag center to radius. Span +/- changes size.`
      : `${value}: grab the tool and touch its tip/edge to the field; lift to finish. Desktop: drag on the field. Span +/- changes size.`);
  }
  function pointer(type: 'down' | 'move' | 'up', point: Vector3 | null) {
    if (!selected || floorCalibrationToggle?.checked) return false;
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
        ? memoryWire.shapeAt(pointerAnchor, point) : buildToolGuide(selected, pointerAnchor, point);
      if (selected !== 'eraser') display(pointerStroke);
    }
    if (type === 'up') {
      if (pointerStroke && selected !== 'eraser') finishStroke(selected, pointerStroke);
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
  };
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('blur', cancelPointer);
  const observer = scene.onBeforeRenderObservable.add(() => {
    for (const tool of tools) {
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
        tool.stroke = buildToolGuide(tool.kind, tip, edge);
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
    preview?.dispose();
    guides.forEach(guide => guide.mesh.dispose());
    tools.forEach(tool => tool.root.dispose());
    memoryWire.dispose();
    trayRoot.dispose();
    stencilRoot.dispose();
    cutterRoot.dispose();
    metal.dispose(); felt.dispose(); wood.dispose(); graphite.dispose(); plastic.dispose();
    pencilMaterial.dispose(); eraserMaterial.dispose();
    drawing = null;
  });
  return { action, pointer, pointerActive: () => pointerStroke !== null, active: () => selected !== null };
}
