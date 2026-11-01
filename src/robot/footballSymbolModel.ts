// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import type { Scene } from '@babylonjs/core/scene.pure';
import type { FootballTeam } from './footballPlayGeometry';

const templates = new WeakMap<Scene, Map<FootballTeam, Mesh>>();
export function getFootballSymbolTemplate(scene: Scene, team: FootballTeam, layerMask: number) {
  let cache = templates.get(scene);
  if (!cache) { cache = new Map(); templates.set(scene, cache); }
  let mesh = cache.get(team);
  if (mesh && !mesh.isDisposed()) return mesh;
  if (team === 'offense') {
    mesh = MeshBuilder.CreateTorus('footballSymbolTemplate-O',
      { diameter: 1.8, thickness: .24, tessellation: 24 }, scene);
  } else {
    const parts = [-1, 1].map(side => {
      const part = MeshBuilder.CreateBox('footballSymbolStroke',
        { width: .24, height: .05, depth: 2.2 }, scene);
      part.rotation.y = side * Math.PI / 4;
      return part;
    });
    mesh = Mesh.MergeMeshes(parts, true) ?? undefined;
    if (!mesh) throw new Error('Could not build football X symbol.');
    mesh.name = 'footballSymbolTemplate-X';
  }
  const material = new StandardMaterial(`footballSymbol-${team}`, scene);
  material.diffuseColor = Color3.Black();
  material.emissiveColor = Color3.FromHexString(team === 'offense' ? '#72bcff' : '#ff7777');
  material.disableLighting = true;
  mesh.material = material;
  mesh.layerMask = layerMask;
  mesh.isVisible = false;
  mesh.isPickable = false;
  cache.set(team, mesh);
  return mesh;
}
