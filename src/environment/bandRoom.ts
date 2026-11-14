// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Open-source band rehearsal room surrounding the player in immersive-VR
// tabletop (and other reduced-scale VR) sessions, built procedurally from
// this project's own AGPL low-poly components rather than imported assets.
// The room lives OUTSIDE the AR tabletop transform: it is room-scale,
// floor-aligned to the tracked floor origin, purely decorative (non-pickable,
// no collisions), and hidden on desktop, at full 1:1 VR scale, and in AR
// passthrough where the real room shows instead.

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import { getARScale, getARScaleRange, isARTabletopModeActive } from '../xr/ar';

// Interior footprint in meters, centered on the local-floor origin where the
// player starts; the whiteboard/podium wall faces the player's initial -Z.
const ROOM_WIDTH = 14;
const ROOM_DEPTH = 11;
const ROOM_HEIGHT = 3.4;

let roomRoot: TransformNode | null = null;
let visible = false;

function buildBandRoom(): TransformNode {
  const root = new TransformNode('bandRoom', scene);
  const parts = new Map<StandardMaterial, Mesh[]>();
  const material = (name: string, color: Color3, emissive = false) => {
    const result = new StandardMaterial(name, scene);
    result.diffuseColor = emissive ? Color3.Black() : color;
    result.specularColor = new Color3(0.04, 0.04, 0.04);
    if (emissive) {
      result.emissiveColor = color;
      result.disableLighting = true;
    }
    return result;
  };
  const wall = material('bandRoomWall', new Color3(0.82, 0.79, 0.72));
  const floor = material('bandRoomFloor', new Color3(0.68, 0.5, 0.3));
  const ceiling = material('bandRoomCeiling', new Color3(0.9, 0.9, 0.88));
  // Scene lights point downward, so the ceiling needs its own fill.
  ceiling.emissiveColor = new Color3(0.42, 0.42, 0.4);
  const panel = material('bandRoomPanel', new Color3(0.23, 0.3, 0.4));
  const black = material('bandRoomBlack', new Color3(0.1, 0.1, 0.12));
  const woodDark = material('bandRoomWoodDark', new Color3(0.42, 0.3, 0.19));
  const brass = material('bandRoomBrass', new Color3(0.78, 0.6, 0.22));
  const light = material('bandRoomLight', new Color3(0.98, 0.97, 0.9), true);
  const box = (into: StandardMaterial, width: number, height: number, depth: number,
    x: number, y: number, z: number, yaw = 0, pitch = 0) => {
    const mesh = MeshBuilder.CreateBox('bandRoomPart', { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.rotation.x = pitch;
    const group = parts.get(into) ?? [];
    group.push(mesh);
    parts.set(into, group);
    return mesh;
  };

  // Shell: floor slab, four walls, ceiling.
  box(floor, ROOM_WIDTH, 0.02, ROOM_DEPTH, 0, 0.01, 0);
  box(ceiling, ROOM_WIDTH, 0.06, ROOM_DEPTH, 0, ROOM_HEIGHT, 0);
  box(wall, ROOM_WIDTH, ROOM_HEIGHT, 0.1, 0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2);
  box(wall, ROOM_WIDTH, ROOM_HEIGHT, 0.1, 0, ROOM_HEIGHT / 2, ROOM_DEPTH / 2);
  box(wall, 0.1, ROOM_HEIGHT, ROOM_DEPTH, -ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0);
  box(wall, 0.1, ROOM_HEIGHT, ROOM_DEPTH, ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0);

  // Ceiling fluorescent fixtures.
  for (const x of [-4.2, 0, 4.2]) {
    for (const z of [-2.6, 2.6]) {
      box(light, 1.8, 0.05, 0.6, x, ROOM_HEIGHT - 0.05, z);
    }
  }

  // Acoustic panels along the side and rear walls.
  for (const z of [-3.4, -1.2, 1.2, 3.4]) {
    box(panel, 0.04, 1.6, 1.4, -ROOM_WIDTH / 2 + 0.08, 1.9, z);
    box(panel, 0.04, 1.6, 1.4, ROOM_WIDTH / 2 - 0.08, 1.9, z);
  }
  for (const x of [-4.5, -1.5, 1.5, 4.5]) {
    box(panel, 1.8, 1.4, 0.04, x, 2.1, ROOM_DEPTH / 2 - 0.08);
  }

  // Double door on the right wall, with push bars.
  box(woodDark, 0.06, 2.1, 1.9, ROOM_WIDTH / 2 - 0.09, 1.05, -3.4);
  box(brass, 0.04, 0.05, 0.7, ROOM_WIDTH / 2 - 0.14, 1, -3.75);
  box(brass, 0.04, 0.05, 0.7, ROOM_WIDTH / 2 - 0.14, 1, -3.05);

  // Open instrument cubbies across the rear wall: back panel, top and bottom
  // boards, and dividers standing proud so the bays actually read as bays.
  const shelfWidth = 7.2;
  const shelfZ = ROOM_DEPTH / 2 - 0.35;
  box(woodDark, shelfWidth, 2.2, 0.08, 0, 1.1, shelfZ + 0.21);
  box(woodDark, shelfWidth, 0.06, 0.5, 0, 2.2, shelfZ);
  box(woodDark, shelfWidth, 0.06, 0.5, 0, 0.03, shelfZ);
  for (let column = 0; column <= 6; column++) {
    box(woodDark, 0.06, 2.2, 0.5, -shelfWidth / 2 + 0.03 + column * (shelfWidth - 0.06) / 6, 1.1, shelfZ);
  }
  box(woodDark, shelfWidth, 0.05, 0.5, 0, 1.1, shelfZ);
  // A few brass bells glinting in the cubbies.
  for (const x of [-2.4, 0.6, 1.8]) {
    const bell = MeshBuilder.CreateCylinder('bandRoomPart', { height: 0.1, diameter: 0.36, tessellation: 12 }, scene);
    bell.position.set(x, 1.5, ROOM_DEPTH / 2 - 0.3);
    bell.rotation.x = Math.PI / 2;
    const group = parts.get(brass) ?? [];
    group.push(bell);
    parts.set(brass, group);
  }

  // Whiteboard with staff lines on the front wall, plus a marker tray.
  const board = MeshBuilder.CreatePlane('bandRoomWhiteboard', { width: 4.4, height: 1.7 }, scene);
  board.position.set(0, 1.75, -ROOM_DEPTH / 2 + 0.11);
  const boardTexture = new DynamicTexture('bandRoomWhiteboardTexture', { width: 1024, height: 400 }, scene, false);
  const context = boardTexture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = '#f8f9f7';
  context.fillRect(0, 0, 1024, 400);
  context.strokeStyle = '#2a2f36';
  context.lineWidth = 3;
  for (const top of [70, 230]) {
    for (let line = 0; line < 5; line++) {
      context.beginPath();
      context.moveTo(40, top + line * 22);
      context.lineTo(984, top + line * 22);
      context.stroke();
    }
  }
  boardTexture.update();
  const boardMaterial = new StandardMaterial('bandRoomWhiteboardMaterial', scene);
  boardMaterial.diffuseTexture = boardTexture;
  boardMaterial.emissiveColor = new Color3(0.35, 0.35, 0.35);
  boardMaterial.specularColor = new Color3(0.06, 0.06, 0.06);
  board.material = boardMaterial;
  board.parent = root;
  board.isPickable = false;
  box(black, 4.5, 0.05, 0.08, 0, 0.86, -ROOM_DEPTH / 2 + 0.14);

  // Conductor podium facing the arcs of chairs.
  box(woodDark, 1.1, 0.18, 1.1, 0, 0.09, -3.4);
  box(black, 0.05, 0.9, 0.05, 0, 0.6, -3.7);
  box(black, 0.5, 0.35, 0.03, 0, 1.1, -3.72, 0, -0.45);

  // Three arcs of chairs and music stands facing the podium.
  const focus = new Vector3(0, 0, -3.4);
  for (const [radius, count] of [[2.6, 7], [3.7, 9], [4.8, 11]] as const) {
    for (let seat = 0; seat < count; seat++) {
      const angle = (seat / (count - 1) - 0.5) * Math.PI * 0.72;
      const x = focus.x + Math.sin(angle) * radius;
      const z = focus.z + Math.cos(angle) * radius;
      const yaw = Math.atan2(focus.x - x, focus.z - z);
      // Chair: seat, back, two side leg panels. The back sits opposite the
      // facing direction (sin yaw, cos yaw) toward the podium.
      box(black, 0.42, 0.04, 0.4, x, 0.44, z, yaw);
      box(black, 0.42, 0.44, 0.04, x - Math.sin(yaw) * 0.19, 0.68, z - Math.cos(yaw) * 0.19, yaw);
      box(black, 0.04, 0.44, 0.38, x - Math.cos(yaw) * 0.19, 0.22, z + Math.sin(yaw) * 0.19, yaw);
      box(black, 0.04, 0.44, 0.38, x + Math.cos(yaw) * 0.19, 0.22, z - Math.sin(yaw) * 0.19, yaw);
      // Music stand ~0.5m toward the podium: base, column, tilted desk.
      const standX = x + Math.sin(yaw) * 0.55;
      const standZ = z + Math.cos(yaw) * 0.55;
      box(black, 0.3, 0.03, 0.3, standX, 0.015, standZ, yaw);
      box(black, 0.03, 0.85, 0.03, standX, 0.45, standZ, yaw);
      box(black, 0.42, 0.32, 0.02, standX + Math.sin(yaw) * 0.04, 0.98, standZ + Math.cos(yaw) * 0.04, yaw, -0.5);
    }
  }

  // Merge one mesh per material; everything is static decoration.
  for (const [groupMaterial, meshes] of parts) {
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (!merged) continue;
    merged.name = `bandRoom-${groupMaterial.name}`;
    merged.material = groupMaterial;
    merged.parent = root;
    merged.isPickable = false;
    merged.checkCollisions = false;
    merged.freezeWorldMatrix();
  }
  board.freezeWorldMatrix();
  return root;
}

// Per-frame visibility: only inside an immersive session that is not AR
// passthrough, and only while the field is below full 1:1 scale.
export function updateBandRoomVisibility() {
  const inXR = scene.activeCamera?.getClassName() === 'WebXRCamera';
  const show = inXR && !isARTabletopModeActive() &&
    getARScale() < getARScaleRange().max - 1e-6;
  if (show === visible) return;
  visible = show;
  roomRoot ??= buildBandRoom();
  roomRoot.setEnabled(show);
}

// Build once at startup — after the AR content snapshot, so the room never
// joins the tabletop transform — and keep it hidden until a reduced-scale
// VR session shows it.
export function initBandRoom() {
  roomRoot ??= buildBandRoom();
  roomRoot.setEnabled(false);
}
