import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';

const names = new WeakMap<TransformNode, string>();

export function getObjectName(object: TransformNode): string | null {
  return names.get(object) ?? null;
}

export function setObjectName(object: TransformNode, name: string): boolean {
  const trimmed = name.trim();
  if (object.isDisposed() || !trimmed || trimmed.length > 40) return false;
  names.set(object, trimmed);
  return true;
}
