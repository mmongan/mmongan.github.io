import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Curve3 } from '@babylonjs/core/Maths/math.path';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { scene } from '../scene/engine';
import { GOAL_POST_WIDTH_YARDS } from './constants';
import { mergeMeshesByMaterial } from './meshMerging';

const GOAL_POST_SIDES = 8;

// Build the end-zone goalposts and rebuild them when the field-level presets
// change between high school, college, and NFL dimensions.
export function createGoalPosts(): {
  updateGoalPosts: (level: string) => void;
} {
  const goalPosts = new Mesh("goalPosts", scene);
  const postMaterial = new StandardMaterial("goalPostYellow", scene);
  postMaterial.diffuseColor = new Color3(0.98, 0.78, 0.04);
  postMaterial.specularColor = new Color3(0.3, 0.25, 0.08);
  const padMaterial = new StandardMaterial("goalPostPad", scene);
  padMaterial.diffuseColor = new Color3(0.16, 0.22, 0.32);
  const groundY = -0.5;
  const crossbarY = groundY + 10 / 3;

  function updateGoalPosts(level: string) {
    const postHalfWidth = (GOAL_POST_WIDTH_YARDS[level] ?? GOAL_POST_WIDTH_YARDS.nfl) / 2;
    const uprightHeight = level === "nfl" ? 35 / 3 : 20 / 3;
    goalPosts.getChildMeshes().forEach((mesh) => mesh.dispose());
    const parts: Mesh[] = [];

    for (const goalZ of [-60, 60]) {
      const rearZ = goalZ + Math.sign(goalZ) * 1.6;
      const supportCurve = Curve3.CreateCatmullRomSpline([
        new Vector3(0, groundY, rearZ),
        new Vector3(0, crossbarY - 1.5, rearZ),
        new Vector3(0, crossbarY - 0.7, rearZ - Math.sign(goalZ) * 0.3),
        new Vector3(0, crossbarY - 0.2, goalZ + Math.sign(goalZ) * 0.6),
        new Vector3(0, crossbarY, goalZ),
      ], 3);
      const support = MeshBuilder.CreateTube(
        `goalSupportPost${goalZ}`,
        { path: supportCurve.getPoints(), radius: 0.14, tessellation: GOAL_POST_SIDES, cap: Mesh.CAP_ALL },
        scene
      );
      support.material = postMaterial;
      parts.push(support);

      const pad = MeshBuilder.CreateCylinder(
        `goalPostPad${goalZ}`,
        { diameter: 0.42, height: 1.5, tessellation: GOAL_POST_SIDES },
        scene
      );
      pad.position = new Vector3(0, groundY + 0.75, rearZ);
      pad.material = padMaterial;
      parts.push(pad);

      const crossbar = MeshBuilder.CreateCylinder(
        `goalCrossbar${goalZ}`,
        { diameter: 0.12, height: postHalfWidth * 2, tessellation: GOAL_POST_SIDES },
        scene
      );
      crossbar.rotation.z = Math.PI / 2;
      crossbar.position = new Vector3(0, crossbarY, goalZ);
      crossbar.material = postMaterial;
      parts.push(crossbar);

      for (const side of [-1, 1]) {
        const upright = MeshBuilder.CreateCylinder(
          `goalUpright${goalZ}_${side}`,
          { diameter: 0.1, height: uprightHeight, tessellation: GOAL_POST_SIDES },
          scene
        );
        upright.position = new Vector3(side * postHalfWidth, crossbarY + uprightHeight / 2, goalZ);
        upright.material = postMaterial;
        parts.push(upright);
      }
    }

    // Both goalposts merge into one yellow mesh and one pad mesh.
    mergeMeshesByMaterial(parts, "goalPosts", goalPosts);
  }

  return { updateGoalPosts };
}
