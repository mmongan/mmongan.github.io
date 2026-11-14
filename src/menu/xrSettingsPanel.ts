// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

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
  bandRoomToggle, xrSettingsPanelButton, xrSettingsPanelToggle, fullScaleVRButton, tabletopScaleButton,
  giantModeButton, sittingModeToggle, fieldGridToggle, gridSnapToggle,
  footballFormationSelect, footballPlaySelect,
  footballTackleDefender, footballTackleCarrier, footballTackleEvents, footballTackleCount,
  footballDraftTeam, footballDraftFrom, footballDraftTo,
  footballBallHighlight, footballFlightPath,
  footballFutureGhosts,
} from '../ui/dom';
import { FloatingPanel } from './floatingPanel';
import { registerMenuButton, type HandMenuHit } from './handMenu';
import { drawPanelButton, PANEL_FRAME_COLOR } from './panelStyle';
import { createSettingsButtonIcon } from './settingsButtonIcons';
import { SETTINGS_PANEL_ROWS } from './settingsPanelControls';
import { getMarcherPOVPanelLabel } from '../camera/marcherPOV';

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
    seated: sittingModeToggle, grid: fieldGridToggle, snap: gridSnapToggle, bandRoom: bandRoomToggle,
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
  const backing = MeshBuilder.CreateBox('xrSettingsBacking', { width: 0.84, height: 1.92, depth: 0.02 }, scene);
  backing.parent = panelRoot;
  backing.position.y = -0.50;
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
  button('Formation', -.27, -.65, .25, { action: 'football', command: 'formation' });
  button('Play library', 0, -.65, .25, { action: 'football', command: 'play' });
  button('Load football', .27, -.65, .25, { action: 'football', command: 'load' });
  button('Draft lineup', -.27, -.77, .25, { action: 'football', command: 'draftTeam' });
  button('Restore band', .135, -.77, .52, { action: 'football', command: 'exit' });
  button('Tackler', -.27, -.89, .25, { action: 'football', command: 'tackleDefender' });
  button('Carrier', 0, -.89, .25, { action: 'football', command: 'tackleCarrier' });
  button('Tackle count', .27, -.89, .25, { action: 'football', command: 'tackleCount' });
  button('Save tackle', -.27, -1.01, .25, { action: 'football', command: 'tackleAdd' });
  button('Tackle event', 0, -1.01, .25, { action: 'football', command: 'tackleEvent' });
  button('Remove tackle', .27, -1.01, .25, { action: 'football', command: 'tackleRemove' });
  button('Route start', -.27, -1.13, .25, { action: 'football', command: 'draftFrom' });
  button('Destination', 0, -1.13, .25, { action: 'football', command: 'draftTo' });
  button('Edit chart', .27, -1.13, .25, { action: 'football', command: 'chart' });
  button('Ball highlight', -.135, -1.25, .25, { action: 'football', command: 'ballHighlight' }, footballBallHighlight);
  button('Flight path', .135, -1.25, .25, { action: 'football', command: 'flightPath' }, footballFlightPath);
  button('Future ghosts', 0, -1.37, .52, { action: 'football', command: 'futureGhosts' }, footballFutureGhosts);
  panel = new FloatingPanel(panelRoot, meshes, backing, new Vector3(0.42, 0.96, 0.025), buttons);
  panelRoot.setEnabled(false);
  const update = () => {
    if (!panelRoot.isEnabled()) return;
    for (const label of labels) {
      const select = label.label === 'Formation' ? footballFormationSelect
        : label.label === 'Play library' ? footballPlaySelect
        : label.label === 'Tackler' ? footballTackleDefender
        : label.label === 'Carrier' ? footballTackleCarrier
        : label.label === 'Tackle event' ? footballTackleEvents
        : label.label === 'Draft lineup' ? footballDraftTeam : null;
      const count = label.label === 'Tackle count' ? footballTackleCount
        : label.label === 'Route start' ? footballDraftFrom
        : label.label === 'Destination' ? footballDraftTo : null;
      if (label.label === 'Marcher POV') {
        const pov = getMarcherPOVPanelLabel();
        const signature = `${pov.text}:${pov.active}`;
        if (label.signature === signature) continue;
        label.signature = signature;
        draw(label.ctx, pov.text, pov.active);
        label.texture.update();
        continue;
      }
      if (!label.toggle && !select && !count) continue;
      const text = select ? select.selectedOptions[0]?.text ?? label.label
        : count ? `Count ${count.value}` : `${label.label}: ${label.toggle!.checked ? 'on' : 'off'}`;
      if (label.signature === text) continue;
      label.signature = text;
      draw(label.ctx, text, label.toggle?.checked ?? false);
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
