import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { FloatingPanel } from './floatingPanel';
import { isCameraIntroComplete } from '../camera/desktopCamera';
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

const WIDTH = 1536;
const HEIGHT = 1280;

let standScale = 1.0;
let deskNode: TransformNode | null = null;
let updateTopBarButtonsFn: (() => void) | null = null;
let updateVisibility: ((visible: boolean) => void) | null = null;

export function setMusicStandVisible(visible: boolean) {
  if (musicStandToggle) musicStandToggle.checked = visible;
  updateVisibility?.(visible);
}

export function setMusicStandScale(scale: number) {
  const clamped = Math.max(0.6, Math.min(2.5, Math.round(scale * 10) / 10));
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

export function adjustMusicStandScale(delta: number) {
  setMusicStandScale(standScale + delta);
}

export function getMusicStandScale(): number {
  return standScale;
}

const STAFF_OPTIONS: ('auto' | 4 | 2 | 1)[] = ['auto', 4, 2, 1];

export function cycleMusicStandStaff() {
  const current = getScoreMeasuresConfig();
  let nextIndex = 0;
  const currentIndex = STAFF_OPTIONS.indexOf(current as 'auto' | 4 | 2 | 1);
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
  metal.diffuseColor = new Color3(0.09, 0.1, 0.12);
  metal.specularColor = new Color3(0.3, 0.3, 0.3);
  const backing = MeshBuilder.CreateBox('musicStandBacking', { width: 0.72, height: 0.82, depth: 0.018 }, scene);
  backing.parent = desk;
  backing.position.set(0, -0.02, 0.016);
  backing.material = metal;
  const lip = MeshBuilder.CreateBox('musicStandLip', { width: 0.74, height: 0.025, depth: 0.08 }, scene);
  lip.parent = desk;
  lip.position.set(0, -0.43, -0.012);
  lip.material = metal;
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
    const material = new StandardMaterial(`musicStandButtonMaterial-${action}`, scene);
    material.diffuseTexture = buttonTexture;
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
      name: 'musicStandSizeDecrease',
      action: { action: 'musicStandSizeDecrease' },
      width: 0.11,
      height: 0.05,
      x: -0.27,
      getText: () => 'Pad -',
    },
    {
      name: 'musicStandStaffToggle',
      action: { action: 'musicStandStaffToggle' },
      width: 0.23,
      height: 0.05,
      x: -0.085,
      getText: () => {
        const config = getScoreMeasuresConfig();
        const effective = getEffectiveMeasuresPerPage();
        return config === 'auto' ? `Staff: Auto (${effective})` : `Staff: ${config}m`;
      },
    },
    {
      name: 'musicStandSizeIncrease',
      action: { action: 'musicStandSizeIncrease' },
      width: 0.11,
      height: 0.05,
      x: 0.12,
      getText: () => 'Pad +',
    },
    {
      name: 'musicStandHide',
      action: { action: 'musicStandHide' },
      width: 0.11,
      height: 0.05,
      x: 0.27,
      getText: () => 'Hide',
    },
  ];

  for (const def of topBarDefs) {
    const buttonCanvas = document.createElement('canvas');
    buttonCanvas.width = def.width > 0.2 ? 512 : 256;
    buttonCanvas.height = 96;
    const buttonTexture = new DynamicTexture(`musicStandButtonTexture-${def.name}`, buttonCanvas, scene, false);
    const material = new StandardMaterial(`musicStandButtonMaterial-${def.name}`, scene);
    material.diffuseTexture = buttonTexture;
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
      if (!bCtx) continue;
      bCtx.fillStyle = '#1e293b';
      bCtx.fillRect(0, 0, item.canvas.width, item.canvas.height);
      bCtx.fillStyle = '#38bdf8';
      bCtx.lineWidth = 4;
      bCtx.strokeRect(2, 2, item.canvas.width - 4, item.canvas.height - 4);
      bCtx.fillStyle = '#ffffff';
      bCtx.font = item.canvas.width > 256 ? 'bold 36px Arial' : 'bold 40px Arial';
      bCtx.textAlign = 'center';
      bCtx.textBaseline = 'middle';
      bCtx.fillText(item.getText(), item.canvas.width / 2, item.canvas.height / 2);
      item.texture.update(true);
    }
  }
  updateTopBarButtonsFn = updateTopBarButtons;
  updateTopBarButtons();

  const interaction = new FloatingPanel(root, new Set([backing, lip, sheet, ...buttons.keys()]),
    desk, new Vector3(0.38, 0.44, 0.055), buttons);
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
      ctx.fillStyle = active ? '#245a98' : '#24324f';
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 44px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(active ? 'Pause' : button.label, 128, 64);
      button.texture.update(true);
    }
  }
  const mediaObserver = onDrillTransportChangedObservable.add(updateMediaButtons);
  updateMediaButtons();

  let enabled = musicStandToggle?.checked ?? true;
  let placedCamera = scene.activeCamera;
  let placed = false;
  let generation = 0;
  let signature = '';
  let rows: { image: HTMLImageElement; height: number; measure: number; beatPositions: number[] }[] = [];
  let latest: MidiScoreDisplay = { rows: [], trackName: '', currentMeasure: 0, currentBeat: 0, message: 'No MIDI loaded.' };
  root.setEnabled(false);

  function draw() {
    ctx!.fillStyle = '#fffdf7';
    ctx!.fillRect(0, 0, WIDTH, HEIGHT);
    ctx!.fillStyle = '#111827';
    ctx!.font = 'bold 36px Arial';
    ctx!.fillText(latest.trackName || 'Drill music', 50, 55, WIDTH - 100);
    ctx!.font = '26px Arial';
    ctx!.fillText(`${latest.message} | Count ${latest.currentBeat}, beat ${latest.currentBeat % 4 + 1}/4`, 50, 95, WIDTH - 100);
    if (!rows.length) {
      ctx!.fillText('Load MIDI in Settings to display the score.', 50, 200, WIDTH - 100);
    } else {
      const totalHeight = rows.reduce((sum, row) => sum + row.height + 24, 0);
      const scale = Math.min((WIDTH - 80) / 760, (HEIGHT - 170) / totalHeight);
      let y = 140;
      for (const row of rows) {
        const height = row.height * scale;
        const rowHeight = (row.height + 24) * scale;
        if (row.measure === latest.currentMeasure) {
          ctx!.fillStyle = '#e0eeff';
          ctx!.fillRect(30, y, WIDTH - 60, rowHeight);
        }
        ctx!.fillStyle = '#475569';
        ctx!.font = 'bold 22px Arial';
        ctx!.fillText(String(row.measure + 1), 40, y + 22);
        const left = (WIDTH - 760 * scale) / 2;
        ctx!.drawImage(row.image, left, y + 24 * scale, 760 * scale, height);
        if (row.measure === latest.currentMeasure) {
          const x = left + (row.beatPositions[latest.currentBeat % 4] - 5) * scale;
          ctx!.strokeStyle = '#d97706';
          ctx!.lineWidth = 5;
          ctx!.beginPath();
          ctx!.moveTo(x, y + 24 * scale + 10 * scale);
          ctx!.lineTo(x, y + 24 * scale + height - 10 * scale);
          ctx!.stroke();
        }
        y += rowHeight;
      }
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
    const forward = camera.getForwardRay().direction.clone();
    forward.y = 0;
    if (forward.lengthSquared() < 0.001) forward.set(0, 0, 1);
    forward.normalize();
    const inXR = camera.getClassName() === 'WebXRCamera';
    root.position.copyFrom(camera.globalPosition.add(forward.scale(inXR ? 1.15 : 1.35)));
    root.position.addInPlace(new Vector3(forward.z, 0, -forward.x).scale(0.6));
    root.position.y += inXR ? -0.4 : 0.12;
    interaction.release();
    interaction.userPlaced = false;
    root.rotationQuaternion = Quaternion.FromEulerAngles(0,
      Math.atan2(root.position.x - camera.globalPosition.x, root.position.z - camera.globalPosition.z), 0);
    placedCamera = camera;
    placed = true;
    root.setEnabled(enabled);
  }
  updateVisibility = visible => {
    enabled = visible;
    if (!enabled) interaction.release();
    else if (placed && scene.activeCamera &&
      Vector3.Distance(scene.activeCamera.globalPosition, root.position) > 2.5) place();
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
    if (enabled && (!placed || placedCamera !== scene.activeCamera) && isCameraIntroComplete()) place();
  });
  scene.onDisposeObservable.addOnce(() => {
    generation++;
    updateTopBarButtonsFn = null;
    updateVisibility = null;
    deskNode = null;
    onMidiScoreDisplayChanged.remove(observer);
    onDrillTransportChangedObservable.remove(mediaObserver);
    scene.onBeforeRenderObservable.remove(frameObserver);
  });
  draw();
  setMidiScoreStandVisible(enabled);
}
