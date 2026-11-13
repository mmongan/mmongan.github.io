// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { scene } from '../scene/engine';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import { FieldMountedPanel } from '../menu/floatingPanel';
import { drawPanelButton } from '../menu/panelStyle';
import { getDrillTransportState, isPlaybackRequested, isPlaybackStartPending, onDrillTransportChangedObservable } from '../robot/robot';
import { FIELD_WIDTH_YARDS } from './constants';
import { mergeMeshesByMaterial } from './meshMerging';
import { createMediaButtonIcon } from '../menu/settingsButtonIcons';
import { scrimmageButton } from '../ui/dom';
import {
  isDrillEditingEnabled, onEditingModeChangedObservable, isMenuActionAvailable, onDraftingToolsChangedObservable,
} from '../interaction/editingMode';

const MEDIA_SIGNS = [
  { label: 'RESTART', symbol: '|<<', action: 'restart' },
  { label: 'REWIND', symbol: '<<', action: 'rewind' },
  { label: 'STEP BACK', symbol: '|<', action: 'stepBack' },
  { label: 'PLAY', symbol: '>', action: 'playPause' },
  { label: 'STEP NEXT', symbol: '>|', action: 'stepForward' },
  { label: 'FAST FORWARD', symbol: '>>', action: 'fastForward' },
  { label: 'GO TO END', symbol: '>>|', action: 'goToEnd' },
] as const;

const PANEL_SIGNS: { label: string; symbol: string; action: HandMenuHit }[] = [
  { label: 'SETTINGS', symbol: 'XR', action: { action: 'xrSettings' } },
  { label: 'CHART', symbol: '[]', action: { action: 'drillChartPad' } },
  { label: 'SCORE', symbol: 'MUSIC', action: { action: 'musicStandSummon' } },
  { label: 'INSTRUMENTS', symbol: 'BAND', action: { action: 'instrumentPanelSummon' } },
  { label: 'DRAFTING', symbol: 'DRAFT', action: { action: 'drawingTool', tool: 'table' } },
  { label: 'DRAWING', symbol: '/', action: { action: 'drawingTool', tool: 'show' } },
  { label: 'PRECISION', symbol: '90', action: { action: 'drawingTool', tool: 'drafting' } },
  { label: 'STENCILS', symbol: 'ABC', action: { action: 'drawingTool', tool: 'stencils' } },
  { label: 'CUTTERS', symbol: 'O', action: { action: 'drawingTool', tool: 'cutters' } },
  { label: 'PAINT', symbol: 'COLOR', action: { action: 'marcherPaint', command: 'show' } },
  { label: 'PROJECTOR', symbol: 'IMAGE', action: { action: 'fieldProjector', command: 'show' } },
];
const SIGNS = [
  ...MEDIA_SIGNS.map(sign => ({ ...sign, action: { action: sign.action } as HandMenuHit, immersive: false })),
  ...PANEL_SIGNS.map(sign => ({ ...sign, immersive: true })),
  { label: 'RUN SCRIMMAGE', symbol: 'FOOTBALL',
    action: { action: 'football', command: 'scrimmage' } as HandMenuHit, immersive: false },
];

export function createStadiumCrowd(parent: Mesh) {
  const material = (name: string, color: string) => {
    const mat = new StandardMaterial(`stadiumCrowd-${name}`, scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = Color3.Black();
    return mat;
  };
  // The whole audience shares one vertex-colored material, so any number of
  // outfit/skin/hair combinations still merges into a single static mesh.
  const crowdMaterial = material('people', '#ffffff');
  const SHIRTS = ['#2875b5', '#d95140', '#e5ba38', '#704bb0', '#39a880', '#eeeeee',
    '#f28c28', '#4aa3dd', '#c2436b', '#7a8b2f', '#2f4f8f', '#d9d2c0'].map(Color3.FromHexString);
  const SKINS = ['#f2c7a5', '#d9a06b', '#b77c50', '#67432f'].map(Color3.FromHexString);
  const TROUSERS = ['#243247', '#3a3a3a', '#5a4632', '#274035'].map(Color3.FromHexString);
  const HAIR = ['#2a1d12', '#4a3521', '#8a8a8a', '#1c1c1c', '#6b4a2b'].map(Color3.FromHexString);
  const SHOES = Color3.FromHexString('#2b2b2b');
  const frameMaterial = material('signFrame', '#f3bc45');
  const signFaces = SIGNS.map((sign, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Stadium media signs require a 2D canvas context.');
    const texture = new DynamicTexture(`stadiumSignTexture-${index}`, canvas, scene,
      true, Texture.TRILINEAR_SAMPLINGMODE);
    texture.anisotropicFilteringLevel = 8;
    const mat = material(`sign-${index}`, '#ffffff');
    mat.diffuseTexture = texture;
    mat.emissiveColor = Color3.White();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    const draw = () => {
      const playPause = sign.action.action === 'playPause';
      drawPanelButton(ctx, 512, 320, '', playPause && isPlaybackRequested());
      ctx.fillStyle = '#ffffff';
      if (playPause && isPlaybackStartPending()) {
        // Immersive users can't see the DOM status explaining a held Play.
        ctx.font = 'bold 36px Arial';
        ctx.fillText('WAITING FOR MUSIC', 256, 296, 470);
      }
      if (sign.action.action === 'football') {
        const returnBand = scrimmageButton?.dataset.returnBand === 'true';
        ctx.font = '150px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.fillText(returnBand ? '🎺' : '🏈', 256, 155, 460);
        ctx.font = 'bold 49px Arial';
        ctx.fillText(returnBand ? 'RETURN BAND' : 'START SCRIMMAGE', 256, 258, 470);
      } else if (sign.immersive) {
        ctx.font = 'bold 150px Arial';
        ctx.fillText(sign.symbol, 256, 124, 460);
        ctx.font = 'bold 49px Arial';
        ctx.fillText(sign.label, 256, 258, 470);
      }
      texture.update();
    };
    draw();
    return { material: mat, draw };
  });
  const updateScrimmageSign = () => signFaces[SIGNS.length - 1].draw();
  scrimmageButton?.addEventListener('change', updateScrimmageSign);
  const playSignState = () => `${getDrillTransportState().playing}:${isPlaybackStartPending()}`;
  let previousPlaySignState = playSignState();
  const observer = onDrillTransportChangedObservable.add(() => {
    const next = playSignState();
    if (next === previousPlaySignState) return;
    previousPlaySignState = next;
    signFaces[MEDIA_SIGNS.findIndex(sign => sign.action === 'playPause')].draw();
  });
  const materials = [crowdMaterial, frameMaterial, ...signFaces.map(face => face.material)];
  const immersiveSigns = new Map<Mesh, HandMenuHit>();
  const updateSigns = () => {
    immersiveSigns.forEach((action, sign) => sign.setEnabled(isDrillEditingEnabled() && isMenuActionAvailable(action)));
  };
  const modeObserver = onEditingModeChangedObservable.add(updateSigns);
  const draftingObserver = onDraftingToolsChangedObservable.add(updateSigns);
  scene.onDisposeObservable.addOnce(() => {
    scrimmageButton?.removeEventListener('change', updateScrimmageSign);
    onDrillTransportChangedObservable.remove(observer);
    onEditingModeChangedObservable.remove(modeObserver);
    onDraftingToolsChangedObservable.remove(draftingObserver);
    materials.forEach(mat => mat.dispose(false, true));
  });
  let parts: Mesh[] = [];

  function paint(mesh: Mesh, color: Color3) {
    const count = mesh.getTotalVertices();
    const colors = new Float32Array(count * 4);
    for (let vertex = 0; vertex < count; vertex++) {
      colors[vertex * 4] = color.r;
      colors[vertex * 4 + 1] = color.g;
      colors[vertex * 4 + 2] = color.b;
      colors[vertex * 4 + 3] = 1;
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  }

  function finishPart(mesh: Mesh, x: number, y: number, z: number, color: Color3) {
    mesh.position.set(x, y, z);
    mesh.material = crowdMaterial;
    mesh.isPickable = false;
    paint(mesh, color);
    parts.push(mesh);
    return mesh;
  }

  function ellipsoid(name: string, x: number, y: number, z: number,
    width: number, height: number, depth: number, color: Color3, segments = 6) {
    return finishPart(MeshBuilder.CreateSphere(name,
      { diameterX: width, diameterY: height, diameterZ: depth, segments }, scene), x, y, z, color);
  }

  function capsule(name: string, x: number, y: number, z: number,
    height: number, radius: number, color: Color3, alongField = false) {
    const mesh = MeshBuilder.CreateCapsule(name,
      { height: height + radius * 2, radius, tessellation: 6, subdivisions: 1, capSubdivisions: 2 }, scene);
    if (alongField) mesh.rotation.z = Math.PI / 2;
    return finishPart(mesh, x, y, z, color);
  }

  function dome(name: string, x: number, y: number, z: number, diameter: number, color: Color3) {
    return finishPart(MeshBuilder.CreateSphere(name, { diameter, segments: 5, slice: 0.55 }, scene), x, y, z, color);
  }

  // Seated audience member facing the field (+x axis points away from it),
  // built from the same rounded capsule/ellipsoid family as the marchers and
  // football players. Pose, outfit, complexion, hair, and hats vary
  // deterministically by seat.
  function spectator(side: number, x: number, seatY: number, z: number, index: number, raised = false) {
    const shirt = SHIRTS[index % SHIRTS.length];
    const complexion = SKINS[Math.floor(index / SHIRTS.length) % SKINS.length];
    const trouser = TROUSERS[(index + 1) % TROUSERS.length];
    // 0 hands on lap, 1 both arms up, 2 one arm up, 3 arms crossed low.
    const pose = raised ? 1 : (index * 7 + 3) % 4;
    ellipsoid('spectatorTorso', x, seatY + 0.33, z, 0.34, 0.62, 0.48, shirt);
    for (const offset of [-0.19, 0.19]) {
      ellipsoid('spectatorShoulder', x, seatY + 0.54, z + offset, 0.2, 0.18, 0.2, shirt, 5);
    }
    ellipsoid('spectatorHead', x, seatY + 0.78, z, 0.28, 0.28, 0.28, complexion, 6);
    const style = index % 4;
    if (style === 0) {
      // Team cap with a small brim toward the field.
      const capColor = SHIRTS[(index + 5) % SHIRTS.length];
      dome('spectatorCap', x, seatY + 0.84, z, 0.3, capColor);
      ellipsoid('spectatorCapBrim', x - side * 0.15, seatY + 0.86, z, 0.16, 0.03, 0.18, capColor, 4);
    } else if (style !== 3) {
      dome('spectatorHair', x, seatY + 0.83, z, 0.3, HAIR[index % HAIR.length]);
    }
    for (const [armIndex, offset] of [-0.15, 0.15].entries()) {
      capsule('spectatorThigh', x - side * 0.13, seatY + 0.07, z + offset, 0.34, 0.075, trouser, true);
      capsule('spectatorShin', x - side * 0.29, seatY - 0.12, z + offset, 0.3, 0.07, trouser);
      ellipsoid('spectatorShoe', x - side * 0.34, seatY - 0.32, z + offset, 0.22, 0.1, 0.16, SHOES, 4);
      const armZ = z + offset * 1.9;
      if (pose === 1 || (pose === 2 && armIndex === 0)) {
        capsule('spectatorArm', x - side * 0.04, seatY + 0.58, armZ, 0.2, 0.06, shirt);
        capsule('spectatorForearm', x - side * 0.04, seatY + 0.9, armZ, 0.26, 0.055, complexion);
      } else if (pose === 3) {
        capsule('spectatorArm', x - side * 0.05, seatY + 0.4, armZ, 0.18, 0.06, shirt);
        capsule('spectatorForearm', x - side * 0.18, seatY + 0.24, z + offset * 0.8, 0.16, 0.055, complexion, true);
      } else {
        capsule('spectatorArm', x - side * 0.05, seatY + 0.4, armZ, 0.18, 0.06, shirt);
        capsule('spectatorForearm', x - side * 0.2, seatY + 0.22, z + offset * 1.5, 0.16, 0.055, complexion, true);
      }
    }
  }

  return {
    addTier(side: number, rows: number, length: number, offset: number, startY: number,
      rowHeight: number, rowDepth: number, groundY: number, signs: boolean) {
      const seats = Math.floor((length - 4) / 1.8);
      for (let row = 0; row < rows; row++) {
        const x = side * (FIELD_WIDTH_YARDS / 2 + offset + (row + 0.5) * rowDepth);
        const seatY = groundY + startY + (row + 1) * rowHeight + 0.04;
        const signRow = signs && (row === 0 || row === 3);
        const rowSigns = row === 0 ? SIGNS.slice(0, MEDIA_SIGNS.length) : SIGNS.slice(MEDIA_SIGNS.length);
        const spacing = row === 0 ? 7 : Math.min(6, (length - 6) / (rowSigns.length - 1));
        for (let seat = 0; seat < seats; seat++) {
          if ((seat * 7 + row * 11 + (side + 1) * 3) % 10 >= 6 || seat % 12 === 0) continue;
          const z = (seat - (seats - 1) / 2) * 1.8;
          if (signRow && rowSigns.some((_, index) =>
            Math.abs(z + side * (index - (rowSigns.length - 1) / 2) * spacing) < 1)) continue;
          spectator(side, x, seatY, z, seat + row * 13 + (side + 1) * 5);
        }
        if (!signRow) continue;
        rowSigns.forEach((sign, index) => {
          const z = -side * (index - (rowSigns.length - 1) / 2) * spacing;
          spectator(side, x, seatY, z, index, true);
          const name = sign.immersive ? `panel-${sign.label}` :
            sign.action.action === 'football' ? 'runScrimmage' : sign.action.action;
          const frame = MeshBuilder.CreateBox(`stadiumMediaSign-${side}-${name}`,
            { width: 3, height: 1.8, depth: 0.16 }, scene);
          frame.position.set(x, seatY + 2, z);
          frame.rotation.y = side * Math.PI / 2;
          frame.material = frameMaterial;
          frame.parent = parent;
          const face = MeshBuilder.CreatePlane(`stadiumMediaSignFace-${side}-${name}`,
            { width: 2.86, height: 1.66 }, scene);
          face.parent = frame;
          face.position.z = -0.091;
          face.material = signFaces[index + (row === 0 ? 0 : MEDIA_SIGNS.length)].material;
          const action = sign.action;
          if (row === 0) createMediaButtonIcon(face, action, 2.86, 1.66,
            isPlaybackRequested, isPlaybackStartPending);
          registerMenuButton(frame, action);
          registerMenuButton(face, action);
          new FieldMountedPanel(frame, new Set([frame, ...frame.getChildMeshes()]), frame,
            new Vector3(1.5, 0.9, 0.08), new Map([[frame, action], [face, action]]));
          if (sign.immersive) {
            immersiveSigns.set(frame, action);
            frame.setEnabled(isDrillEditingEnabled() && isMenuActionAvailable(action));
            frame.onDisposeObservable.addOnce(() => immersiveSigns.delete(frame));
          }
        });
      }
    },
    finish() {
      mergeMeshesByMaterial(parts, 'stadiumCrowd', parent).forEach(mesh => { mesh.isPickable = false; });
      parts = [];
    },
  };
}
