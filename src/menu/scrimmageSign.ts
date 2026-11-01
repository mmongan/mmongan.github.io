import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { FloatingPanel } from './floatingPanel';
import { registerMenuButton, type HandMenuHit } from './handMenu';

export function initScrimmageSign() {
  const root = new TransformNode('scrimmageSign', scene);
  const board = MeshBuilder.CreateBox('runScrimmageSign', { width: .9, height: .32, depth: .035 }, scene);
  board.parent = root;
  const texture = new DynamicTexture('scrimmageSignText', { width: 1024, height: 256 }, scene, false);
  texture.drawText('RUN SCRIMMAGE', null, 155, 'bold 86px Arial', 'white', '#194d2b', true);
  const material = new StandardMaterial('scrimmageSignMaterial', scene);
  material.diffuseTexture = texture;
  material.emissiveColor = Color3.White();
  board.material = material;
  const action: HandMenuHit = { action: 'football', command: 'scrimmage' };
  registerMenuButton(board, action);
  const panel = new FloatingPanel(root, new Set([board]), board, new Vector3(.45, .16, .025),
    new Map([[board, action]]));
  panel.showForViewer({ desktop: { distance: 1.6, height: -.45, side: .7 },
    xr: { distance: .8, height: -.35 }, side: .7, uprightInXR: true });
  scene.onDisposeObservable.addOnce(() => {
    panel.release();
    root.dispose();
    material.dispose(false, true);
  });
}
