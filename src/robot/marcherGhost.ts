import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';

export function createMarcherDragGhost(robot: TransformNode, fieldRoot: TransformNode,
  color = new Color3(0.35, 0.8, 1)): TransformNode {
  const scene = robot.getScene();
  const ghost = new TransformNode('marcherDragGhost', scene);
  ghost.parent = fieldRoot;
  const material = new StandardMaterial('marcherDragGhostMaterial', scene);
  material.diffuseColor = color.clone();
  material.emissiveColor = color.scale(0.3);
  material.alpha = 0.28;
  material.disableDepthWrite = true;
  const inverseField = Matrix.Invert(fieldRoot.computeWorldMatrix(true));
  for (const part of robot.getChildMeshes()) {
    if (!part.isEnabled() || !part.isVisible || part.visibility <= 0) continue;
    const source = part instanceof InstancedMesh ? part.sourceMesh : part;
    if (!(source instanceof Mesh) || !source.geometry) continue;
    const mesh = new Mesh('marcherDragGhostPart', scene);
    source.geometry.applyToMesh(mesh);
    mesh.parent = ghost;
    mesh.rotationQuaternion = Quaternion.Identity();
    part.computeWorldMatrix(true).multiply(inverseField).decompose(
      mesh.scaling, mesh.rotationQuaternion, mesh.position
    );
    mesh.material = material;
    mesh.useVertexColors = false;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.layerMask = part.layerMask;
  }
  const observer = robot.onDisposeObservable.addOnce(() => ghost.dispose());
  ghost.onDisposeObservable.addOnce(() => {
    robot.onDisposeObservable.remove(observer);
    material.dispose();
  });
  return ghost;
}
