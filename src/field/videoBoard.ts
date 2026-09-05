import * as BABYLON from 'babylonjs';
import { scene } from '../engineScene';

export function createVideoBoard(): void {
  const boardWidth = 24;
  const boardHeight = 13;
  const boardZ = 68;
  const boardY = 14;

  const videoCanvas = document.createElement("canvas");
  videoCanvas.width = 640;
  videoCanvas.height = 360;
  const videoCtx = videoCanvas.getContext("2d")!;

  const bgGradient = videoCtx.createLinearGradient(0, 0, videoCanvas.width, videoCanvas.height);
  bgGradient.addColorStop(0, "#0b1a3d");
  bgGradient.addColorStop(0.5, "#123a6b");
  bgGradient.addColorStop(1, "#0b1a3d");
  videoCtx.fillStyle = bgGradient;
  videoCtx.fillRect(0, 0, videoCanvas.width, videoCanvas.height);

  videoCtx.strokeStyle = "#1c2a4a";
  videoCtx.lineWidth = 8;
  videoCtx.strokeRect(4, 4, videoCanvas.width - 8, videoCanvas.height - 8);

  videoCtx.fillStyle = "#ffcf40";
  videoCtx.font = "bold 78px 'Segoe UI', Arial";
  videoCtx.textAlign = "center";
  videoCtx.textBaseline = "middle";
  videoCtx.fillText("Chartxr", videoCanvas.width / 2, videoCanvas.height * 0.5);

  const barColors = ["#e63946", "#f1a208", "#2a9d8f", "#457b9d", "#e63946"];
  const barWidth = videoCanvas.width / barColors.length;
  for (let i = 0; i < barColors.length; i++) {
    videoCtx.fillStyle = barColors[i];
    videoCtx.fillRect(i * barWidth, videoCanvas.height - 24, barWidth, 24);
  }

  const videoTexture = new BABYLON.DynamicTexture(
    "videoBoardTexture",
    videoCanvas,
    scene,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  videoTexture.update(true);

  const videoMaterial = new BABYLON.StandardMaterial("videoBoardMaterial", scene);
  videoMaterial.diffuseTexture = videoTexture;
  videoMaterial.emissiveColor = new BABYLON.Color3(0.95, 0.95, 0.95);
  videoMaterial.disableLighting = true;
  videoMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
  videoMaterial.backFaceCulling = false;

  const frameMaterial = new BABYLON.StandardMaterial("videoBoardFrameMaterial", scene);
  frameMaterial.diffuseColor = new BABYLON.Color3(0.15, 0.16, 0.18);
  frameMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

  const frame = BABYLON.MeshBuilder.CreateBox(
    "videoBoardFrame",
    { width: boardWidth + 0.8, height: boardHeight + 0.8, depth: 0.7 },
    scene
  );
  frame.position = new BABYLON.Vector3(0, boardY, boardZ);
  frame.material = frameMaterial;

  const screen = BABYLON.MeshBuilder.CreatePlane(
    "videoBoardScreen",
    { width: boardWidth, height: boardHeight },
    scene
  );
  screen.position = new BABYLON.Vector3(0, boardY, boardZ - 0.45);
  screen.material = videoMaterial;

  const poleMaterial = new BABYLON.StandardMaterial("videoBoardPoleMaterial", scene);
  poleMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.21, 0.23);

  // Poles run from the actual field surface (y=-0.5) up to the board frame.
  const videoBoardPoleTopY = boardY - boardHeight / 2 + 0.3;
  const videoBoardPoleHeight = videoBoardPoleTopY - -0.5;
  for (const x of [-4.5, 4.5]) {
    const pole = BABYLON.MeshBuilder.CreateCylinder(
      `videoBoardPole${x}`,
      { diameter: 0.6, height: videoBoardPoleHeight },
      scene
    );
    pole.position = new BABYLON.Vector3(x, -0.5 + videoBoardPoleHeight / 2, boardZ);
    pole.material = poleMaterial;
  }
}
