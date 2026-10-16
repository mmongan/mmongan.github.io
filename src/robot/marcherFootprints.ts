import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { scene } from '../scene/engine';
import { FIELD_SURFACE_Y } from '../field/constants';
import { marcherFootprintsToggle, marcherFootprintsStatus, floorCalibrationToggle } from '../ui/dom';
import { getRobotFootprintSource } from './robot';
import type { MarcherFootContact } from './marcherFootContacts';

export function buildMarcherFootprintGeometry(contacts: ReadonlyArray<MarcherFootContact>) {
  const positions: number[] = [], indices: number[] = [], normals: number[] = [], colors: number[] = [];
  const outline = [[-0.065, -0.13], [0.065, -0.13], [0.075, 0.07],
    [0.05, 0.16], [-0.045, 0.16], [-0.075, 0.07]];
  contacts.forEach(contact => {
    const { left, yaw } = contact;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const { x, z } = contact.position;
    const base = positions.length / 3;
    for (const [across, along] of [[0, 0], ...outline]) {
      positions.push(x + cos * across + sin * along, FIELD_SURFACE_Y + 0.075,
        z - sin * across + cos * along);
      normals.push(0, 1, 0);
      colors.push(...(left ? [0.2, 0.9, 1, 1] : [1, 0.65, 0.15, 1]));
    }
    for (let vertex = 0; vertex < outline.length; vertex++) {
      indices.push(base, base + 1 + vertex, base + 1 + (vertex + 1) % outline.length);
    }
  });
  return { positions, indices, normals, colors };
}

export function initMarcherFootprints(getSelectedMarcher: () => TransformNode | null) {
  let mesh: Mesh | null = null;
  let signature = '';
  const material = new StandardMaterial('marcherFootprintsMaterial', scene);
  material.diffuseColor = Color3.White();
  material.emissiveColor = Color3.White();
  material.disableLighting = true;
  material.backFaceCulling = false;
  function clear() { mesh?.dispose(); mesh = null; signature = ''; }
  function status(message: string) {
    if (marcherFootprintsStatus && marcherFootprintsStatus.textContent !== message) {
      marcherFootprintsStatus.textContent = message;
    }
  }
  function refresh() {
    if (!marcherFootprintsToggle?.checked || floorCalibrationToggle?.checked) {
      clear();
      status(floorCalibrationToggle?.checked ? 'Footprints hidden during floor calibration.' : 'Marcher footprints off.');
      return;
    }
    const robot = getSelectedMarcher();
    if (!robot || robot.isDisposed() || !robot.isEnabled()) {
      clear(); status('Select a marcher to show their full-route footprints.'); return;
    }
    const source = getRobotFootprintSource(robot);
    if (!source) {
      clear(); status('The selected marcher has no scheduled route.'); return;
    }
    const next = JSON.stringify([robot.uniqueId, robot.parent?.uniqueId, source.key]);
    if (signature === next) return;
    clear();
    const contacts = source.build();
    const geometry = buildMarcherFootprintGeometry(contacts);
    if (!contacts.length) {
      signature = next;
      status('The selected schedule has no animated gait contacts (halt/no moving interval).');
      return;
    }
    mesh = new Mesh('marcherFootprints', scene);
    const data = new VertexData();
    data.positions = geometry.positions; data.indices = geometry.indices;
    data.normals = geometry.normals; data.colors = geometry.colors;
    data.applyToMesh(mesh);
    mesh.parent = robot.parent;
    mesh.material = material;
    mesh.isPickable = false;
    signature = next;
    status(`${contacts.length} gait-contact footprints for the selected marcher. Cyan = left, gold = right. Includes initial planted contacts and subsequent stance entries; repeated mark-time contacts overlap. Sole anchors come from the live leg solver and are projected onto the turf.`);
  }
  marcherFootprintsToggle?.addEventListener('change', refresh);
  const observer = scene.onBeforeRenderObservable.add(refresh);
  scene.onDisposeObservable.addOnce(() => {
    marcherFootprintsToggle?.removeEventListener('change', refresh);
    scene.onBeforeRenderObservable.remove(observer);
    clear(); material.dispose();
  });
  refresh();
}
