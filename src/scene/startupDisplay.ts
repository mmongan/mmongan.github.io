// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// In-scene startup display: a rotating 3D model of the instrument currently
// preloading, plus a floating title/progress panel shown in immersive VR/AR
// (where the DOM title screen is invisible). On desktop only the model shows
// — it appears through the transparent window of the DOM overlay.
//
// Must be created after captureContentRootMeshes() so it never joins the AR
// tabletop transform; it rides the active camera instead.

import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import type { Observer } from '@babylonjs/core/Misc/observable.pure';
import type { Scene } from '@babylonjs/core/scene';
import { scene } from './engine';
import type { MarcherInstrument } from '../robot/robot';
import { addInstrumentButtonModel } from '../menu/instrumentButtonModel';
import { onStartupStateChanged, type StartupState } from '../ui/loadingScreen';

// Closest marching model for each soundfont instrument family.
const MODEL_KEYWORDS: readonly (readonly [RegExp, MarcherInstrument])[] = [
  [/trumpet/, 'trumpet'],
  [/trombone/, 'trombone'],
  [/tuba/, 'sousaphone'],
  [/french_horn|english_horn/, 'mellophone'],
  [/brass/, 'euphonium'],
  [/alto_sax|soprano_sax/, 'altoSax'],
  [/tenor_sax|baritone_sax/, 'bariSax'],
  [/clarinet|oboe|bassoon/, 'clarinet'],
  [/flute|piccolo|recorder|ocarina|whistle|shakuhachi/, 'flute'],
  [/percussion|drum|timpani|taiko|tom|woodblock|agogo/, 'snare'],
  [/glockenspiel|xylophone|vibraphone|marimba|celesta|music_box|tubular|bell|dulcimer|kalimba|piano|clavinet|harpsichord|organ/, 'glockenspiel'],
];

export function startupInstrumentModel(soundfontName: string): MarcherInstrument {
  const match = MODEL_KEYWORDS.find(([pattern]) => pattern.test(soundfontName));
  return match ? match[1] : 'trumpet';
}

const PANEL_WIDTH = 1.1;
const PANEL_HEIGHT = 0.55;
const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 512;
const MODEL_SIZE = 0.55;

export function initStartupDisplay() {
  let disposed = false;
  let root: TransformNode | null = null;
  let panel: Mesh | null = null;
  let texture: DynamicTexture | null = null;
  let modelAnchor: Mesh | null = null;
  let modelPivot: TransformNode | null = null;
  let modelInstrument: MarcherInstrument | null = null;
  let renderObserver: Observer<Scene> | null = null;
  let latest: StartupState | null = null;
  let textureDirty = true;

  function drawPanel() {
    if (!texture || !latest) return;
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    context.fillStyle = 'rgba(12, 20, 33, 0.92)';
    context.strokeStyle = 'rgba(134, 169, 255, 0.8)';
    context.lineWidth = 6;
    context.beginPath();
    context.roundRect(4, 4, TEXTURE_WIDTH - 8, TEXTURE_HEIGHT - 8, 36);
    context.fill();
    context.stroke();
    context.textAlign = 'center';
    context.fillStyle = '#edf4ff';
    context.font = 'bold 86px "Segoe UI", sans-serif';
    context.fillText('OpenChartxr', TEXTURE_WIDTH / 2, 136);
    context.font = '44px "Segoe UI", sans-serif';
    context.fillText('Please wait — starting up…', TEXTURE_WIDTH / 2, 220);
    const barX = 112;
    const barY = 288;
    const barWidth = TEXTURE_WIDTH - 2 * barX;
    context.fillStyle = 'rgba(255, 255, 255, 0.12)';
    context.beginPath();
    context.roundRect(barX, barY, barWidth, 34, 17);
    context.fill();
    if (latest.fraction > 0) {
      context.fillStyle = '#70a8ff';
      context.beginPath();
      context.roundRect(barX, barY, Math.max(34, barWidth * latest.fraction), 34, 17);
      context.fill();
    }
    context.fillStyle = 'rgba(237, 244, 255, 0.78)';
    context.font = '36px "Segoe UI", sans-serif';
    const message = latest.message.length > 56 ? `${latest.message.slice(0, 55)}…` : latest.message;
    context.fillText(message, TEXTURE_WIDTH / 2, 402);
    texture.update();
  }

  function setModel(instrumentName: string | null) {
    const instrument = instrumentName ? startupInstrumentModel(instrumentName) : null;
    if (instrument === modelInstrument || !modelAnchor) return;
    modelInstrument = instrument;
    modelPivot?.dispose(false, true);
    modelPivot = null;
    if (!instrument) return;
    const { root: pivot, meshes } = addInstrumentButtonModel(modelAnchor, instrument, MODEL_SIZE);
    modelPivot = pivot;
    modelPivot.position.setAll(0);
    meshes.forEach(mesh => {
      // Rendering group 3 keeps the model in front of scene geometry, like
      // the existing camera-attached XR notices. Brighten the button-model
      // material so the instrument reads against the scene behind it.
      mesh.renderingGroupId = 3;
      mesh.applyFog = false;
      const material = mesh.material;
      if (material instanceof StandardMaterial) material.emissiveColor = new Color3(0.72, 0.74, 0.8);
    });
  }

  function disposeDisplay() {
    if (disposed) return;
    disposed = true;
    if (renderObserver) scene.onBeforeRenderObservable.remove(renderObserver);
    renderObserver = null;
    modelPivot?.dispose(false, true);
    modelPivot = null;
    root?.dispose(false, true);
    root = null;
  }

  function createDisplay() {
    root = new TransformNode('startupDisplay', scene);
    panel = MeshBuilder.CreatePlane('startupDisplayPanel', { width: PANEL_WIDTH, height: PANEL_HEIGHT }, scene);
    panel.parent = root;
    panel.isPickable = false;
    panel.applyFog = false;
    panel.renderingGroupId = 3;
    texture = new DynamicTexture('startupDisplayTexture', { width: TEXTURE_WIDTH, height: TEXTURE_HEIGHT }, scene, false);
    texture.hasAlpha = true;
    const material = new StandardMaterial('startupDisplayMaterial', scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    panel.material = material;
    panel.onDisposeObservable.add(() => material.dispose(false, true));
    modelAnchor = MeshBuilder.CreateBox('startupDisplayModelAnchor', { size: 0.01 }, scene);
    modelAnchor.parent = root;
    modelAnchor.isVisible = false;
    modelAnchor.isPickable = false;
    renderObserver = scene.onBeforeRenderObservable.add(() => {
      const camera = scene.activeCamera;
      if (!root || !camera) return;
      const inXR = camera.getClassName() === 'WebXRCamera';
      // In XR the panel carries the title and progress; on desktop the DOM
      // overlay does, and only the model shows through its window.
      panel?.setEnabled(inXR);
      if (root.parent !== camera) root.parent = camera;
      root.position.set(0, 0, inXR ? 1.9 : 2.4);
      if (modelAnchor) modelAnchor.position.y = inXR ? 0.52 : 0;
      if (modelPivot) modelPivot.rotation.y += scene.getEngine().getDeltaTime() / 1000;
      if (textureDirty) {
        textureDirty = false;
        drawPanel();
      }
    });
  }

  const unsubscribe = onStartupStateChanged(state => {
    latest = state;
    textureDirty = true;
    if (state.finished || disposed) {
      unsubscribe();
      disposeDisplay();
      return;
    }
    if (!root) createDisplay();
    setModel(state.instrument);
  });
}
