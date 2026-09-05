import * as BABYLON from 'babylonjs';
import { scene } from '../engineScene';
import { GOAL_POST_WIDTH_YARDS } from './constants';

export function createGoalPosts(sidelineMat: BABYLON.StandardMaterial): {
  updateGoalPosts: (level: string) => void;
} {
  const goalPosts = new BABYLON.Mesh("goalPosts", scene);

  function updateGoalPosts(level: string) {
    const postHalfWidth = (GOAL_POST_WIDTH_YARDS[level] ?? GOAL_POST_WIDTH_YARDS.nfl) / 2;
    goalPosts.getChildMeshes().forEach((mesh) => mesh.dispose());

    for (const goalZ of [-60, 60]) {
      for (const i of [-1, 1]) {
        const upright = BABYLON.MeshBuilder.CreateCylinder(
          `goalUpright${goalZ}_${i}`,
          { diameter: 0.12, height: 1.6 },
          scene
        );
        upright.position = new BABYLON.Vector3(i * postHalfWidth, 2.9, goalZ);
        upright.material = sidelineMat;
        upright.parent = goalPosts;
      }

      const crossbar = BABYLON.MeshBuilder.CreateBox(
        `goalCrossbar${goalZ}`,
        { width: postHalfWidth * 2, height: 0.12, depth: 0.12 },
        scene
      );
      crossbar.position = new BABYLON.Vector3(0, 2.1, goalZ);
      crossbar.material = sidelineMat;
      crossbar.parent = goalPosts;

      const supportPost = BABYLON.MeshBuilder.CreateCylinder(
        `goalSupportPost${goalZ}`,
        { diameter: 0.16, height: 2.6 },
        scene
      );
      supportPost.position = new BABYLON.Vector3(0, 0.8, goalZ);
      supportPost.material = sidelineMat;
      supportPost.parent = goalPosts;
    }
  }

  return { updateGoalPosts };
}
