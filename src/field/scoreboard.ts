import * as BABYLON from 'babylonjs';
import { scene } from '../engineScene';

export function createScoreboard(): void {
  const boardWidth = 16;
  const boardHeight = 8;
  const boardZ = -68;
  const boardY = 12;

  const boardCanvas = document.createElement("canvas");
  boardCanvas.width = 512;
  boardCanvas.height = 256;
  const boardCtx = boardCanvas.getContext("2d")!;

  boardCtx.fillStyle = "#0a0f0a";
  boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
  boardCtx.strokeStyle = "#3a4a3a";
  boardCtx.lineWidth = 6;
  boardCtx.strokeRect(3, 3, boardCanvas.width - 6, boardCanvas.height - 6);

  boardCtx.fillStyle = "#ff9d1f";
  boardCtx.font = "bold 34px 'Segoe UI', Arial";
  boardCtx.textAlign = "center";
  boardCtx.fillText("HOME", boardCanvas.width * 0.22, 70);
  boardCtx.fillText("GUEST", boardCanvas.width * 0.78, 70);

  boardCtx.fillStyle = "#f5fff5";
  boardCtx.font = "bold 96px 'Segoe UI', Arial";
  boardCtx.fillText("0", boardCanvas.width * 0.22, 170);
  boardCtx.fillText("0", boardCanvas.width * 0.78, 170);

  boardCtx.fillStyle = "#7fffb0";
  boardCtx.font = "bold 28px 'Segoe UI', Arial";
  boardCtx.fillText("1ST QTR", boardCanvas.width * 0.5, 110);
  boardCtx.fillText("15:00", boardCanvas.width * 0.5, 160);

  const boardTexture = new BABYLON.DynamicTexture(
    "scoreboardTexture",
    boardCanvas,
    scene,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  boardTexture.update(true);

  const boardMaterial = new BABYLON.StandardMaterial("scoreboardMaterial", scene);
  boardMaterial.diffuseTexture = boardTexture;
  boardMaterial.emissiveColor = new BABYLON.Color3(0.9, 0.9, 0.9);
  boardMaterial.disableLighting = true;
  boardMaterial.specularColor = new BABYLON.Color3(0, 0, 0);

  const frameMaterial = new BABYLON.StandardMaterial("scoreboardFrameMaterial", scene);
  frameMaterial.diffuseColor = new BABYLON.Color3(0.15, 0.16, 0.18);
  frameMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

  const frame = BABYLON.MeshBuilder.CreateBox(
    "scoreboardFrame",
    { width: boardWidth + 0.6, height: boardHeight + 0.6, depth: 0.6 },
    scene
  );
  frame.position = new BABYLON.Vector3(0, boardY, boardZ);
  frame.material = frameMaterial;

  const screen = BABYLON.MeshBuilder.CreatePlane(
    "scoreboardScreen",
    { width: boardWidth, height: boardHeight },
    scene
  );
  screen.position = new BABYLON.Vector3(0, boardY, boardZ + 0.4);
  screen.rotation.y = Math.PI;
  screen.material = boardMaterial;

  const poleMaterial = new BABYLON.StandardMaterial("scoreboardPoleMaterial", scene);
  poleMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.21, 0.23);

  // Poles run from the actual field surface (y=-0.5) up to the board frame.
  const scoreboardPoleTopY = boardY - boardHeight / 2 + 0.3;
  const scoreboardPoleHeight = scoreboardPoleTopY - -0.5;
  for (const x of [-3, 3]) {
    const pole = BABYLON.MeshBuilder.CreateCylinder(
      `scoreboardPole${x}`,
      { diameter: 0.5, height: scoreboardPoleHeight },
      scene
    );
    pole.position = new BABYLON.Vector3(x, -0.5 + scoreboardPoleHeight / 2, boardZ);
    pole.material = poleMaterial;
  }
}
