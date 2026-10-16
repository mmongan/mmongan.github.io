import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { getInstrumentLabel, type MarcherInstrument } from '../robot/robot';
import { instrumentPanelButton, instrumentPanelToggle } from '../ui/dom';
import { FloatingPanel } from './floatingPanel';
import { addInstrumentButtonModel } from './instrumentButtonModel';
import { registerMenuButton, type HandMenuHit } from './handMenu';
import { drawPanelButton, PANEL_FRAME_COLOR } from './panelStyle';

export const INSTRUMENT_PANEL_CHOICES: readonly MarcherInstrument[] = [
  'trumpet', 'mellophone', 'trombone', 'euphonium', 'sousaphone', 'altoSax',
  'bariSax', 'clarinet', 'flute', 'snare', 'tenors', 'bassDrum', 'glockenspiel',
  'cymbals',
  'guardFlag', 'guardRifle', 'guardSabre',
];

let root: TransformNode | null = null;
let panel: FloatingPanel | null = null;
let placedCamera = scene.activeCamera;

function placePanel() {
  if (!panel) return;
  panel.placeForViewer({
    desktop: { distance: 1.6, height: 0, side: 0 },
    xr: { distance: 0.65, height: -0.12 },
    side: -0.35,
    uprightInXR: true,
  });
  placedCamera = scene.activeCamera;
}

export function summonInstrumentPanel() {
  if (!root) initInstrumentPanel();
  root!.setEnabled(true);
  if (instrumentPanelToggle) instrumentPanelToggle.checked = true;
  placePanel();
}

export function hideInstrumentPanel() {
  panel?.release();
  root?.setEnabled(false);
  if (instrumentPanelToggle) instrumentPanelToggle.checked = false;
}

function updatePanelVisibility() {
  if (instrumentPanelToggle?.checked) summonInstrumentPanel();
  else hideInstrumentPanel();
}

export function initInstrumentPanel() {
  if (root) return;
  root = new TransformNode('instrumentPanelRoot', scene);
  const buttons = new Map<AbstractMesh, HandMenuHit>();
  const meshes = new Set<AbstractMesh>();
  const backing = MeshBuilder.CreateBox('instrumentPanelBacking',
    { width: 0.78, height: 1.34, depth: 0.018 }, scene);
  backing.parent = root;
  const backingMaterial = new StandardMaterial('instrumentPanelBackingMaterial', scene);
  backingMaterial.diffuseColor = Color3.FromHexString(PANEL_FRAME_COLOR);
  backingMaterial.specularColor = Color3.Black();
  backing.material = backingMaterial;
  meshes.add(backing);

  function tile(name: string, label: string, x: number, y: number, width: number,
    height: number, action?: HandMenuHit) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = Math.round(512 * height / width);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Instrument panel requires a 2D canvas context.');
    drawPanelButton(ctx, canvas.width, canvas.height, label);
    const texture = new DynamicTexture(`${name}Texture`, canvas, scene, false);
    texture.update();
    const material = new StandardMaterial(`${name}Material`, scene);
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.specularColor = Color3.Black();
    material.backFaceCulling = false;
    const mesh = MeshBuilder.CreatePlane(name, { width, height }, scene);
    mesh.parent = root;
    mesh.position.set(x, y, -0.012);
    mesh.material = material;
    meshes.add(mesh);
    if (action) {
      registerMenuButton(mesh, action);
      buttons.set(mesh, action);
    }
    mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
    return mesh;
  }

  tile('instrumentPanelTitle', 'Create marchers', -0.03, 0.39, 0.64, 0.06);
  tile('instrumentPanelClose', 'X', 0.335, 0.39, 0.055, 0.055, { action: 'instrumentPanelHide' });
  tile('instrumentPanelHelp', 'Pick an instrument or guard prop, then place', 0, 0.32, 0.73, 0.045);
  INSTRUMENT_PANEL_CHOICES.forEach((instrument, index) => {
    const x = (index % 4 - 1.5) * 0.185;
    const y = 0.205 - Math.floor(index / 4) * 0.16;
    const button = tile(`instrumentPanel-${instrument}`, '', x, y, 0.17, 0.1,
      { action: 'createMarcher', instrument });
    addInstrumentButtonModel(button, instrument, 0.09);
    tile(`instrumentPanelLabel-${instrument}`, getInstrumentLabel(instrument), x, y - 0.065, 0.17, 0.03,
      { action: 'createMarcher', instrument });
  });
  tile('instrumentPanelDone', 'Done placing', 0.17, -0.61, 0.35, 0.06,
    { action: 'finishMarcherPlacement' });
  panel = new FloatingPanel(root, meshes, root, new Vector3(0.39, 0.67, 0.04), buttons);
  root.setEnabled(false);
  instrumentPanelButton?.addEventListener('click', summonInstrumentPanel);
  instrumentPanelToggle?.addEventListener('change', updatePanelVisibility);
  if (instrumentPanelToggle?.checked) summonInstrumentPanel();
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (root?.isEnabled() && placedCamera !== scene.activeCamera) placePanel();
  });
  scene.onDisposeObservable.addOnce(() => {
    scene.onBeforeRenderObservable.remove(observer);
    instrumentPanelButton?.removeEventListener('click', summonInstrumentPanel);
    instrumentPanelToggle?.removeEventListener('change', updatePanelVisibility);
    backingMaterial.dispose();
    root = null;
    panel = null;
  });
}
