import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { createSettingsButtonIcon } from '../menu/settingsButtonIcons';
import { SETTINGS_PANEL_ROWS, type SettingsPanelControl } from '../menu/settingsPanelControls';
import { drawPanelButton, PANEL_FRAME_COLOR } from '../menu/panelStyle';
import { DetachableFloatingPanel } from '../menu/floatingPanel';

export function createVideoBoardSettings(topY: number, z: number) {
  const buttonWidth = 4.8, buttonHeight = 3.6, spacing = 5.2, width = 16, height = 17.8, depth = 0.3;
  const banks: { title: string; rows: SettingsPanelControl[][] }[] = [
    { title: 'FIELD / WORKSPACE', rows: SETTINGS_PANEL_ROWS.slice(0, 4) },
    { title: 'TOOLS / EDITING', rows: [...SETTINGS_PANEL_ROWS.slice(4),
      [['Settings panel', { action: 'xrSettings' }]]] },
  ];
  const updates: (() => void)[] = [];
  banks.forEach((bank, side) => {
    const buttons = new Map<AbstractMesh, HandMenuHit>();
    const panel = MeshBuilder.CreateBox(`videoBoardSettingsBank-${side}`, { width, height, depth }, scene);
    panel.position.set((side === 0 ? -1 : 1) * 21.2, topY - height / 2, z + depth / 2);
    const frame = new StandardMaterial(`${panel.name}Material`, scene);
    frame.diffuseColor = Color3.FromHexString(PANEL_FRAME_COLOR);
    frame.specularColor = new Color3(0.15, 0.15, 0.15);
    panel.material = frame;
    panel.onDisposeObservable.addOnce(() => frame.dispose());
    for (const y of [-4, 7]) {
      const bracket = MeshBuilder.CreateBox(`videoBoardSettingsBracket-${side}-${y}`,
        { width: 0.8, height: 0.3, depth }, scene);
      bracket.parent = panel;
      bracket.position.set(side === 0 ? width / 2 + 0.4 : -width / 2 - 0.4, y, 0);
      bracket.material = frame;
      bracket.isPickable = false;
    }

    function face(name: string, w: number, h: number, x: number, y: number,
      draw: (ctx: CanvasRenderingContext2D) => void, pixels = { width: 512, height: 512 }) {
      const canvas = document.createElement('canvas');
      canvas.width = pixels.width; canvas.height = pixels.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Video-board settings require a 2D canvas context.');
      draw(ctx);
      const texture = new DynamicTexture(`${name}Texture`, canvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
      texture.anisotropicFilteringLevel = 8;
      texture.update();
      const material = new StandardMaterial(`${name}Material`, scene);
      material.diffuseTexture = texture;
      material.emissiveColor = Color3.White();
      material.disableLighting = true;
      material.backFaceCulling = false;
      const mesh = MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
      mesh.parent = panel;
      mesh.position.set(x, y, -depth / 2 - 0.04);
      mesh.material = material;
      mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
      return { mesh, ctx, texture };
    }
    const header = face(`videoBoardSettingsHeader-${side}`, width - 0.8, 0.9, 0, height / 2 - 0.9, ctx => {
      ctx.fillStyle = PANEL_FRAME_COLOR;
      ctx.fillRect(0, 0, 1024, 128);
      ctx.fillStyle = '#ffcf40';
      ctx.font = "bold 80px 'Segoe UI', Arial";
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(bank.title, 512, 64, 960);
    }, { width: 1024, height: 128 });
    bank.rows.forEach((row, y) => row.forEach(([label, action, toggle], x) => {
      function draw(ctx: CanvasRenderingContext2D) {
        drawPanelButton(ctx, 512, 512, '', !!toggle?.checked);
        ctx.fillStyle = '#ffffff';
        ctx.font = "bold 100px 'Segoe UI', Arial";
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const lines = toggle ? [label] : label.split(' ');
        lines.forEach((line, index) => ctx.fillText(line, 256,
          lines.length > 1 ? 330 + index * 90 : toggle ? 350 : 390, 460));
        if (toggle) {
          ctx.fillStyle = '#ffcf40';
          ctx.font = "bold 76px 'Segoe UI', Arial";
          ctx.fillText(toggle.checked ? 'ON' : 'OFF', 256, 437);
        }
      }
      const button = face(`videoBoardSetting-${label}`, buttonWidth, buttonHeight, (x - (row.length - 1) / 2) * spacing,
        height / 2 - 3.6 - y * 4, draw);
      registerMenuButton(button.mesh, action);
      buttons.set(button.mesh, action);
      for (const part of createSettingsButtonIcon(button.mesh, action, buttonHeight, 'stacked')) {
        registerMenuButton(part, action);
        buttons.set(part, action);
      }
      if (toggle) {
        let previous = toggle.checked;
        updates.push(() => {
          if (toggle.checked === previous) return;
          previous = toggle.checked;
          draw(button.ctx); button.texture.update();
        });
      }
    }));
    new DetachableFloatingPanel(panel, new Set([panel, ...panel.getChildMeshes()]), panel,
      new Vector3(width / 2, height / 2, depth / 2), buttons);
  });
  const observer = scene.onBeforeRenderObservable.add(() => updates.forEach(update => update()));
  scene.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(observer));
}
