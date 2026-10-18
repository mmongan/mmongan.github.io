import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { scene } from '../scene/engine';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import { DetachableFloatingPanel } from '../menu/floatingPanel';
import { drawPanelButton } from '../menu/panelStyle';
import { getDrillTransportState, onDrillTransportChangedObservable } from '../robot/robot';
import { FIELD_WIDTH_YARDS } from './constants';
import { mergeMeshesByMaterial } from './meshMerging';
import {
  isDrillEditingEnabled, onEditingModeChangedObservable, isMenuActionAvailable, onDraftingToolsChangedObservable,
} from '../interaction/editingMode';

const MEDIA_SIGNS = [
  { label: 'REWIND', symbol: '<<', action: 'rewind' },
  { label: 'STEP BACK', symbol: '|<', action: 'stepBack' },
  { label: 'PLAY', symbol: '>', action: 'playPause' },
  { label: 'STEP NEXT', symbol: '>|', action: 'stepForward' },
  { label: 'FAST FORWARD', symbol: '>>', action: 'fastForward' },
] as const;

const PANEL_SIGNS: { label: string; symbol: string; action: HandMenuHit }[] = [
  { label: 'SETTINGS', symbol: 'XR', action: { action: 'xrSettings' } },
  { label: 'CHART', symbol: '[]', action: { action: 'drillChartPad' } },
  { label: 'SCORE', symbol: 'MUSIC', action: { action: 'musicStandSummon' } },
  { label: 'INSTRUMENTS', symbol: 'BAND', action: { action: 'instrumentPanelSummon' } },
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
];

export function createStadiumCrowd(parent: Mesh) {
  const material = (name: string, color: string) => {
    const mat = new StandardMaterial(`stadiumCrowd-${name}`, scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = Color3.Black();
    return mat;
  };
  const shirts = ['#2875b5', '#d95140', '#e5ba38', '#704bb0', '#39a880', '#eeeeee']
    .map((color, index) => material(`shirt${index}`, color));
  const skin = ['#f2c7a5', '#b77c50', '#67432f'].map((color, index) => material(`skin${index}`, color));
  const trousers = material('trousers', '#243247');
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
      const playing = sign.action.action === 'playPause' && getDrillTransportState().playing;
      drawPanelButton(ctx, 512, 320, '');
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 150px Arial';
      ctx.fillText(playing ? '||' : sign.symbol, 256, 124, 460);
      ctx.font = 'bold 49px Arial';
      ctx.fillText(playing ? 'PAUSE' : sign.label, 256, 258, 470);
      texture.update();
    };
    draw();
    return { material: mat, draw };
  });
  let previousPlaying = getDrillTransportState().playing;
  const observer = onDrillTransportChangedObservable.add(state => {
    if (state.playing === previousPlaying) return;
    previousPlaying = state.playing;
    signFaces[2].draw();
  });
  const materials = [...shirts, ...skin, trousers, frameMaterial, ...signFaces.map(face => face.material)];
  const immersiveSigns = new Map<Mesh, HandMenuHit>();
  const updateSigns = () => {
    immersiveSigns.forEach((action, sign) => sign.setEnabled(isDrillEditingEnabled() && isMenuActionAvailable(action)));
  };
  const modeObserver = onEditingModeChangedObservable.add(updateSigns);
  const draftingObserver = onDraftingToolsChangedObservable.add(updateSigns);
  scene.onDisposeObservable.addOnce(() => {
    onDrillTransportChangedObservable.remove(observer);
    onEditingModeChangedObservable.remove(modeObserver);
    onDraftingToolsChangedObservable.remove(draftingObserver);
    materials.forEach(mat => mat.dispose(false, true));
  });
  let parts: Mesh[] = [];

  function box(name: string, x: number, y: number, z: number,
    width: number, height: number, depth: number, mat: StandardMaterial) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.material = mat;
    mesh.isPickable = false;
    parts.push(mesh);
    return mesh;
  }

  function spectator(side: number, x: number, seatY: number, z: number, index: number, raised = false) {
    const shirt = shirts[index % shirts.length];
    const complexion = skin[Math.floor(index / shirts.length) % skin.length];
    box('spectatorTorso', x, seatY + 0.33, z, 0.3, 0.54, 0.44, shirt);
    const head = MeshBuilder.CreateSphere('spectatorHead', { diameter: 0.28, segments: 4 }, scene);
    head.position.set(x, seatY + 0.78, z);
    head.material = complexion;
    head.isPickable = false;
    parts.push(head);
    for (const offset of [-0.15, 0.15]) {
      box('spectatorThigh', x - side * 0.13, seatY + 0.07, z + offset, 0.4, 0.15, 0.14, trousers);
      box('spectatorShin', x - side * 0.29, seatY - 0.12, z + offset, 0.14, 0.36, 0.14, trousers);
      box('spectatorArm', x - side * 0.06, seatY + (raised ? 0.98 : 0.35), z + offset * 1.7,
        0.13, raised ? 0.9 : 0.4, 0.13, raised ? complexion : shirt);
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
        const spacing = row === 0 ? 7 : Math.min(6, (length - 6) / (PANEL_SIGNS.length - 1));
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
          const name = sign.immersive ? `panel-${sign.label}` : sign.action.action;
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
          face.material = signFaces[index + (sign.immersive ? MEDIA_SIGNS.length : 0)].material;
          const action = sign.action;
          registerMenuButton(frame, action);
          registerMenuButton(face, action);
          new DetachableFloatingPanel(frame, new Set([frame, face]), frame,
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
