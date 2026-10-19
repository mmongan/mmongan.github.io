import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { scene } from '../scene/engine';
import { FIELD_LENGTH_YARDS, FIELD_WIDTH_YARDS } from '../field/constants';
import { FloatingPanel } from '../menu/floatingPanel';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import { drawPanelButton } from '../menu/panelStyle';
import { buildFieldProjectionGeometry, type FieldProjectionPose } from './fieldImageProjectionGeometry';
import { floorCalibrationToggle, fieldProjectorButton, fieldProjectorFile, fieldProjectorToggle,
  fieldProjectorX, fieldProjectorZ, fieldProjectorWidth, fieldProjectorRotation, fieldProjectorOpacity,
  fieldProjectorFitButton, fieldProjectorClearButton, fieldProjectorStatus } from '../ui/dom';

export type FieldProjectorCommand = 'show' | 'hide' | 'toggle' | 'fit' | 'left' | 'right' | 'up' | 'down' |
  'wider' | 'narrower' | 'turnLeft' | 'turnRight' | 'dim' | 'bright';
export const FIELD_PROJECTOR_MAX_BYTES = 16 * 1024 * 1024;
let projector: ReturnType<typeof createFieldImageProjector> | null = null;
export function initFieldImageProjector(fieldRoot: TransformNode, notify: (message: string) => void) {
  projector ??= createFieldImageProjector(fieldRoot, notify);
}
export function executeFieldProjectorAction(command: FieldProjectorCommand) { projector?.action(command); }

function createFieldImageProjector(fieldRoot: TransformNode, notify: (message: string) => void) {
  let pose: FieldProjectionPose = { x: 0, z: 0, width: 40, rotation: 0 };
  let opacity = 0.5, aspect = 1, visible = false, filename = '', revision = 0, disposed = false;
  let texture: DynamicTexture | null = null, projection: Mesh | null = null;
  const material = new StandardMaterial('fieldImageProjectionMaterial', scene);
  material.emissiveColor = Color3.White(); material.disableLighting = true;
  material.backFaceCulling = false; material.disableDepthWrite = true;
  material.useAlphaFromDiffuseTexture = true; material.alpha = opacity;
  const root = new TransformNode('fieldImageProjector', scene);
  const body = MeshBuilder.CreateBox('fieldProjectorBody', { width: 0.43, height: 0.16, depth: 0.2 }, scene);
  body.parent = root; body.position.set(0, 0.035, 0.01);
  const casing = new StandardMaterial('fieldProjectorCasing', scene);
  casing.diffuseColor = new Color3(0.14, 0.18, 0.23); casing.specularPower = 64; body.material = casing;
  const lens = MeshBuilder.CreateCylinder('fieldProjectorLens', { diameter: 0.09, height: 0.09, tessellation: 24 }, scene);
  lens.parent = root; lens.position.set(-0.135, 0.035, -0.12); lens.rotation.x = Math.PI / 2;
  const glass = new StandardMaterial('fieldProjectorGlass', scene);
  glass.diffuseColor = new Color3(0.06, 0.18, 0.22); lens.material = glass;
  const controls = MeshBuilder.CreateBox('fieldProjectorControls', { width: 0.44, height: 0.21, depth: 0.018 }, scene);
  controls.parent = root; controls.position.set(0, -0.17, -0.09);
  const controlsMaterial = new StandardMaterial('fieldProjectorControlsMaterial', scene);
  controlsMaterial.diffuseColor = casing.diffuseColor.clone();
  controlsMaterial.alpha = 0.45;
  controlsMaterial.disableDepthWrite = true;
  controls.material = controlsMaterial;
  const meshes = new Set<AbstractMesh>([body, lens, controls]), buttons = new Map<AbstractMesh, HandMenuHit>();
  const labels: ReadonlyArray<readonly [string, FieldProjectorCommand]> = [
    ['Left', 'left'], ['Right', 'right'], ['Upfield', 'up'], ['Downfield', 'down'],
    ['Wider', 'wider'], ['Narrower', 'narrower'], ['Turn -', 'turnLeft'], ['Turn +', 'turnRight'],
    ['Dim', 'dim'], ['Bright', 'bright'], ['Fit field', 'fit'], ['On / Off', 'toggle'],
    ['Put away', 'hide'],
  ];
  function label(text: string, x: number, y: number, width: number, command?: FieldProjectorCommand) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image projector requires a 2D canvas context.');
    drawPanelButton(context, 512, 128, text);
    const map = new DynamicTexture('fieldProjectorLabelTexture', canvas, scene, false); map.update();
    const buttonMaterial = new StandardMaterial('fieldProjectorLabelMaterial', scene);
    buttonMaterial.diffuseTexture = map; buttonMaterial.emissiveColor = Color3.White(); buttonMaterial.disableLighting = true;
    const mesh = MeshBuilder.CreatePlane('fieldProjectorButton', { width, height: 0.035 }, scene);
    mesh.parent = root; mesh.position.set(x, y, -0.102); mesh.material = buttonMaterial; meshes.add(mesh);
    if (command) {
      const hit: HandMenuHit = { action: 'fieldProjector', command };
      buttons.set(mesh, hit); registerMenuButton(mesh, hit);
    }
    mesh.onDisposeObservable.addOnce(() => buttonMaterial.dispose(false, true));
  }
  labels.forEach(([text, command], index) => label(text, (index % 4 - 1.5) * 0.105,
    -0.1 - Math.floor(index / 4) * 0.045, 0.096, command));
  label('Image projector', 0.065, 0.045, 0.25);
  const panel = new FloatingPanel(root, meshes, root, new Vector3(0.225, 0.28, 0.17), buttons);
  root.setEnabled(false);
  function status(message: string) {
    if (fieldProjectorStatus) fieldProjectorStatus.textContent = message;
    notify(message);
  }
  function sync() {
    if (fieldProjectorToggle) fieldProjectorToggle.checked = visible;
    for (const [input, value] of [[fieldProjectorX, pose.x], [fieldProjectorZ, pose.z],
      [fieldProjectorWidth, pose.width], [fieldProjectorRotation, pose.rotation],
      [fieldProjectorOpacity, opacity]] as const) {
      if (input) input.value = String(value);
    }
    const showing = visible && !floorCalibrationToggle?.checked;
    projection?.setEnabled(showing);
    glass.emissiveColor.set(showing ? 0.1 : 0, showing ? 0.7 : 0, showing ? 1 : 0);
  }
  function rebuild() {
    if (!texture) { sync(); return; }
    projection ??= new Mesh('fieldImageProjection', scene);
    const data = new VertexData(), geometry = buildFieldProjectionGeometry(pose, aspect);
    data.positions = geometry.positions; data.indices = geometry.indices;
    data.uvs = geometry.uvs; data.normals = geometry.normals; data.applyToMesh(projection);
    projection.parent = fieldRoot; projection.material = material;
    projection.isPickable = false; projection.checkCollisions = false; projection.alphaIndex = -10;
    material.alpha = opacity;
    sync();
  }
  function fit() {
    pose = { x: 0, z: 0, rotation: 0,
      width: Math.max(0.5, Math.min(FIELD_WIDTH_YARDS - 2, (FIELD_LENGTH_YARDS - 2) * aspect)) };
  }
  function describe() {
    status(`${filename}: ${visible ? 'projection on' : 'projection off'}, width ${pose.width.toFixed(2)} yd, ` +
      `X ${pose.x.toFixed(2)}, Z ${pose.z.toFixed(2)}, ${pose.rotation.toFixed(0)} degrees, ` +
      `${Math.round(opacity * 100)}% opacity. Trace with the field drawing tools; the image is session-only.`);
  }
  async function upload() {
    const file = fieldProjectorFile?.files?.[0];
    if (!file) return;
    const request = ++revision;
    let bitmap: ImageBitmap | undefined, replacement: DynamicTexture | null = null;
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
      if (!file.size || file.size > FIELD_PROJECTOR_MAX_BYTES) throw new Error('Choose a nonempty image no larger than 16 MB.');
      status(`Loading local tracing image ${file.name}...`);
      bitmap = await createImageBitmap(file);
      if (disposed || request !== revision) return;
      if (!bitmap.width || !bitmap.height) throw new Error('The tracing image has no pixels.');
      const limit = Math.max(1, Math.min(4096, scene.getEngine().getCaps().maxTextureSize));
      const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image projection requires a 2D canvas context.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      replacement = new DynamicTexture('fieldImageProjectionTexture', canvas, scene, true);
      replacement.hasAlpha = true; replacement.update();
      const previous = texture;
      texture = replacement; replacement = null; material.diffuseTexture = texture;
      aspect = bitmap.width / bitmap.height; filename = file.name; visible = true;
      fit(); rebuild(); previous?.dispose();
      describe();
      if (scale < 1) status(`${filename}: resized to ${canvas.width} x ${canvas.height} for GPU texture limits. ` +
        'Projection is ready to trace; original file is unchanged.');
      if (floorCalibrationToggle?.checked) status('Image loaded. Projection is hidden until floor calibration finishes.');
    } catch (error) {
      if (!disposed && request === revision) {
        const message = error instanceof Error ? error.message : String(error);
        status(`Could not load tracing image: ${message} The previous image is unchanged.`);
        console.warn('Could not load field projection image', error);
        sync();
      }
    } finally { bitmap?.close(); replacement?.dispose(); }
  }
  function action(command: FieldProjectorCommand) {
    if (command === 'show') {
      root.setEnabled(true);
      panel.showForViewer({ desktop: { distance: 0.9, height: 0.02 }, xr: { distance: 0.5, height: 0 }, side: 0.35 });
      if (!texture) status('Upload a local PNG, JPEG, or WebP in Settings, then trace its projection with drawing tools.');
      return;
    }
    if (command === 'hide') { panel.release(); root.setEnabled(false); return; }
    if (!texture) { sync(); status('Choose a local image in Settings before using the projector.'); return; }
    if (floorCalibrationToggle?.checked) { sync(); status('Finish floor calibration before aligning the projector.'); return; }
    switch (command) {
      case 'toggle': visible = !visible; break;
      case 'fit': fit(); break;
      case 'left': pose.x = Math.max(-FIELD_WIDTH_YARDS / 2, pose.x - 1); break;
      case 'right': pose.x = Math.min(FIELD_WIDTH_YARDS / 2, pose.x + 1); break;
      case 'up': pose.z = Math.min(FIELD_LENGTH_YARDS / 2, pose.z + 1); break;
      case 'down': pose.z = Math.max(-FIELD_LENGTH_YARDS / 2, pose.z - 1); break;
      case 'wider': pose.width = Math.min(120, pose.width * 1.1); break;
      case 'narrower': pose.width = Math.max(0.5, pose.width / 1.1); break;
      case 'turnLeft': pose.rotation = (pose.rotation + 535) % 360 - 180; break;
      case 'turnRight': pose.rotation = (pose.rotation + 545) % 360 - 180; break;
      case 'dim': opacity = Math.max(0.05, opacity - 0.1); break;
      case 'bright': opacity = Math.min(1, opacity + 0.1); break;
    }
    rebuild(); describe();
  }
  function readNumber(input: HTMLInputElement | null, name: string, min: number, max: number, previous: number) {
    if (!input) return previous;
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${name} must be between ${min} and ${max}.`);
    }
    return value;
  }
  function change() {
    if (!texture) { sync(); status('Choose a local image in Settings before aligning the projection.'); return; }
    if (floorCalibrationToggle?.checked) { sync(); status('Finish floor calibration before aligning the projector.'); return; }
    try {
      const next = {
        x: readNumber(fieldProjectorX, 'Field X', -FIELD_WIDTH_YARDS / 2, FIELD_WIDTH_YARDS / 2, pose.x),
        z: readNumber(fieldProjectorZ, 'Field Z', -FIELD_LENGTH_YARDS / 2, FIELD_LENGTH_YARDS / 2, pose.z),
        width: readNumber(fieldProjectorWidth, 'Image width', 0.5, 120, pose.width),
        rotation: readNumber(fieldProjectorRotation, 'Rotation', -180, 180, pose.rotation),
      };
      const alpha = readNumber(fieldProjectorOpacity, 'Opacity', 0.05, 1, opacity);
      pose = next; opacity = alpha; visible = fieldProjectorToggle?.checked ?? visible;
      rebuild(); describe();
    } catch (error) {
      sync(); status(error instanceof Error ? error.message : String(error));
    }
  }
  function clear() {
    revision++; projection?.dispose(); projection = null;
    material.diffuseTexture = null; texture?.dispose(); texture = null; filename = ''; visible = false;
    if (fieldProjectorFile) fieldProjectorFile.value = '';
    sync(); status('Tracing image removed. Existing drafting guides, formations, and paths are unchanged.');
  }
  const show = () => action('show'), fitImage = () => action('fit');
  const uploadImage = () => { void upload(); };
  const bindings: ReadonlyArray<readonly [HTMLElement | null, string, () => void]> = [
    [fieldProjectorButton, 'click', show], [fieldProjectorFile, 'change', uploadImage],
    [fieldProjectorFitButton, 'click', fitImage], [fieldProjectorClearButton, 'click', clear],
    ...[fieldProjectorToggle, fieldProjectorX, fieldProjectorZ, fieldProjectorWidth, fieldProjectorRotation]
      .map(input => [input, 'change', change] as const),
    [fieldProjectorOpacity, 'input', change],
  ];
  bindings.forEach(([element, event, handler]) => element?.addEventListener(event, handler));
  let calibrating = !!floorCalibrationToggle?.checked;
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (calibrating !== !!floorCalibrationToggle?.checked) {
      calibrating = !!floorCalibrationToggle?.checked; sync();
      if (texture && visible) {
        if (calibrating) status('Projection hidden during floor calibration.'); else describe();
      }
    }
  });
  scene.onDisposeObservable.addOnce(() => {
    disposed = true; revision++;
    scene.onBeforeRenderObservable.remove(observer);
    bindings.forEach(([element, event, handler]) => element?.removeEventListener(event, handler));
    projection?.dispose(); texture?.dispose(); material.dispose();
    root.dispose(); casing.dispose(); controlsMaterial.dispose(); glass.dispose(); projector = null;
  });
  sync();
  return { action };
}
