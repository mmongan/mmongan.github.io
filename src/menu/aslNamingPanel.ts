import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { FloatingPanel } from './floatingPanel';
import { registerMenuButton, type HandMenuHit } from './handMenu';
import { drawPanelButton } from './panelStyle';
import { ASL_SYMBOLS, getASLLetterImage, getASLLetterReference } from './aslAlphabet';

export type NamingAction = 'toggle' | 'accept' | 'save' | 'backspace' | 'space' | 'record' | 'previous' | 'next';

export function createASLNamingPanel() {
  const root = new TransformNode('aslNamingPanel', scene);
  const meshes = new Set<AbstractMesh>();
  const actions = new Map<AbstractMesh, HandMenuHit>();
  function plane(name: string, width: number, height: number, y: number) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Fingerspelling panel requires a 2D canvas.');
    const texture = new DynamicTexture(name, canvas, scene, false);
    const material = new StandardMaterial(`${name}Material`, scene);
    material.diffuseTexture = texture; material.emissiveColor = Color3.White(); material.disableLighting = true;
    material.backFaceCulling = false;
    const mesh = MeshBuilder.CreatePlane(name, { width, height }, scene);
    mesh.parent = root; mesh.position.y = y; mesh.material = material;
    mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
    meshes.add(mesh);
    return { ctx, texture, mesh };
  }
  const display = plane('aslNamingDisplay', 0.6, 0.22, 0.13);
  display.mesh.isPickable = false;
  const reference = plane('aslAlphabetReference', 0.6, 0.34, 0.43);
  reference.mesh.isPickable = false;
  const controls: [string, NamingAction][] = [
    ['Prev sign', 'previous'], ['Record', 'record'], ['Next sign', 'next'],
    ['Accept', 'accept'], ['Backspace', 'backspace'], ['Space', 'space'],
    ['Apply name', 'save'], ['Close', 'toggle'],
  ];
  controls.forEach(([label, command], index) => {
    const { ctx, texture, mesh } = plane(`aslNaming-${command}`, 0.18, 0.055, -0.025 - Math.floor(index / 3) * 0.07);
    mesh.position.x = (index % 3 - 1) * 0.2;
    drawPanelButton(ctx, 1024, 512, label); texture.update();
    const action: HandMenuHit = { action: 'aslNaming', command };
    actions.set(mesh, action); registerMenuButton(mesh, action);
  });
  meshes.forEach(mesh => { mesh.position.y -= 0.2; });
  const surface = new TransformNode('aslNamingPanelBounds', scene);
  surface.parent = root;
  const panel = new FloatingPanel(root, meshes, surface, new Vector3(0.31, 0.41, 0.01), actions);
  root.setEnabled(false);
  let previousText = '';
  let previousReference = '';
  const images = new Map<string, HTMLImageElement>();
  const failedImages = new Set<string>();
  let latest: [string, string, string, string] = ['', 'A', '', ''];
  root.onDisposeObservable.addOnce(() => {
    images.forEach(image => { image.onload = null; image.onerror = null; });
    images.clear();
  });
  function update(name: string, letter: string, message: string, trained = '') {
    latest = [name, letter, message, trained];
    const entry = getASLLetterReference(letter);
    if (entry && !images.has(entry.letter)) {
      const image = new Image();
      images.set(entry.letter, image);
      image.onload = () => {
        if (root.isDisposed()) return;
        previousReference = '';
        update(...latest);
      };
      image.onerror = () => {
        console.error(`Could not load ASL reference image for ${entry.letter}.`);
        failedImages.add(entry.letter);
        if (root.isDisposed()) return;
        previousReference = '';
        update(...latest);
      };
      const url = getASLLetterImage(entry.letter);
      if (url) image.src = url;
    }
    const referenceKey = `${letter}|${trained}`;
    if (previousReference !== referenceKey) {
      previousReference = referenceKey;
      const { ctx, texture } = reference;
      ctx.fillStyle = '#10232c'; ctx.fillRect(0, 0, 1024, 512);
      ctx.textAlign = 'left'; ctx.font = 'bold 34px Arial'; ctx.fillStyle = '#e0faff';
      ctx.fillText('ASL A-Z / 0-9 | cyan = taught | * = motion', 25, 38, 975);
      ASL_SYMBOLS.forEach((item, index) => {
        ctx.fillStyle = item.letter === entry?.letter ? '#ffd166' :
          trained.split(' ').includes(item.letter) ? '#59e1e8' : '#c1cbd0';
        const x = 30 + index % 13 * 74, y = 80 + Math.floor(index / 13) * 41;
        ctx.fillText(`${item.letter}${item.motion ? '*' : ''}`, x, y);
      });
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 32px Arial';
      ctx.fillText(entry ? `${entry.letter}: ${entry.motion ? 'Motion letter' : 'Held handshape'} | ${trained.split(' ').includes(entry.letter) ? 'Taught' : 'Not taught'}` :
        'Select A-Z or 0-9', 25, 205, 975);
      ctx.fillStyle = '#e0faff'; ctx.font = '30px Arial';
      const image = entry ? images.get(entry.letter) : undefined;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(25, 230, 290, 205);
      if (image?.complete && image.naturalWidth > 0) {
        const scale = Math.min(280 / image.naturalWidth, 195 / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        ctx.drawImage(image, 25 + (290 - width) / 2, 230 + (205 - height) / 2, width, height);
      } else {
        ctx.fillStyle = '#10232c'; ctx.font = '22px Arial';
        ctx.fillText(entry && failedImages.has(entry.letter) ? 'Image unavailable' : 'Loading hand image...', 35, 330, 270);
      }
      ctx.fillStyle = '#e0faff'; ctx.font = '27px Arial';
      let line = '', y = 252;
      for (const word of (entry?.description ?? '').split(' ')) {
        if ((line + word).length > 41) { ctx.fillText(line, 340, y, 655); line = ''; y += 35; }
        line += `${word} `;
      }
      ctx.fillText(line, 340, y, 655);
      ctx.font = '24px Arial'; ctx.fillStyle = '#c1cbd0';
      ctx.fillText('Images: WPClipart, D.-C. Belanger / Commons (public domain).', 25, 460, 975);
      ctx.fillText('Use either signing hand. Learn orientation with an ASL instructor.', 25, 493, 975);
      texture.update();
    }
    const text = `${name}|${letter}|${message}`;
    if (text === previousText) return;
    previousText = text;
    const { ctx, texture } = display;
    ctx.fillStyle = '#10232c'; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#e0faff'; ctx.font = 'bold 42px Arial'; ctx.textAlign = 'left';
    ctx.fillText(`Name: ${name || '(empty)'}`, 30, 70, 960);
    ctx.font = '32px Arial'; ctx.fillText(`Teach letter: ${letter || 'A'} | 1.2 second sample`, 30, 130, 960);
    const words = message.split(' '); let line = '', y = 205;
    for (const word of words) {
      if ((line + word).length > 50) { ctx.fillText(line, 30, y, 960); line = ''; y += 45; }
      line += `${word} `;
    }
    ctx.fillText(line, 30, y, 960); texture.update();
  }
  return {
    panel, update,
    show: () => {
      root.setEnabled(true);
      panel.placeForViewer({ desktop: { distance: 1.1, height: -0.02 }, xr: { distance: 0.75, height: -0.02 }, side: -0.25, uprightInXR: true });
    },
    hide: () => { panel.release(); root.setEnabled(false); },
  };
}
