import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { FloatingPanel } from './floatingPanel';
import { PanelTransparencySlider } from './panelTransparencySlider';
import { drawPanelButton, PANEL_FRAME_COLOR, PANEL_PAPER_COLOR } from './panelStyle';
import {
  musicStandToggle, musicStandPlaceButton, musicStandStatus,
  musicStandSizeInput, musicStandSizeValue, musicScoreMeasuresSelect,
} from '../ui/dom';
import {
  onMidiScoreDisplayChanged, setMidiScoreStandVisible, type MidiScoreDisplay,
  setScoreStandScale, setScoreMeasuresConfig, getScoreMeasuresConfig, getEffectiveMeasuresPerPage,
} from '../audio/midiScore';
import { registerMenuButton, type HandMenuHit } from './handMenu';
import { getDrillTransportState, onDrillTransportChangedObservable } from '../robot/robot';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { layoutScorePage } from '../audio/scoreLayout';

const WIDTH = 1536;
const HEIGHT = 1280;

let standScale = 1.0;
let deskNode: TransformNode | null = null;
let updateTopBarButtonsFn: (() => void) | null = null;
let updateVisibility: ((visible: boolean) => void) | null = null;
let placeStand: (() => void) | null = null;

export function summonMusicStand() {
  setMusicStandVisible(true);
  placeStand?.();
}

export function setMusicStandVisible(visible: boolean) {
  if (musicStandToggle) musicStandToggle.checked = visible;
  updateVisibility?.(visible);
}

export function setMusicStandScale(scale: number) {
  const clamped = Math.max(0.6, Math.min(2.5, Math.round(scale * 1000) / 1000));
  standScale = clamped;
  if (deskNode) {
    deskNode.scaling.setAll(standScale);
  }
  if (musicStandSizeInput) {
    musicStandSizeInput.value = String(Math.round(standScale * 100));
  }
  if (musicStandSizeValue) {
    musicStandSizeValue.value = `${Math.round(standScale * 100)}%`;
  }
  setScoreStandScale(standScale);
  updateTopBarButtonsFn?.();
}

export function getMusicStandScale(): number {
  return standScale;
}

const STAFF_OPTIONS: ('auto' | number)[] = ['auto', 8, 4, 3, 2, 1];

export function cycleMusicStandStaff() {
  const current = getScoreMeasuresConfig();
  let nextIndex = 0;
  const currentIndex = STAFF_OPTIONS.indexOf(current);
  if (currentIndex !== -1) {
    nextIndex = (currentIndex + 1) % STAFF_OPTIONS.length;
  }
  const next = STAFF_OPTIONS[nextIndex];
  if (musicScoreMeasuresSelect) {
    musicScoreMeasuresSelect.value = String(next);
  }
  setScoreMeasuresConfig(next);
  updateTopBarButtonsFn?.();
}

export function initMusicStand() {
  // Room-scale UI must not be captured as a stadium root mesh by AR tabletop mode.
  const root = new TransformNode('musicStandRoot', scene);
  const desk = new TransformNode('musicStandDesk', scene);
  desk.parent = root;
  desk.rotation.x = Math.PI / 10;
  desk.scaling.setAll(standScale);
  deskNode = desk;

  const metal = new StandardMaterial('musicStandMetal', scene);
  metal.diffuseColor = Color3.FromHexString(PANEL_FRAME_COLOR);
  metal.specularColor = new Color3(0.3, 0.3, 0.3);
  metal.alpha = 0.08;
  metal.disableDepthWrite = true;
  const backing = MeshBuilder.CreateBox('musicStandBacking', { width: 0.72, height: 0.82, depth: 0.018 }, scene);
  backing.parent = desk;
  backing.position.set(0, -0.02, 0.016);
  backing.material = metal;
  const lip = MeshBuilder.CreateBox('musicStandLip', { width: 0.74, height: 0.025, depth: 0.08 }, scene);
  lip.parent = desk;
  lip.position.set(0, -0.43, -0.012);
  lip.material = metal;
  const headerMaterial = new StandardMaterial('musicStandHeaderMaterial', scene);
  headerMaterial.diffuseColor = Color3.FromHexString(PANEL_FRAME_COLOR);
  headerMaterial.specularColor = Color3.Black();
  const header = MeshBuilder.CreateBox('musicStandHeader', { width: 0.74, height: 0.055, depth: 0.018 }, scene);
  header.parent = desk;
  header.position.set(0, 0.31, 0.01);
  header.material = headerMaterial;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Music stand requires a 2D canvas context.');
  const texture = new DynamicTexture('musicStandScoreTexture', canvas, scene, true);
  const paper = new StandardMaterial('musicStandPaper', scene);
  paper.diffuseTexture = texture;
  paper.emissiveColor = Color3.White();
  paper.disableLighting = true;
  paper.specularColor = Color3.Black();
  paper.alpha = 0.65;
  paper.disableDepthWrite = true;
  const sheet = MeshBuilder.CreatePlane('musicStandScore', { width: 0.65, height: 0.65 * HEIGHT / WIDTH }, scene);
  sheet.parent = desk;
  sheet.material = paper;
  sheet.position.set(0, -0.035, -0.002);
  const buttons = new Map<AbstractMesh, HandMenuHit>();
  const buttonTextures: { texture: DynamicTexture; canvas: HTMLCanvasElement; action: HandMenuHit; label: string }[] = [];
  for (const [index, [label, action]] of ([
    ['<<', 'rewind'], ['Back', 'stepBack'], ['Play', 'playPause'], ['Next', 'stepForward'], ['>>', 'fastForward'],
  ] as const).entries()) {
    const buttonCanvas = document.createElement('canvas');
    buttonCanvas.width = 256;
    buttonCanvas.height = 128;
    const buttonTexture = new DynamicTexture(`musicStandButtonTexture-${action}`, buttonCanvas, scene, false);
    buttonTexture.hasAlpha = true;
    buttonTexture.getAlphaFromRGB = false;
    const material = new StandardMaterial(`musicStandButtonMaterial-${action}`, scene);
    material.diffuseTexture = buttonTexture;
    material.opacityTexture = buttonTexture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    const button = MeshBuilder.CreatePlane(`musicStandButton-${action}`, { width: 0.115, height: 0.0575 }, scene);
    button.parent = desk;
    button.position.set((index - 2) * 0.13, -0.37, -0.007);
    button.material = material;
    const hit: HandMenuHit = { action };
    registerMenuButton(button, hit);
    buttons.set(button, hit);
    buttonTextures.push({ texture: buttonTexture, canvas: buttonCanvas, action: hit, label });
  }

  const topBarTextures: {
    texture: DynamicTexture;
    canvas: HTMLCanvasElement;
    action: HandMenuHit;
    getText: () => string;
  }[] = [];

  const topBarDefs: {
    name: string;
    action: HandMenuHit;
    width: number;
    height: number;
    x: number;
    getText: () => string;
  }[] = [
    {
      name: 'musicStandStaffToggle',
      action: { action: 'musicStandStaffToggle' },
      width: 0.35,
      height: 0.05,
      x: -0.10,
      getText: () => {
        const config = getScoreMeasuresConfig();
        const effective = getEffectiveMeasuresPerPage();
        return config === 'auto' ? `Staff: Auto (${effective})` : `Staff: ${config}m`;
      },
    },
    {
      name: 'musicStandHide',
      action: { action: 'musicStandHide' },
      width: 0.05,
      height: 0.05,
      x: 0.32,
      getText: () => 'X',
    },
  ];

  for (const def of topBarDefs) {
    const buttonCanvas = document.createElement('canvas');
    buttonCanvas.width = def.width > 0.2 ? 512 : 96;
    buttonCanvas.height = 96;
    const buttonTexture = new DynamicTexture(`musicStandButtonTexture-${def.name}`, buttonCanvas, scene, false);
    buttonTexture.hasAlpha = true;
    buttonTexture.getAlphaFromRGB = false;
    const material = new StandardMaterial(`musicStandButtonMaterial-${def.name}`, scene);
    material.diffuseTexture = buttonTexture;
    material.opacityTexture = buttonTexture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    const button = MeshBuilder.CreatePlane(`musicStandButton-${def.name}`, { width: def.width, height: def.height }, scene);
    button.parent = desk;
    button.position.set(def.x, 0.31, -0.007);
    button.material = material;
    registerMenuButton(button, def.action);
    buttons.set(button, def.action);
    topBarTextures.push({ texture: buttonTexture, canvas: buttonCanvas, action: def.action, getText: def.getText });
  }

  function updateTopBarButtons() {
    for (const item of topBarTextures) {
      const bCtx = item.canvas.getContext('2d');
      if (!bCtx) throw new Error('Music panel buttons require a 2D canvas context.');
      drawPanelButton(bCtx, item.canvas.width, item.canvas.height, item.getText());
      item.texture.update(true);
    }
  }
  updateTopBarButtonsFn = updateTopBarButtons;
  updateTopBarButtons();

  const slider = new PanelTransparencySlider(desk, 'musicStandTransparency', 0.21, 0.31,
    0.04, 0.08, opacity => {
      paper.alpha = opacity;
      metal.alpha = opacity * 0.08 / 0.65;
    });
  const interaction = new FloatingPanel(root, new Set([backing, lip, header, sheet, slider.mesh, ...buttons.keys()]),
    desk, new Vector3(0.38, 0.44, 0.055), buttons,
    { getScale: getMusicStandScale, setScale: setMusicStandScale }, slider);
  let buttonSignature = '';
  function updateMediaButtons() {
    const transport = getDrillTransportState();
    const next = `${transport.playing}:${Math.sign(transport.beatsPerSecond)}`;
    if (next === buttonSignature) return;
    buttonSignature = next;
    for (const button of buttonTextures) {
      const ctx = button.canvas.getContext('2d');
      if (!ctx) throw new Error('Music media controls require a 2D canvas context.');
      const active = button.action.action === 'playPause' && transport.playing;
      drawPanelButton(ctx, 256, 128, active ? 'Pause' : button.label, active);
      button.texture.update(true);
    }
  }
  const mediaObserver = onDrillTransportChangedObservable.add(updateMediaButtons);
  updateMediaButtons();

  let enabled = musicStandToggle?.checked ?? false;
  let placedCamera = scene.activeCamera;
  let placed = false;
  let generation = 0;
  let signature = '';
  let rows: { image: HTMLImageElement; height: number; measure: number; beatPositions: number[] }[] = [];
  let latest: MidiScoreDisplay = { rows: [], trackName: '', currentMeasure: 0, currentBeat: 0, message: 'No MIDI loaded.' };
  root.setEnabled(false);

  function draw() {
    ctx!.fillStyle = PANEL_PAPER_COLOR;
    ctx!.fillRect(0, 0, WIDTH, HEIGHT);
    ctx!.fillStyle = '#111827';
    ctx!.font = 'bold 36px Arial';
    ctx!.fillText(latest.trackName || 'Drill music', 50, 55, WIDTH - 100);
    ctx!.font = '26px Arial';
    ctx!.fillText(`${latest.message} | Count ${latest.currentBeat}, beat ${latest.currentBeat % 4 + 1}/4`, 50, 95, WIDTH - 100);
    if (!rows.length) {
      ctx!.fillText('Load MIDI in Settings to display the score.', 50, 200, WIDTH - 100);
    } else {
      const layout = layoutScorePage(rows.map(row => row.height));
      const scale = layout.scale;
      rows.forEach((row, index) => {
        const cell = layout.cells[index];
        const left = 40 + cell.x;
        const y = 140 + cell.y;
        if (row.measure === latest.currentMeasure) {
          ctx!.fillStyle = '#e0eeff';
          ctx!.fillRect(left, y, cell.width, cell.height + cell.labelHeight);
        }
        ctx!.fillStyle = '#475569';
        ctx!.font = `bold ${Math.max(12, 18 * scale)}px Arial`;
        ctx!.fillText(String(row.measure + 1), left + 4, y + cell.labelHeight - 2);
        ctx!.drawImage(row.image, left, y + cell.labelHeight, cell.width, cell.height);
        if (row.measure === latest.currentMeasure) {
          const x = left + (row.beatPositions[latest.currentBeat % 4] - 5) * scale;
          ctx!.strokeStyle = '#d97706';
          ctx!.lineWidth = 5;
          ctx!.beginPath();
          ctx!.moveTo(x, y + cell.labelHeight + 10 * scale);
          ctx!.lineTo(x, y + cell.labelHeight + cell.height - 10 * scale);
          ctx!.stroke();
        }
      });
    }
    texture.update(true);
  }

  const observer = onMidiScoreDisplayChanged.add(async display => {
    latest = display;
    const nextSignature = display.rows.map(row => row.svg).join('');
    if (nextSignature === signature) {
      draw();
      return;
    }
    signature = nextSignature;
    const request = ++generation;
    try {
      const pending = await Promise.all(display.rows.map(async row => {
        const url = URL.createObjectURL(new Blob([row.svg], { type: 'image/svg+xml' }));
        const image = new Image();
        try {
          image.src = url;
          await image.decode();
          return { image, height: row.height, measure: row.measure, beatPositions: row.beatPositions };
        } finally {
          URL.revokeObjectURL(url);
        }
      }));
      if (request !== generation) return;
      rows = pending;
      if (musicStandStatus) musicStandStatus.textContent = '';
      draw();
      updateTopBarButtonsFn?.();
    } catch (error) {
      if (request !== generation) return;
      signature = '';
      rows = [];
      const message = `Could not display music stand score: ${error instanceof Error ? error.message : String(error)}. Toggle the stand to retry.`;
      if (musicStandStatus) musicStandStatus.textContent = message;
      latest = { ...latest, message };
      draw();
    }
  });

  function place() {
    const camera = scene.activeCamera;
    if (!camera) return;
    interaction.placeForViewer({
      desktop: { distance: 1.6, height: 0.12, side: 0.7 },
      xr: { distance: 0.42, height: -0.22 },
      side: 0.3,
      uprightInXR: true,
    });
    placedCamera = camera;
    placed = true;
    root.setEnabled(enabled);
  }
  placeStand = place;
  updateVisibility = visible => {
    enabled = visible;
    if (!enabled) interaction.release();
    else if (!root.isEnabled() && !interaction.userPlaced) place();
    root.setEnabled(enabled && placed);
    setMidiScoreStandVisible(enabled);
  };
  musicStandToggle?.addEventListener('change', () => {
    setMusicStandVisible(musicStandToggle?.checked ?? false);
  });
  musicStandPlaceButton?.addEventListener('click', place);
  musicStandSizeInput?.addEventListener('input', () => {
    if (musicStandSizeInput && musicStandSizeInput.checkValidity() && Number.isFinite(musicStandSizeInput.valueAsNumber)) {
      setMusicStandScale(musicStandSizeInput.valueAsNumber / 100);
    }
  });
  const frameObserver = scene.onBeforeRenderObservable.add(() => {
    if (enabled && (!placed || (!interaction.userPlaced && placedCamera !== scene.activeCamera))) place();
  });
  scene.onDisposeObservable.addOnce(() => {
    generation++;
    updateTopBarButtonsFn = null;
    updateVisibility = null;
    placeStand = null;
    deskNode = null;
    onMidiScoreDisplayChanged.remove(observer);
    onDrillTransportChangedObservable.remove(mediaObserver);
    scene.onBeforeRenderObservable.remove(frameObserver);
  });
  draw();
  setMidiScoreStandVisible(enabled);
}
