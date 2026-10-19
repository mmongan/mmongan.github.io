import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import {
  xrSettingsPanelButton, xrSettingsPanelToggle, fullScaleVRButton, tabletopScaleButton,
  giantModeButton, sittingModeToggle, fieldGridToggle, gridSnapToggle,
} from '../ui/dom';
import { FloatingPanel } from './floatingPanel';
import { registerMenuButton, type HandMenuHit } from './handMenu';
import { drawPanelButton, PANEL_FRAME_COLOR } from './panelStyle';
import { createSettingsButtonIcon } from './settingsButtonIcons';
import { SETTINGS_PANEL_ROWS } from './settingsPanelControls';

type XRSetting = Extract<HandMenuHit, { action: 'xrSetting' }>['setting'];
const placement = {
  desktop: { distance: 1.3, height: 0 },
  xr: { distance: 0.6, height: -0.12 },
  side: 0,
  uprightInXR: true,
};
let root: TransformNode | null = null;
let panel: FloatingPanel | null = null;

export function executeXRSetting(setting: XRSetting) {
  const control = {
    fullScale: fullScaleVRButton, tabletop: tabletopScaleButton, giant: giantModeButton,
    seated: sittingModeToggle, grid: fieldGridToggle, snap: gridSnapToggle,
  }[setting];
  if (!control) throw new Error(`The ${setting} settings control is unavailable.`);
  if (control.disabled) {
    console.warn(control.title || `The ${setting} setting is unavailable in this mode.`);
    return;
  }
  control.click();
}

export function setXRSettingsPanelVisible(visible: boolean) {
  if (!root) initXRSettingsPanel();
  if (visible) panel!.showForViewer(placement);
  else panel!.release();
  root!.setEnabled(visible);
  if (xrSettingsPanelToggle) xrSettingsPanelToggle.checked = visible;
}

export function summonXRSettingsPanel() {
  setXRSettingsPanelVisible(true);
  panel!.placeForViewer(placement);
}

export function initXRSettingsPanel() {
  if (root) return;
  const panelRoot = new TransformNode('xrSettingsPanel', scene);
  root = panelRoot;
  const meshes = new Set<AbstractMesh>();
  const buttons = new Map<AbstractMesh, HandMenuHit>();
  const backing = MeshBuilder.CreateBox('xrSettingsBacking', { width: 0.84, height: 1.08, depth: 0.02 }, scene);
  backing.parent = panelRoot;
  backing.position.y = -0.08;
  const backingMaterial = new StandardMaterial('xrSettingsBackingMaterial', scene);
  backingMaterial.diffuseColor = Color3.FromHexString(PANEL_FRAME_COLOR);
  backingMaterial.alpha = 0.45;
  backingMaterial.disableDepthWrite = true;
  backing.material = backingMaterial;
  meshes.add(backing);
  function draw(ctx: CanvasRenderingContext2D, label: string, active = false, close = false) {
    drawPanelButton(ctx, 512, 128, '', active);
    if (close) return;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 318, 64, 360);
  }
  const labels: { ctx: CanvasRenderingContext2D; texture: DynamicTexture; label: string; toggle?: HTMLInputElement | null; signature: string }[] = [];
  function button(label: string, x: number, y: number, width: number, action: HandMenuHit,
    toggle?: HTMLInputElement | null) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('XR settings panel requires a 2D canvas context.');
    draw(ctx, label, false, action.action === 'xrSettingsHide');
    const texture = new DynamicTexture(`xrSettings-${label}`, canvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    texture.anisotropicFilteringLevel = 8;
    texture.update();
    const material = new StandardMaterial(`xrSettings-${label}Material`, scene);
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    const mesh = MeshBuilder.CreatePlane(`xrSettingsButton-${label}`, { width, height: 0.075 }, scene);
    mesh.parent = panelRoot;
    mesh.position.set(x, y, -0.016);
    mesh.material = material;
    meshes.add(mesh); buttons.set(mesh, action); registerMenuButton(mesh, action);
    for (const part of createSettingsButtonIcon(mesh, action, width)) {
      meshes.add(part); buttons.set(part, action); registerMenuButton(part, action);
    }
    labels.push({ ctx, texture, label, toggle, signature: '' });
    mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
  }
  button('Settings / panels', -0.04, 0.39, 0.64, { action: 'xrSettings' });
  button('X', 0.365, 0.39, 0.065, { action: 'xrSettingsHide' });
  SETTINGS_PANEL_ROWS.forEach((row, y) => row.forEach(([label, action, toggle], x) =>
    button(label, (x - 1) * 0.27, 0.27 - y * 0.12, 0.25, action, toggle)));
  panel = new FloatingPanel(panelRoot, meshes, backing, new Vector3(0.42, 0.54, 0.025), buttons);
  panelRoot.setEnabled(false);
  const update = () => {
    if (!panelRoot.isEnabled()) return;
    for (const label of labels) {
      if (!label.toggle) continue;
      const text = `${label.label}: ${label.toggle.checked ? 'on' : 'off'}`;
      if (label.signature === text) continue;
      label.signature = text;
      draw(label.ctx, text, label.toggle.checked);
      label.texture.update();
    }
  };
  const observer = scene.onBeforeRenderObservable.add(update);
  const toggleVisibility = () => setXRSettingsPanelVisible(!!xrSettingsPanelToggle?.checked);
  xrSettingsPanelButton?.addEventListener('click', summonXRSettingsPanel);
  xrSettingsPanelToggle?.addEventListener('change', toggleVisibility);
  scene.onDisposeObservable.addOnce(() => {
    scene.onBeforeRenderObservable.remove(observer);
    xrSettingsPanelButton?.removeEventListener('click', summonXRSettingsPanel);
    xrSettingsPanelToggle?.removeEventListener('change', toggleVisibility);
    panel?.release();
    backingMaterial.dispose();
    root = null; panel = null;
  });
}
