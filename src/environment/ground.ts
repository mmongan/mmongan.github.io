import * as BABYLON from 'babylonjs';
import { scene } from '../engineScene';

// Large horizon ground so the terrain doesn't just stop at a visible edge.
// A circular disc (radius kept inside the fog-out distance) avoids visible
// square corners poking through the haze at the horizon.
export function createHorizonGround(): BABYLON.Mesh {
  const horizonGround = BABYLON.MeshBuilder.CreateDisc(
    "horizonGround",
    { radius: 240, tessellation: 64 },
    scene
  );
  horizonGround.rotation.x = Math.PI / 2;
  horizonGround.position.y = -0.9;
  const horizonGroundMat = new BABYLON.StandardMaterial("horizonGroundMat", scene);
  horizonGroundMat.diffuseColor = new BABYLON.Color3(0.22, 0.32, 0.16);
  horizonGroundMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  horizonGroundMat.backFaceCulling = false;
  horizonGround.material = horizonGroundMat;
  horizonGround.checkCollisions = true;

  return horizonGround;
}
