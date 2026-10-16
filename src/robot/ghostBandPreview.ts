import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { createMarcherDragGhost } from './marcherGhost';
import type { RobotCount } from './robot';

export class GhostBandPreview {
  private ghosts = new Map<TransformNode, TransformNode>();
  private meshes = new Set<AbstractMesh>();

  constructor(robots: Iterable<TransformNode>) {
    for (const robot of robots) {
      if (!robot.isEnabled() || robot.isDisposed()) continue;
      const ghost = createMarcherDragGhost(robot, robot);
      ghost.name = 'ghostBandMarcher';
      ghost.setParent(robot.parent);
      ghost.position.copyFrom(robot.position);
      ghost.rotationQuaternion = robot.rotationQuaternion?.clone() ??
        Quaternion.FromEulerAngles(robot.rotation.x, robot.rotation.y, robot.rotation.z);
      ghost.scaling.copyFrom(robot.scaling);
      ghost.getChildMeshes().forEach(mesh => {
        mesh.isPickable = true;
        this.meshes.add(mesh);
      });
      this.ghosts.set(robot, ghost);
    }
  }

  owns(mesh: AbstractMesh): boolean {
    return !mesh.isDisposed() && mesh.isEnabled() && this.meshes.has(mesh);
  }

  update(robot: TransformNode, counts: ReadonlyArray<RobotCount>, beat: number) {
    const ghost = this.ghosts.get(robot);
    if (!ghost || ghost.isDisposed() || counts.length === 0) return;
    const bounded = Math.min(counts.length - 1, Math.max(0, beat));
    const index = Math.floor(bounded);
    const from = counts[index];
    const to = counts[Math.min(index + 1, counts.length - 1)];
    const fraction = bounded - index;
    ghost.position.copyFrom(Vector3.Lerp(from.position, to.position, fraction));
    const yaw = from.facingY ?? from.rotationY;
    const nextYaw = to.facingY ?? to.rotationY;
    const delta = Math.atan2(Math.sin(nextYaw - yaw), Math.cos(nextYaw - yaw));
    ghost.rotationQuaternion = Quaternion.FromEulerAngles(0, yaw + delta * fraction, 0);
    ghost.setEnabled(robot.isEnabled());
  }

  dispose() {
    this.ghosts.forEach(ghost => ghost.dispose());
    this.ghosts.clear();
    this.meshes.clear();
  }
}
