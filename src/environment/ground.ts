import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { scene } from '../scene/engine';

// Large horizon ground so the terrain doesn't just stop at a visible edge.
// A thick disc (radius kept inside the fog-out distance) avoids visible
// square corners poking through the haze at the horizon, and gives it a
// solid slab of depth instead of a paper-thin plane.
export function createHorizonGround(): Mesh {
  const groundThickness = 2;
  const horizonGround = MeshBuilder.CreateCylinder(
    "horizonGround",
    { diameter: 480, height: groundThickness, tessellation: 64 },
    scene
  );
  horizonGround.position.y = -0.9 - groundThickness / 2;
  const horizonGroundMat = new StandardMaterial("horizonGroundMat", scene);
  horizonGroundMat.diffuseColor = new Color3(0.22, 0.32, 0.16);
  horizonGroundMat.specularColor = new Color3(0.05, 0.05, 0.05);
  horizonGroundMat.backFaceCulling = false;
  horizonGround.material = horizonGroundMat;
  horizonGround.checkCollisions = true;

  return horizonGround;
}
