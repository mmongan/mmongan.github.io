import * as BABYLON from 'babylonjs';
import { scene } from '../scene/engine';
import { GOAL_POST_WIDTH_YARDS } from './constants';

// Build the end-zone goalposts and rebuild them when the field-level presets
// change between high school, college, and NFL dimensions.
export function createGoalPosts(): {
  updateGoalPosts: (level: string) => void;
} {
  const goalPosts = new BABYLON.Mesh("goalPosts", scene);
  const postMaterial = new BABYLON.StandardMaterial("goalPostYellow", scene);
  postMaterial.diffuseColor = new BABYLON.Color3(0.98, 0.78, 0.04);
  postMaterial.specularColor = new BABYLON.Color3(0.3, 0.25, 0.08);
  const padMaterial = new BABYLON.StandardMaterial("goalPostPad", scene);
  padMaterial.diffuseColor = new BABYLON.Color3(0.16, 0.22, 0.32);
  const groundY = -0.5;
  const crossbarY = groundY + 10 / 3;

  function updateGoalPosts(level: string) {
    const postHalfWidth = (GOAL_POST_WIDTH_YARDS[level] ?? GOAL_POST_WIDTH_YARDS.nfl) / 2;
    const uprightHeight = level === "nfl" ? 35 / 3 : 20 / 3;
    goalPosts.getChildMeshes().forEach((mesh) => mesh.dispose());

    for (const goalZ of [-60, 60]) {
      const rearZ = goalZ + Math.sign(goalZ) * 1.6;
      const supportCurve = BABYLON.Curve3.CreateCatmullRomSpline([
        new BABYLON.Vector3(0, groundY, rearZ),
        new BABYLON.Vector3(0, crossbarY - 1.5, rearZ),
        new BABYLON.Vector3(0, crossbarY - 0.7, rearZ - Math.sign(goalZ) * 0.3),
        new BABYLON.Vector3(0, crossbarY - 0.2, goalZ + Math.sign(goalZ) * 0.6),
        new BABYLON.Vector3(0, crossbarY, goalZ),
      ], 8);
      const support = BABYLON.MeshBuilder.CreateTube(
        `goalSupportPost${goalZ}`,
        { path: supportCurve.getPoints(), radius: 0.14, tessellation: 12, cap: BABYLON.Mesh.CAP_ALL },
        scene
      );
      support.material = postMaterial;
      support.parent = goalPosts;

      const pad = BABYLON.MeshBuilder.CreateCylinder(
        `goalPostPad${goalZ}`,
        { diameter: 0.42, height: 1.5, tessellation: 16 },
        scene
      );
      pad.position = new BABYLON.Vector3(0, groundY + 0.75, rearZ);
      pad.material = padMaterial;
      pad.parent = goalPosts;

      const crossbar = BABYLON.MeshBuilder.CreateCylinder(
        `goalCrossbar${goalZ}`,
        { diameter: 0.12, height: postHalfWidth * 2, tessellation: 12 },
        scene
      );
      crossbar.rotation.z = Math.PI / 2;
      crossbar.position = new BABYLON.Vector3(0, crossbarY, goalZ);
      crossbar.material = postMaterial;
      crossbar.parent = goalPosts;

      for (const side of [-1, 1]) {
        const upright = BABYLON.MeshBuilder.CreateCylinder(
          `goalUpright${goalZ}_${side}`,
          { diameter: 0.1, height: uprightHeight, tessellation: 12 },
          scene
        );
        upright.position = new BABYLON.Vector3(side * postHalfWidth, crossbarY + uprightHeight / 2, goalZ);
        upright.material = postMaterial;
        upright.parent = goalPosts;
      }
    }
  }

  return { updateGoalPosts };
}
