import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { FloatingPanel } from '../menu/floatingPanel';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import { drawPanelButton } from '../menu/panelStyle';
import type { DrawingToolCommand } from './fieldDrawingGeometry';

export function createDraftingTablePanel() {
  const root = new TransformNode('draftingTableWorkspace', scene);
  const backing = MeshBuilder.CreateBox('draftingTableBacking', { width: 1.4, height: 1.4, depth: 0.025 }, scene);
  backing.parent = root;
  const backingMaterial = new StandardMaterial('draftingTableBackingMaterial', scene);
  backingMaterial.diffuseColor = new Color3(0.05, 0.08, 0.1);
  backingMaterial.alpha = 0.45;
  backingMaterial.disableDepthWrite = true;
  backing.material = backingMaterial;
  const meshes = new Set([backing]);
  const buttons = new Map<import('@babylonjs/core/Meshes/abstractMesh.pure').AbstractMesh, HandMenuHit>();
  const rows: ReadonlyArray<ReadonlyArray<readonly [string, DrawingToolCommand]>> = [
    [['Drawing tools', 'show'], ['Precision tools', 'drafting'], ['Stencils', 'stencils'], ['Cutters', 'cutters']],
    [['Select guides', 'guideSelect'], ['Snap on/off', 'tableSnap'], ['Grid on/off', 'tableGrid'], ['Exit drafting', 'tableExit']],
    [['Move -X', 'guideLeft'], ['Move +X', 'guideRight'], ['Move -Z', 'guideBack'], ['Move +Z', 'guideForward']],
    [['Rotate -', 'guideRotateLeft'], ['Rotate +', 'guideRotateRight'], ['Duplicate', 'guideDuplicate'], ['Delete selected', 'guideDelete']],
    [['Step -', 'draftSpacingLess'], ['Step +', 'draftSpacingMore'], ['Angle', 'draftAngle'], ['Put tools away', 'stop']],
    [['Formation', 'formation'], ['Path', 'path'], ['Route form', 'synchronizedRoutes'], ['Undo guide', 'undo']],
    [['Save locally', 'saveDrafting'], ['Restore saved', 'restoreDrafting'], ['Take photo', 'takePhoto'], ['Clear guides', 'clear']],
    [['Full-size view', 'tablePreview']],
    [['Guide space -', 'guideSpacingLess'], ['Guide space +', 'guideSpacingMore'], ['Use spacing', 'guideSpacingApply'], ['Guide facing', 'guideFacing']],
    [['Facing -15', 'guideFacingLeft'], ['Facing +15', 'guideFacingRight']],
  ];
  rows.forEach((row, y) => row.forEach(([label, command], x) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Drafting table controls require a 2D canvas context.');
    drawPanelButton(ctx, 512, 128, label);
    const texture = new DynamicTexture(`draftingTable-${command}Texture`, canvas, scene, false);
    texture.update();
    const material = new StandardMaterial(`draftingTable-${command}Material`, scene);
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    const mesh = MeshBuilder.CreatePlane(`draftingTable-${command}`, { width: 0.32, height: 0.075 }, scene);
    mesh.parent = root;
    mesh.position.set((x - 1.5) * 0.34, 0.44 - y * 0.105, -0.025);
    mesh.material = material;
    meshes.add(mesh);
    const hit: HandMenuHit = { action: 'drawingTool', tool: command };
    buttons.set(mesh, hit);
    registerMenuButton(mesh, hit);
    mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
  }));
  const canvas = document.createElement('canvas');
  canvas.width = 1536; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Drafting table status requires a 2D canvas context.');
  const texture = new DynamicTexture('draftingTableStatusTexture', canvas, scene, false);
  const material = new StandardMaterial('draftingTableStatusMaterial', scene);
  material.diffuseTexture = texture;
  material.emissiveColor = Color3.White();
  material.disableLighting = true;
  material.backFaceCulling = false;
  const status = MeshBuilder.CreatePlane('draftingTableStatus', { width: 1.32, height: 0.09 }, scene);
  status.parent = root; status.position.set(0, 0.59, -0.025); status.material = material;
  status.isPickable = false;
  const panel = new FloatingPanel(root, meshes, root, new Vector3(0.71, 0.71, 0.02), buttons);
  root.setEnabled(false);
  return {
    commands: new Set(rows.flatMap(row => row.map(([, command]) => command))),
    show() {
      root.setEnabled(true);
      const xr = scene.activeCamera?.getClassName() === 'WebXRCamera';
      if (!panel.userPlaced) root.scaling.setAll(xr ? 0.5 : 1);
      panel.showForViewer({ desktop: { distance: 1.6, height: 0, side: -1.45 },
        xr: { distance: 0.65, height: -0.1 }, side: xr ? -0.6 : -1.45, uprightInXR: true });
    },
    hide() { panel.release(); root.setEnabled(false); },
    status(text: string) { drawPanelButton(ctx, 1536, 128, text); texture.update(); },
    dispose() {
      panel.release(); root.dispose();
      backingMaterial.dispose(); material.dispose(false, true);
    },
  };
}
