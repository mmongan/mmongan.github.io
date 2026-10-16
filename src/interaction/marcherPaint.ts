import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { scene } from '../scene/engine';
import { setRobotColor } from '../robot/robot';
import { FloatingPanel } from '../menu/floatingPanel';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import { drawPanelButton } from '../menu/panelStyle';
import { floorCalibrationToggle, marcherPaletteButton, marcherPaintToggle,
  marcherPaintColor, marcherPaintSelectedButton, marcherPaintStatus } from '../ui/dom';

export const MARCHER_PAINT_SWATCHES = ['#e53935', '#fb8c00', '#fdd835', '#43a047',
  '#00acc1', '#1e88e5', '#8e24aa', '#d81b60', '#ffffff', '#202534'];

export function buildPaintPaletteGeometry() {
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [];
  const sides = 96, holeX = -0.23, holeY = -0.045;
  const rings = [
    { inner: true, inset: 0.003, z: -0.01 }, { inner: false, inset: -0.004, z: -0.01 },
    { inner: false, inset: 0, z: -0.006 }, { inner: false, inset: 0, z: 0.006 },
    { inner: false, inset: -0.004, z: 0.01 }, { inner: true, inset: 0.003, z: 0.01 },
    { inner: true, inset: 0, z: 0.006 }, { inner: true, inset: 0, z: -0.006 },
  ];
  for (const ring of rings) {
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
      const dx = holeX - 0.02, dy = holeY - 0.015;
      const a = cos * cos / 0.34 ** 2 + sin * sin / 0.24 ** 2;
      const b = 2 * (dx * cos / 0.34 ** 2 + dy * sin / 0.24 ** 2);
      const c = dx * dx / 0.34 ** 2 + dy * dy / 0.24 ** 2 - 1;
      const notchAngle = Math.atan2(Math.sin(angle - 3.7), Math.cos(angle - 3.7));
      const outer = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a) *
        (1 - 0.36 * Math.exp(-notchAngle * notchAngle / 0.13));
      const radius = ring.inner ? 1 / Math.hypot(cos / 0.026, sin / 0.038) : outer;
      const x = holeX + (radius + ring.inset) * cos, y = holeY + (radius + ring.inset) * sin;
      positions.push(x, y, ring.z);
      uvs.push((x + 0.36) / 0.72, (y + 0.26) / 0.52);
    }
  }
  for (let ring = 0; ring < rings.length; ring++) {
    for (let side = 0; side < sides; side++) {
      const a = ring * sides + side, b = ring * sides + (side + 1) % sides;
      const c = (ring + 1) % rings.length * sides + side;
      const d = (ring + 1) % rings.length * sides + (side + 1) % sides;
      indices.push(a, b, c, b, d, c);
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  return { positions, indices, normals, uvs };
}

export function buildPaintBlobGeometry(seed: number) {
  const positions = [0, 0, -0.03], indices: number[] = [];
  const sides = 24, rings = 6;
  for (let ring = 1; ring <= rings; ring++) {
    const radius = ring / rings;
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const edge = 1 + 0.12 * Math.sin(angle * 3 + seed) + 0.07 * Math.cos(angle * 5 - seed * 1.7);
      const ridge = 0.004 * Math.sin(angle * 2 + radius * 12 + seed) * Math.sin(Math.PI * radius);
      positions.push(Math.cos(angle) * 0.028 * radius * edge,
        Math.sin(angle) * 0.024 * radius * edge,
        -(0.003 + 0.027 * (1 - radius) ** 1.15 + ridge));
      const current = 1 + (ring - 1) * sides + side;
      const next = 1 + (ring - 1) * sides + (side + 1) % sides;
      if (ring === 1) indices.push(0, next, current);
      else indices.push(current - sides, next - sides, current, next - sides, next, current);
    }
  }
  const bottom = positions.length / 3;
  positions.push(0, 0, 0);
  for (let side = 0; side < sides; side++) {
    indices.push(bottom, 1 + (rings - 1) * sides + side, 1 + (rings - 1) * sides + (side + 1) % sides);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  return { positions, indices, normals };
}

interface PaintDependencies {
  getSelected(): TransformNode | null;
  prepare(): void;
  changed(robot: TransformNode): void;
  notify(message: string): void;
}
let paint: ReturnType<typeof createMarcherPaint> | null = null;
export function initMarcherPaint(deps: PaintDependencies) { paint ??= createMarcherPaint(deps); }
export function isMarcherPainting() { return paint?.active() ?? false; }
export function stopMarcherPainting() { paint?.stop(); }
export function tryPaintMarcher(robot: TransformNode | null) { return paint?.apply(robot) ?? false; }
export function executeMarcherPaintAction(hit: Extract<HandMenuHit, { action: 'marcherPaint' | 'marcherPaintColor' }>) {
  paint?.action(hit);
}

function createMarcherPaint(deps: PaintDependencies) {
  let active = false;
  let color = '#1e88e5';
  const root = new TransformNode('marcherPaintPalette', scene);
  const backing = new Mesh('marcherPaintPaletteBacking', scene);
  const paletteData = new VertexData(), paletteGeometry = buildPaintPaletteGeometry();
  paletteData.positions = paletteGeometry.positions; paletteData.indices = paletteGeometry.indices;
  paletteData.normals = paletteGeometry.normals; paletteData.uvs = paletteGeometry.uvs;
  paletteData.applyToMesh(backing);
  backing.parent = root;
  const grainCanvas = document.createElement('canvas'); grainCanvas.width = 1024; grainCanvas.height = 768;
  const grain = grainCanvas.getContext('2d');
  if (!grain) throw new Error('Paint palette requires a 2D canvas context.');
  grain.fillStyle = '#c49159'; grain.fillRect(0, 0, 1024, 768);
  for (let row = -16; row < 800; row += 3.5) {
    grain.strokeStyle = Math.floor(row) % 3 === 0 ? '#986236' : '#b27b45';
    grain.lineWidth = 0.8 + 0.5 * Math.sin(row * 0.17);
    grain.beginPath();
    for (let x = -16; x <= 1040; x += 16) {
      const knot = 28 * Math.exp(-(((x - 280) / 100) ** 2)) * Math.sin((row - 340) * 0.022) *
        Math.exp(-(((row - 340) / 140) ** 2));
      const y = row + Math.sin(x * 0.011 + row * 0.016) * 3 + knot;
      if (x === -16) grain.moveTo(x, y); else grain.lineTo(x, y);
    }
    grain.stroke();
  }
  const grainTexture = new DynamicTexture('marcherPaintPaletteGrain', grainCanvas, scene, true);
  grainTexture.update();
  const wood = new StandardMaterial('marcherPaintPaletteWood', scene);
  wood.diffuseTexture = grainTexture;
  wood.diffuseColor = new Color3(0.88, 0.88, 0.88);
  wood.specularColor = new Color3(0.18, 0.18, 0.18); wood.specularPower = 96;
  backing.material = wood;
  const meshes = new Set<AbstractMesh>([backing]);
  const buttons = new Map<AbstractMesh, HandMenuHit>();
  const swatches: { mesh: AbstractMesh; color: string }[] = [];
  function status(message: string) {
    if (marcherPaintStatus) marcherPaintStatus.textContent = message;
    deps.notify(message);
  }
  function update() {
    if (marcherPaintToggle) marcherPaintToggle.checked = active;
    if (marcherPaintColor) marcherPaintColor.value = color;
    swatches.forEach(swatch => {
      swatch.mesh.scaling.setAll(swatch.color === color ? 1.2 : 1);
    });
  }
  function stop() {
    const wasActive = active;
    active = false; update();
    if (wasActive) status('Uniform painting off. Selection and movement restored.');
  }
  function start() {
    if (floorCalibrationToggle?.checked) {
      stop(); status('Finish floor calibration before painting uniforms.'); return false;
    }
    deps.prepare();
    active = true; update();
    status(`Uniform paint ${color}: click, trigger, or pinch a marcher. Done paint exits this mode.`);
    return true;
  }
  function apply(robot: TransformNode | null) {
    if (!active) return false;
    if (floorCalibrationToggle?.checked) {
      status('Finish floor calibration before painting uniforms.'); return true;
    }
    if (!robot || robot.isDisposed() || !robot.isEnabled()) {
      status('Choose a visible marcher to paint.'); return true;
    }
    setRobotColor(robot, Color3.FromHexString(color));
    deps.changed(robot);
    status(`Marcher uniform painted ${color}. Instruments and guard equipment are unchanged.`);
    return true;
  }
  function button(label: string, x: number, y: number, command: 'done' | 'paintSelected') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Paint palette requires a 2D canvas context.');
    drawPanelButton(ctx, 512, 128, label);
    const texture = new DynamicTexture('marcherPaintButtonTexture', canvas, scene, false); texture.update();
    const material = new StandardMaterial('marcherPaintButtonMaterial', scene);
    material.diffuseTexture = texture; material.emissiveColor = Color3.White(); material.disableLighting = true;
    const mesh = MeshBuilder.CreatePlane('marcherPaintButton', { width: command === 'done' ? 0.17 : 0.2, height: 0.05 }, scene);
    mesh.parent = root; mesh.position.set(x, y, -0.016); mesh.material = material;
    const hit: HandMenuHit = { action: 'marcherPaint', command };
    registerMenuButton(mesh, hit); buttons.set(mesh, hit); meshes.add(mesh);
    mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
  }
  MARCHER_PAINT_SWATCHES.forEach((hex, index) => {
    const mesh = new Mesh('marcherPaintSwatch', scene);
    const data = new VertexData(), geometry = buildPaintBlobGeometry(index);
    data.positions = geometry.positions; data.indices = geometry.indices; data.normals = geometry.normals;
    data.applyToMesh(mesh);
    mesh.parent = root; mesh.position.set((index % 5 - 2) * 0.085 + 0.02,
      0.1 - Math.floor(index / 5) * 0.09, -0.011);
    const material = new StandardMaterial('marcherPaintSwatchMaterial', scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.emissiveColor = material.diffuseColor.scale(0.08);
    material.specularColor = new Color3(0.65, 0.65, 0.65);
    material.specularPower = 64;
    mesh.material = material;
    mesh.onDisposeObservable.addOnce(() => material.dispose());
    const hit: HandMenuHit = { action: 'marcherPaintColor', color: hex };
    registerMenuButton(mesh, hit); buttons.set(mesh, hit); meshes.add(mesh);
    swatches.push({ mesh, color: hex });
  });
  button('Paint selected', -0.04, -0.125, 'paintSelected');
  button('Done paint', 0.15, -0.125, 'done');
  const panel = new FloatingPanel(root, meshes, root, new Vector3(0.36, 0.255, 0.05), buttons);
  root.setEnabled(false);
  function show() {
    root.setEnabled(true);
    panel.placeForViewer({ desktop: { distance: 0.85, height: -0.1 }, xr: { distance: 0.45, height: -0.1 }, side: -0.25 });
  }
  function action(hit: Extract<HandMenuHit, { action: 'marcherPaint' | 'marcherPaintColor' }>) {
    if (hit.action === 'marcherPaintColor') {
      if (!/^#[0-9a-f]{6}$/i.test(hit.color)) throw new Error('Choose a six-digit hex uniform color.');
      color = hit.color; start(); return;
    }
    if (hit.command === 'show') { show(); return; }
    if (hit.command === 'done') { stop(); panel.release(); root.setEnabled(false); return; }
    if (start()) apply(deps.getSelected());
  }
  const toggle = () => { if (marcherPaintToggle?.checked) start(); else stop(); };
  const choose = () => {
    if (marcherPaintColor) action({ action: 'marcherPaintColor', color: marcherPaintColor.value });
  };
  const selected = () => action({ action: 'marcherPaint', command: 'paintSelected' });
  marcherPaletteButton?.addEventListener('click', show);
  marcherPaintToggle?.addEventListener('change', toggle);
  marcherPaintColor?.addEventListener('change', choose);
  marcherPaintSelectedButton?.addEventListener('click', selected);
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (active && floorCalibrationToggle?.checked) stop();
  });
  scene.onDisposeObservable.addOnce(() => {
    scene.onBeforeRenderObservable.remove(observer);
    marcherPaletteButton?.removeEventListener('click', show);
    marcherPaintToggle?.removeEventListener('change', toggle);
    marcherPaintColor?.removeEventListener('change', choose);
    marcherPaintSelectedButton?.removeEventListener('click', selected);
    root.dispose(); wood.dispose(false, true); paint = null;
  });
  update();
  return { active: () => active, stop, apply, action };
}
