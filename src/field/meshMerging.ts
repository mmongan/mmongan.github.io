import { Material } from '@babylonjs/core/Materials/material.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';

// Merge static parts that share a material into one mesh per material, so a
// structure built from many boxes or tubes costs one draw call per material.
// Parts must be unparented so the merged vertices stay in the parent's local
// space; the merged meshes are then attached to `parent`.
export function mergeMeshesByMaterial(parts: Mesh[], name: string, parent: Mesh): Mesh[] {
  const byMaterial = new Map<Material | null, Mesh[]>();
  parts.forEach((part) => {
    const group = byMaterial.get(part.material);
    if (group) group.push(part);
    else byMaterial.set(part.material, [part]);
  });

  const merged: Mesh[] = [];
  byMaterial.forEach((group, material) => {
    const mesh = group.length === 1 ? group[0] : Mesh.MergeMeshes(group, true, true);
    if (!mesh) return;
    mesh.name = `${name}${material ? `_${material.name}` : ""}`;
    mesh.material = material;
    mesh.parent = parent;
    merged.push(mesh);
  });
  return merged;
}
