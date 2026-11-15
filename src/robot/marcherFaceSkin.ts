// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Photorealistic face skin: a painted-face texture on a thin curved plate
// conforming to the skull's front, one shared template per skin tone,
// hardware-instanced per marcher exactly like the robotEyes features it
// stands in for while the Photorealistic-marchers toggle is on. The plate
// carries the only UV-mapped marcher geometry; every other body part stays
// vertex-colored. The 3D nose remains geometry and pokes through the plate,
// and the plate's border pixels are the pure skin tone so it blends into
// the surrounding lathed skin without a seam. This is a painted texture,
// not a photograph, and it never changes the head's silhouette.

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Scene } from '@babylonjs/core/scene.pure';
import { cachedInstrumentTemplate, type ModelTemplate } from './lowPolyInstrument';
import { FRONT_DEPTH, HEAD_SIDES, SKULL_PROFILE } from './robotFaceModel';
import { faceSkinPhotoClear, faceSkinPhotoInput, faceSkinPhotoStatus } from '../ui/dom';

// Vertical span covers the features (lips at 1.186-1.198 up to the brow
// tails at 1.3175) while leaving the chin and crown to the lathed skin.
export const FACE_SKIN_MIN_Y = 1.158;
export const FACE_SKIN_MAX_Y = 1.345;
// Half-arc around the head's vertical axis; wide enough that the brow tails
// (x = 0.067) sit well inside the plate, short of the ears.
export const FACE_SKIN_ARC = Math.PI * 0.27;
// The plate floats just proud of the faceted skull, like the feature boxes
// it replaces, so it never cuts through a facet.
const PLATE_LIFT = 0.004;
const TEXTURE_SIZE = 512;

function skullRadiusAt(y: number): number {
  for (let index = 0; index < SKULL_PROFILE.length - 1; index++) {
    const [radius0, y0] = SKULL_PROFILE[index];
    const [radius1, y1] = SKULL_PROFILE[index + 1];
    if (y >= y0 && y <= y1 && y1 > y0) {
      return radius0 + (radius1 - radius0) * (y - y0) / (y1 - y0);
    }
  }
  return SKULL_PROFILE[SKULL_PROFILE.length - 2][0];
}

function plateRadiusAt(y: number): number {
  return skullRadiusAt(y) * Math.cos(Math.PI / HEAD_SIDES) + PLATE_LIFT;
}

export interface FaceSkinPatch { positions: number[]; indices: number[]; uvs: number[] }

// A smooth cylindrical-ish grid following the skull profile, deepened
// forward by the same FRONT_DEPTH as the head lathe. u wraps the arc left
// to right, v runs chin to brow. The texture carries all facial detail, so
// the grid stays as coarse as the box-feature face it replaces (104
// vertices); smooth normals keep the curve reading round.
export function buildFaceSkinPatch(columns = 12, rows = 7): FaceSkinPatch {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    const y = FACE_SKIN_MIN_Y + (FACE_SKIN_MAX_Y - FACE_SKIN_MIN_Y) * v;
    const radius = plateRadiusAt(y);
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const theta = (u * 2 - 1) * FACE_SKIN_ARC;
      positions.push(Math.sin(theta) * radius, y, Math.cos(theta) * radius * FRONT_DEPTH);
      uvs.push(u, v);
    }
  }
  const stride = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const corner = row * stride + column;
      indices.push(corner, corner + stride, corner + 1,
        corner + 1, corner + stride, corner + stride + 1);
    }
  }
  return { positions, indices, uvs };
}

// Texture-space helpers: map template-space face coordinates through the
// same arc parameterization the patch uses, so painted features land where
// the geometric boxes sat.
function faceUV(x: number, y: number): [number, number] {
  const sine = Math.max(-1, Math.min(1, x / plateRadiusAt(y)));
  return [Math.asin(sine) / FACE_SKIN_ARC * 0.5 + 0.5,
    (y - FACE_SKIN_MIN_Y) / (FACE_SKIN_MAX_Y - FACE_SKIN_MIN_Y)];
}

interface FaceTone {
  skin: string; shade: string; highlight: string; blush: string;
  lipTop: string; lipBottom: string; brow: string; iris: string;
}

// Base skins match MARCHER_SKIN_TEMPLATES exactly (light, medium, dark) so
// the plate blends into the lathed skin around it.
const FACE_SKIN_TONES: FaceTone[] = [
  { skin: '#f2bf96', shade: 'rgba(146,84,52,0.3)', highlight: 'rgba(255,240,225,0.35)',
    blush: 'rgba(216,110,92,0.22)', lipTop: '#8a4a40', lipBottom: '#b06a5a',
    brow: '#3a2a1c', iris: '#5b3b22' },
  { skin: '#a36640', shade: 'rgba(66,34,16,0.32)', highlight: 'rgba(240,200,160,0.3)',
    blush: 'rgba(150,66,52,0.24)', lipTop: '#67302a', lipBottom: '#8d5044',
    brow: '#241812', iris: '#4a2d18' },
  { skin: '#593826', shade: 'rgba(22,11,6,0.35)', highlight: 'rgba(190,140,105,0.28)',
    blush: 'rgba(118,48,42,0.22)', lipTop: '#45211b', lipBottom: '#683a2f',
    brow: '#151009', iris: '#3c2412' },
];

// Shared 2D helpers for painting onto the plate's texture. Canvas
// coordinates for a template-space point: v = 0 is the plate's bottom,
// which DynamicTexture's default invertY puts at the canvas bottom, so
// canvas y counts down from the top.
function facePainting(ctx: CanvasRenderingContext2D, size: number) {
  const point = (x: number, y: number): [number, number] => {
    const [u, v] = faceUV(x, y);
    return [u * size, (1 - v) * size];
  };
  const spanX = (dx: number, atY: number) => point(dx, atY)[0] - point(0, atY)[0];
  const spanY = (dy: number) => dy / (FACE_SKIN_MAX_Y - FACE_SKIN_MIN_Y) * size;
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient) => {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const soft = (x: number, y: number, rx: number, ry: number, color: string) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -y);
    ellipse(x, y, rx, rx, gradient);
    ctx.restore();
  };
  return { point, spanX, spanY, ellipse, soft };
}

function paintFace(ctx: CanvasRenderingContext2D, size: number, tone: FaceTone) {
  const { point, spanX, spanY, ellipse, soft } = facePainting(ctx, size);

  // Base skin; edges stay pure tone for a seamless blend into the 3D skin.
  ctx.fillStyle = tone.skin;
  ctx.fillRect(0, 0, size, size);
  // Gentle modelling: forehead sheen, eye sockets, cheekbones, chin shadow.
  const [foreheadX, foreheadY] = point(0, 1.318);
  soft(foreheadX, foreheadY, spanX(0.05, 1.318), spanY(0.02), tone.highlight);
  for (const side of [-1, 1]) {
    const [socketX, socketY] = point(side * 0.043, 1.287);
    soft(socketX, socketY, spanX(0.03, 1.287), spanY(0.013), tone.shade.replace(/[\d.]+\)/, '0.12)'));
    const [cheekX, cheekY] = point(side * 0.055, 1.24);
    soft(cheekX, cheekY, spanX(0.028, 1.24), spanY(0.02), tone.blush);
  }
  const [chinX, chinY] = point(0, 1.172);
  soft(chinX, chinY, spanX(0.03, 1.172), spanY(0.012), tone.shade.replace(/[\d.]+\)/, '0.14)'));

  // Eyes: almond whites under a dark lash line, shaded iris, pupil, and a
  // catchlight, with a soft crease above, where the box features sat.
  for (const side of [-1, 1]) {
    const [eyeX, eyeY] = point(side * 0.043, 1.284);
    const eyeRx = spanX(0.0215, 1.284);
    const eyeRy = spanY(0.0085);
    ellipse(eyeX, eyeY, eyeRx, eyeRy, '#f4f1ea');
    const irisR = spanY(0.0092);
    const iris = ctx.createRadialGradient(eyeX, eyeY, irisR * 0.2, eyeX, eyeY, irisR);
    iris.addColorStop(0, tone.iris);
    iris.addColorStop(1, '#1d1208');
    ellipse(eyeX, eyeY, irisR, irisR, iris);
    ellipse(eyeX, eyeY, spanY(0.0042), spanY(0.0042), '#0c0906');
    ellipse(eyeX - irisR * 0.35, eyeY - irisR * 0.35, spanY(0.0018), spanY(0.0018), 'rgba(255,255,255,0.9)');
    // Lash line hugging the almond's top edge.
    ctx.strokeStyle = '#241a14';
    ctx.lineWidth = Math.max(1, spanY(0.0024));
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY + eyeRy * 0.1, eyeRx, eyeRy, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    // Soft lid crease.
    ctx.strokeStyle = tone.shade.replace(/[\d.]+\)/, '0.25)');
    ctx.lineWidth = Math.max(1, spanY(0.0016));
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY - spanY(0.004), eyeRx * 1.05, eyeRy * 1.3, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    // Brow: a tapered stroke rising to its peak then easing to the tail.
    const [browIn, browInY] = point(side * 0.021, 1.308);
    const [browPeak, browPeakY] = point(side * 0.046, 1.3165);
    const [browTail, browTailY] = point(side * 0.067, 1.3125);
    ctx.strokeStyle = tone.brow;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, spanY(0.0048));
    ctx.beginPath();
    ctx.moveTo(browIn, browInY);
    ctx.quadraticCurveTo(browPeak, browPeakY - spanY(0.002), browTail, browTailY);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, spanY(0.0026));
    ctx.beginPath();
    ctx.moveTo((browIn + browPeak) / 2, (browInY + browPeakY) / 2 - spanY(0.001));
    ctx.quadraticCurveTo(browPeak, browPeakY - spanY(0.003), browTail, browTailY - spanY(0.0012));
    ctx.stroke();
  }

  // Faint shadow where the 3D nose meets the plate, grounding it.
  const [noseX, noseY] = point(0, 1.212);
  soft(noseX, noseY, spanX(0.016, 1.212), spanY(0.007), tone.shade.replace(/[\d.]+\)/, '0.16)'));

  // Mouth: two-tone lips with a cupid's bow, dark mouth line, and a small
  // lower-lip highlight.
  const [mouthX, mouthY] = point(0, 1.1925);
  const lipRx = spanX(0.0275, 1.1925);
  ctx.fillStyle = tone.lipTop;
  ctx.beginPath();
  ctx.moveTo(mouthX - lipRx, mouthY);
  ctx.quadraticCurveTo(mouthX - lipRx * 0.45, mouthY - spanY(0.006), mouthX - lipRx * 0.14, mouthY - spanY(0.0045));
  ctx.quadraticCurveTo(mouthX, mouthY - spanY(0.003), mouthX + lipRx * 0.14, mouthY - spanY(0.0045));
  ctx.quadraticCurveTo(mouthX + lipRx * 0.45, mouthY - spanY(0.006), mouthX + lipRx, mouthY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tone.lipBottom;
  ctx.beginPath();
  ctx.moveTo(mouthX - lipRx * 0.82, mouthY + spanY(0.0005));
  ctx.quadraticCurveTo(mouthX, mouthY + spanY(0.0085), mouthX + lipRx * 0.82, mouthY + spanY(0.0005));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,16,12,0.55)';
  ctx.lineWidth = Math.max(1, spanY(0.0014));
  ctx.beginPath();
  ctx.moveTo(mouthX - lipRx * 0.9, mouthY);
  ctx.quadraticCurveTo(mouthX, mouthY + spanY(0.001), mouthX + lipRx * 0.9, mouthY);
  ctx.stroke();
  soft(mouthX, mouthY + spanY(0.004), lipRx * 0.3, spanY(0.002), 'rgba(255,230,220,0.3)');
}

// Real faces from local profile images: loaded photos replace the painted
// face inside the same per-tone textures — same plate, same texture slot,
// different pixels. Each of the three complexion groups wears one of the
// first three photos (one photo dresses the whole band). Photos come only
// from local files the user picks; nothing is fetched from any online
// profile, and the images are session-only, never persisted or exported.
const FACE_PHOTO_MAX_BYTES = 16 * 1024 * 1024;
export const FACE_PHOTO_MAX_COUNT = 3;
let facePhotos: ImageBitmap[] = [];
let facePhotoNames: string[] = [];
let photoRevision = 0;

// Which loaded photo a complexion group's texture shows; -1 keeps the
// painted face.
export function photoForTone(tone: number, photoCount: number): number {
  return photoCount > 0 ? tone % photoCount : -1;
}

// Center square crop that trims likely hair and neck bands from a headshot,
// so the photo's face lands on the plate's feature region.
export function faceSkinPhotoCrop(width: number, height: number) {
  const top = height * 0.12;
  const usable = height * 0.74;
  const side = Math.min(width, usable);
  return { sx: (width - side) / 2, sy: top + (usable - side) / 2, sw: side, sh: side };
}

// The photo fills the plate, dissolving into the painted skin tone toward
// the edges so it blends into the lathed skin instead of reading as a
// sticker. The 3D nose still stands proud of the photo.
function paintPhotoFace(ctx: CanvasRenderingContext2D, size: number, tone: FaceTone, photo: ImageBitmap) {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = tone.skin;
  ctx.fillRect(0, 0, size, size);
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;
  const crop = faceSkinPhotoCrop(photo.width, photo.height);
  offCtx.drawImage(photo, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size, size);
  const mask = offCtx.createRadialGradient(size / 2, size * 0.52, size * 0.26,
    size / 2, size * 0.52, size * 0.52);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.72, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  offCtx.globalCompositeOperation = 'destination-in';
  offCtx.fillStyle = mask;
  offCtx.fillRect(0, 0, size, size);
  ctx.drawImage(off, 0, 0);
}

interface FaceSkinTextureEntry { texture: DynamicTexture; tone: number }
const liveFaceTextures = new Set<FaceSkinTextureEntry>();

function paintFaceTexture(entry: FaceSkinTextureEntry) {
  const ctx = entry.texture.getContext() as CanvasRenderingContext2D;
  const photoIndex = photoForTone(entry.tone, facePhotos.length);
  if (photoIndex >= 0) paintPhotoFace(ctx, TEXTURE_SIZE, FACE_SKIN_TONES[entry.tone], facePhotos[photoIndex]);
  else paintFace(ctx, TEXTURE_SIZE, FACE_SKIN_TONES[entry.tone]);
  entry.texture.update();
}

function repaintFaceTextures() {
  liveFaceTextures.forEach(paintFaceTexture);
}

function setPhotoStatus(message: string) {
  if (faceSkinPhotoStatus) faceSkinPhotoStatus.value = message;
}

async function loadFaceSkinPhotos() {
  const files = Array.from(faceSkinPhotoInput?.files ?? []);
  if (!files.length) return;
  const request = ++photoRevision;
  const loaded: ImageBitmap[] = [];
  const names: string[] = [];
  try {
    for (const file of files.slice(0, FACE_PHOTO_MAX_COUNT)) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        throw new Error(`${file.name}: choose PNG, JPEG, or WebP images.`);
      }
      if (!file.size || file.size > FACE_PHOTO_MAX_BYTES) {
        throw new Error(`${file.name}: images must be nonempty and at most 16 MB.`);
      }
      const bitmap = await createImageBitmap(file);
      if (request !== photoRevision) { bitmap.close(); return; }
      if (!bitmap.width || !bitmap.height) {
        bitmap.close();
        throw new Error(`${file.name} has no pixels.`);
      }
      loaded.push(bitmap);
      names.push(file.name);
    }
    facePhotos.forEach(bitmap => bitmap.close());
    facePhotos = loaded;
    facePhotoNames = names;
    repaintFaceTextures();
    const skipped = files.length - names.length;
    setPhotoStatus(`Marchers now wear ${names.join(', ')} (centered headshots work best; ` +
      `session-only, local files only${skipped > 0 ? `; first ${FACE_PHOTO_MAX_COUNT} photos used` : ''}). ` +
      'Enable Photorealistic marchers to see them.');
  } catch (error) {
    loaded.forEach(bitmap => bitmap.close());
    if (request === photoRevision) {
      const message = error instanceof Error ? error.message : String(error);
      setPhotoStatus(`Could not load face photos: ${message} The previous faces are unchanged.`);
      console.warn('Could not load face photos', error);
    }
  }
}

export function clearFaceSkinPhotos() {
  photoRevision++;
  if (!facePhotos.length) return;
  facePhotos.forEach(bitmap => bitmap.close());
  facePhotos = [];
  facePhotoNames = [];
  repaintFaceTextures();
  setPhotoStatus('Face photos cleared; painted faces restored.');
}

export function getFaceSkinPhotoCount(): number {
  return facePhotos.length;
}

faceSkinPhotoInput?.addEventListener('change', () => { void loadFaceSkinPhotos(); });
faceSkinPhotoClear?.addEventListener('click', clearFaceSkinPhotos);

const faceSkinMaterials = new WeakMap<Scene, (StandardMaterial | undefined)[]>();

function getFaceSkinMaterial(scene: Scene, tone: number): StandardMaterial {
  let list = faceSkinMaterials.get(scene);
  if (!list) faceSkinMaterials.set(scene, list = []);
  let material = list[tone];
  if (!material || material.getScene() !== scene) {
    const texture = new DynamicTexture(`marcherFaceSkinTexture${tone}`,
      { width: TEXTURE_SIZE, height: TEXTURE_SIZE }, scene, true);
    const entry: FaceSkinTextureEntry = { texture, tone };
    liveFaceTextures.add(entry);
    texture.onDisposeObservable.addOnce(() => liveFaceTextures.delete(entry));
    // New textures honor any already-loaded photos.
    paintFaceTexture(entry);
    material = new StandardMaterial(`marcherFaceSkinMaterial${tone}`, scene);
    material.diffuseTexture = texture;
    // Skin is matte; only a faint, tight remnant of sheen remains.
    material.specularColor = new Color3(0.03, 0.028, 0.028);
    material.specularPower = 16;
    list[tone] = material;
  }
  return material;
}

function createFaceSkinTemplate(scene: Scene, tone: number): Mesh {
  const patch = buildFaceSkinPatch();
  const normals: number[] = [];
  VertexData.ComputeNormals(patch.positions, patch.indices, normals);
  const data = new VertexData();
  data.positions = patch.positions;
  data.indices = patch.indices;
  data.normals = normals;
  data.uvs = patch.uvs;
  const mesh = new Mesh(`marcherFaceSkinTemplate${tone}`, scene);
  data.applyToMesh(mesh);
  mesh.material = getFaceSkinMaterial(scene, tone);
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

// One template per skin tone, index-aligned with MARCHER_SKIN_TEMPLATES.
// The geometry is identical at both detail levels: the face plate, like the
// robotEyes features it replaces, keeps the expression at every distance.
export const FACE_SKIN_TEMPLATES: readonly ModelTemplate[] = [0, 1, 2].map(
  tone => cachedInstrumentTemplate(scene => createFaceSkinTemplate(scene, tone)));
