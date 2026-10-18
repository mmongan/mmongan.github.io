import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import type { HandMenuHit } from './handMenu';
import { addInstrumentButtonModel } from './instrumentButtonModel';

export function createSettingsButtonIcon(button: Mesh, action: HandMenuHit, width: number,
  layout: 'inline' | 'stacked' = 'inline') {
  const scene = button.getScene();
  const scale = layout === 'stacked' ? width / 0.12 : 1;
  const offset = layout === 'stacked' ? 0 : width > 0.1 ? -width / 2 + 0.034 : 0;
  const height = layout === 'stacked' ? width * 0.14 : 0;
  if (action.action === 'instrumentPanelSummon') {
    const icon = addInstrumentButtonModel(button, 'trumpet', 0.055 * scale);
    icon.root.position.set(offset, height, -0.025 * scale);
    icon.meshes.forEach(mesh => { mesh.isPickable = true; });
    return icon.meshes;
  }
  const root = new TransformNode(`settingsIcon-${button.name}`, scene);
  root.parent = button;
  root.position.set(offset, height, -0.018 * scale);
  root.scaling.setAll(0.045 * scale);
  const meshes: Mesh[] = [];
  const colors = ['#58d7f5', '#edf5ff', '#ffc65b', '#c478e9'];
  const materials = colors.map((color, index) => {
    const material = new StandardMaterial(`${root.name}Material${index}`, scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.emissiveColor = material.diffuseColor.scale(0.22);
    material.specularColor = new Color3(0.4, 0.4, 0.4);
    material.specularPower = 48;
    return material;
  });
  root.onDisposeObservable.addOnce(() => materials.forEach(material => material.dispose()));
  function part(mesh: Mesh, x: number, y: number, z: number, color: number) {
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.material = materials[color];
    meshes.push(mesh);
    return mesh;
  }
  function box(w: number, h: number, x = 0, y = 0, color = 0, depth = 0.12, z = 0) {
    return part(MeshBuilder.CreateBox(`${root.name}-box`, { width: w, height: h, depth }, scene), x, y, z, color);
  }
  function dot(x: number, y: number, size = 0.18, color = 2) {
    return part(MeshBuilder.CreateSphere(`${root.name}-dot`, { diameter: size, segments: 8 }, scene), x, y, -0.1, color);
  }
  function bar(x1: number, y1: number, x2: number, y2: number, color = 0, thickness = 0.08) {
    const mesh = box(thickness, Math.hypot(x2 - x1, y2 - y1), (x1 + x2) / 2, (y1 + y2) / 2, color);
    mesh.rotation.z = -Math.atan2(x2 - x1, y2 - y1);
    return mesh;
  }
  function ring(diameter = 0.8, x = 0, y = 0, color = 0) {
    const mesh = part(MeshBuilder.CreateTorus(`${root.name}-ring`,
      { diameter, thickness: 0.12, tessellation: 20 }, scene), x, y, -0.02, color);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }
  function sheet(color = 1) {
    box(0.75, 0.95, 0, 0, color);
    for (let row = 0; row < 3; row++) box(0.5, 0.045, 0, 0.25 - row * 0.2, 0, 0.04, -0.09);
  }
  function field(table: boolean, giant: boolean) {
    box(0.95, 0.58, 0, 0.1, 0);
    for (const x of [-0.3, 0, 0.3]) box(0.025, 0.47, x, 0.1, 1, 0.04, -0.09);
    if (table) for (const x of [-0.32, 0.32]) bar(x, -0.12, x, -0.48, 2, 0.12);
    if (giant) {
      dot(0.28, 0.34, 0.22, 2);
      bar(0.28, 0.23, 0.28, -0.15, 2, 0.14);
      bar(0.28, -0.15, 0.13, -0.48, 2);
      bar(0.28, -0.15, 0.43, -0.48, 2);
    }
  }
  if (action.action === 'xrSettingsHide') {
    bar(-0.32, -0.32, 0.32, 0.32, 1, 0.13);
    bar(-0.32, 0.32, 0.32, -0.32, 1, 0.13);
  } else if (action.action === 'xrSettings') {
    ring(0.65);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const tooth = box(0.22, 0.17, Math.cos(angle) * 0.4, Math.sin(angle) * 0.4, 2);
      tooth.rotation.z = angle;
    }
  } else if (action.action === 'xrSetting') {
    if (action.setting === 'seated') {
      box(0.6, 0.12, 0, -0.05, 2);
      box(0.12, 0.6, -0.27, 0.2);
      for (const x of [-0.23, 0.23]) box(0.09, 0.4, x, -0.3, 1);
    } else if (action.setting === 'grid' || action.setting === 'snap') {
      for (const value of [-0.32, 0, 0.32]) {
        box(0.85, 0.045, 0, value);
        box(0.045, 0.85, value);
      }
      if (action.setting === 'snap') { ring(0.45, 0, 0, 2); dot(0, 0, 0.2, 2); }
    } else field(action.setting === 'tabletop', action.setting === 'giant');
  } else if (action.action === 'drillChartPad') {
    sheet();
    for (const x of [-0.2, 0, 0.2]) dot(x, -0.25, 0.1, 3);
  } else if (action.action === 'musicStandSummon') {
    for (let y = -0.2; y <= 0.2; y += 0.1) box(0.9, 0.025, 0, y, 1);
    dot(-0.22, -0.25, 0.22, 2); dot(0.25, -0.1, 0.22, 2);
    bar(-0.12, -0.2, -0.12, 0.4, 2); bar(0.35, -0.1, 0.35, 0.4, 2);
    bar(-0.12, 0.4, 0.35, 0.4, 2, 0.12);
  } else if (action.action === 'drawingTool') {
    if (action.tool === 'table') field(true, false);
    else if (action.tool === 'drafting') {
      dot(0, 0.4, 0.18, 2);
      bar(0, 0.35, -0.35, -0.45, 1, 0.1); bar(0, 0.35, 0.35, -0.45, 2, 0.1);
      bar(-0.2, -0.05, 0.2, -0.05);
    } else if (action.tool === 'stencils') {
      ring(0.72);
      box(0.2, 0.2, 0.33, -0.32, 2);
    } else if (action.tool === 'cutters') {
      for (const x of [-0.32, 0.32]) box(0.1, 0.74, x, 0, 2, 0.3);
      for (const y of [-0.32, 0.32]) box(0.74, 0.1, 0, y, 2, 0.3);
    } else {
      const pencil = box(0.17, 0.85, 0, 0, 2);
      pencil.rotation.z = -0.5;
      const tip = part(MeshBuilder.CreateCylinder(`${root.name}-tip`,
        { diameterTop: 0.17, diameterBottom: 0, height: 0.22, tessellation: 6 }, scene), -0.25, -0.46, 0, 1);
      tip.rotation.z = -0.5;
    }
  } else if (action.action === 'marcherPaint') {
    const palette = dot(0, 0, 0.9, 2);
    palette.scaling.set(1, 0.78, 0.24);
    for (const [x, y, color] of [[-0.2, 0.13, 0], [0.08, 0.2, 3], [0.25, -0.04, 1]]) dot(x, y, 0.19, color);
  } else if (action.action === 'fieldProjector') {
    box(0.85, 0.55, -0.05, 0, 1, 0.35);
    ring(0.4, 0.2, 0); dot(0.2, 0, 0.22, 0);
    for (const x of [-0.28, 0.23]) box(0.09, 0.18, x, -0.35, 2);
  } else if (action.action === 'marcherPOV') {
    const eye = ring(0.85);
    eye.scaling.z = 0.6;
    dot(0, 0, 0.3, 2);
  } else if (action.action === 'recallPanels') {
    box(0.65, 0.47, -0.12, 0.12, 1);
    box(0.65, 0.47, 0.12, -0.1, 0, 0.12, -0.16);
    bar(0.3, -0.43, -0.28, -0.43, 2);
    bar(-0.28, -0.43, -0.1, -0.24, 2);
  } else if (action.action === 'commitFormation') {
    box(0.85, 0.7, 0, 0, 1);
    bar(-0.27, 0, -0.07, -0.22, 0, 0.13);
    bar(-0.07, -0.22, 0.3, 0.25, 0, 0.13);
  } else if (action.action === 'undoErase' || action.action === 'redoErase') {
    const direction = action.action === 'undoErase' ? -1 : 1;
    ring(0.65, 0, -0.06, 1);
    bar(0, 0.35, direction * 0.42, 0.35, 2, 0.13);
    bar(direction * 0.42, 0.35, direction * 0.18, 0.55, 2, 0.13);
    bar(direction * 0.42, 0.35, direction * 0.18, 0.15, 2, 0.13);
  }
  return meshes;
}
