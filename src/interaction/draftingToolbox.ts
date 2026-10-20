import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { FloatingPanel } from '../menu/floatingPanel';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import { drawPanelButton, PANEL_FRAME_COLOR } from '../menu/panelStyle';
import { isDrillEditingEnabled, onEditingModeChangedObservable } from './editingMode';

export function createDraftingToolbox(drawers: readonly { root: TransformNode; panel: FloatingPanel }[]) {
  const root = new TransformNode('draftingToolbox', scene);
  const meshes = new Set<AbstractMesh>();
  const buttons = new Map<AbstractMesh, HandMenuHit>();
  const material = new StandardMaterial('draftingToolboxMaterial', scene);
  material.diffuseColor = Color3.FromHexString(PANEL_FRAME_COLOR);
  material.alpha = 0.45;
  material.disableDepthWrite = true;
  const metal = new StandardMaterial('draftingToolboxMetal', scene);
  metal.diffuseColor = Color3.FromHexString('#38bdf8');
  function box(name: string, x: number, y: number, z: number, width: number, height: number, depth: number) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.parent = root; mesh.position.set(x, y, z); mesh.material = material;
    meshes.add(mesh);
    return mesh;
  }
  const bodyDepth = 0.08;
  const bodyZ = -0.08 + bodyDepth / 2;
  box('draftingToolboxBody', 0, 0, bodyZ, 0.9, 0.9, bodyDepth);
  for (const x of [-0.16, 0.16]) {
    box('draftingToolboxHandlePost', x, 0.52, bodyZ, 0.035, 0.12, 0.035).material = metal;
  }
  box('draftingToolboxCarryHandle', 0, 0.58, bodyZ, 0.355, 0.035, 0.035).material = metal;
  const labels: [string, HandMenuHit][] = [
    ['Open drafting', { action: 'drawingTool', tool: 'table' }],
    ['Drawing drawer', { action: 'drawingTool', tool: 'show' }],
    ['Precision drawer', { action: 'drawingTool', tool: 'drafting' }],
    ['Stencil drawer', { action: 'drawingTool', tool: 'stencils' }],
    ['Cutter drawer', { action: 'drawingTool', tool: 'cutters' }],
    ['Paint palette', { action: 'marcherPaint', command: 'show' }],
    ['Image projector', { action: 'fieldProjector', command: 'show' }],
    ['Instruments', { action: 'instrumentPanelSummon' }],
    ['Store all tools', { action: 'drawingTool', tool: 'toolboxStore' }],
  ];
  labels.forEach(([label, hit], index) => {
    const tool = index;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Drafting toolbox requires a 2D canvas context.');
    drawPanelButton(ctx, 512, 96, label);
    const texture = new DynamicTexture(`toolboxDrawer-${tool}Texture`, canvas, scene, true);
    texture.update();
    const faceMaterial = new StandardMaterial(`toolboxDrawer-${tool}Material`, scene);
    faceMaterial.diffuseTexture = texture; faceMaterial.emissiveColor = Color3.White();
    faceMaterial.disableLighting = true;
    const face = MeshBuilder.CreatePlane(`toolboxDrawer-${tool}`, { width: 0.82, height: 0.082 }, scene);
    face.parent = root; face.position.set(0, 0.395 - index * 0.095, -0.088);
    face.material = faceMaterial;
    registerMenuButton(face, hit, { hideOutsideDrafting: false, disabledVisibility: 0.65 });
    buttons.set(face, hit); meshes.add(face);
    face.onDisposeObservable.addOnce(() => faceMaterial.dispose(false, true));
  });
  class ToolboxPanel extends FloatingPanel {
    override recall() {
      if (isDrillEditingEnabled()) super.recall();
    }
  }
  const panel = new ToolboxPanel(root, meshes, root, new Vector3(0.45, 0.45, 0.09), buttons);
  root.setEnabled(false);
  function store() {
    drawers.forEach(({ root: drawer, panel: drawerPanel }, index) => {
      drawerPanel.release();
      drawerPanel.userPlaced = false;
      drawer.parent = root;
      drawer.position.set(0, 0.12 - index * 0.08, bodyZ);
      drawer.scaling.setAll(0.3);
      drawer.rotation.setAll(0);
      drawer.rotationQuaternion?.set(0, 0, 0, 1);
      drawer.setEnabled(false);
    });
  }
  function show() {
    root.setEnabled(true);
    panel.showForViewer({ desktop: { distance: 1.4, height: -0.3 }, xr: { distance: 0.85, height: -0.4 },
      side: 0.65, uprightInXR: true });
  }
  const observer = onEditingModeChangedObservable.add(enabled => {
    if (!enabled) { store(); panel.release(); root.setEnabled(false); }
  });
  store();
  scene.onDisposeObservable.addOnce(() => {
    onEditingModeChangedObservable.remove(observer);
    root.dispose(); material.dispose(); metal.dispose();
  });
  return { root, store, show };
}
