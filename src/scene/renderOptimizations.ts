// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Per-frame rendering cost reductions. Everything parented under the AR
// transform except the marcher/path subtree is static relative to the field,
// so those world matrices and materials are frozen. Frozen matrices re-sync
// whenever the AR transform itself changes (tabletop gestures, scaling, XR
// floor following, tabletop enter/exit) or the field level is rebuilt.
// Marcher meshes skip per-mesh frustum tests: the band is the focus of every
// view, and evaluating ~1,500 small moving meshes individually costs more
// than drawing the few that momentarily leave the frustum.

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import type { Node } from '@babylonjs/core/node';
import { Matrix } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from './engine';

// Subtrees that move every frame (marchers, routes) or are managed elsewhere.
const DYNAMIC_ROOT_NAMES = new Set(['robotPathRoot']);
const DYNAMIC_NAME_PREFIXES = ['teleport', 'marcher', 'robot', 'pathRobot', 'startupDisplay'];
// Marching band content: always treated as in view instead of per-mesh culled.
const ALWAYS_ACTIVE_PREFIXES = ['marcher', 'robot', 'pathRobot'];

const AR_TRANSFORM_NAMES = ['arPivot', 'arRoot', 'globalScaleRoot'];

function hasDynamicAncestor(node: Node | null): boolean {
  for (let current = node; current; current = current.parent) {
    if (DYNAMIC_ROOT_NAMES.has(current.name)) return true;
  }
  return false;
}

function isUnderARTransform(node: Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (current.name === 'arPivot') return true;
  }
  return false;
}

let frozenMeshes: AbstractMesh[] = [];

// Re-synchronizes frozen world matrices after the field transform or field
// construction changes. Costs one forced matrix compute per static mesh, the
// same work an unfrozen scene would do on its own for the same change.
export function refreshFrozenWorldMatrices() {
  frozenMeshes = frozenMeshes.filter(mesh => !mesh.isDisposed());
  frozenMeshes.forEach(mesh => {
    mesh.unfreezeWorldMatrix();
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  });
}

// Call once after captureContentRootMeshes() has rebased the scene under the
// AR transform and the initial field has been built.
export function applyStaticRenderOptimizations() {
  const markAlwaysActive = (mesh: AbstractMesh) => {
    if (ALWAYS_ACTIVE_PREFIXES.some(prefix => mesh.name.startsWith(prefix))) {
      mesh.alwaysSelectAsActiveMesh = true;
    }
  };
  scene.meshes.forEach(markAlwaysActive);
  scene.onNewMeshAddedObservable.add(markAlwaysActive);

  frozenMeshes = scene.meshes.filter(mesh => isUnderARTransform(mesh) &&
    !hasDynamicAncestor(mesh) &&
    !DYNAMIC_NAME_PREFIXES.some(prefix => mesh.name.startsWith(prefix)));
  frozenMeshes.forEach(mesh => {
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
    mesh.material?.freeze();
  });

  // Watch the AR transform roots; any change re-syncs the frozen matrices.
  const watched = AR_TRANSFORM_NAMES
    .map(name => scene.getTransformNodeByName(name))
    .filter((node): node is NonNullable<typeof node> => !!node);
  const previous = watched.map(node => node.computeWorldMatrix(true).clone());
  scene.onBeforeRenderObservable.add(() => {
    let changed = false;
    watched.forEach((node, index) => {
      const matrix = node.computeWorldMatrix() as Matrix;
      if (!matrix.equals(previous[index])) {
        changed = true;
        previous[index].copyFrom(matrix);
      }
    });
    if (changed) refreshFrozenWorldMatrices();
  });
}
