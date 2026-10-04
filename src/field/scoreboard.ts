import * as BABYLON from 'babylonjs';
import { scene } from '../scene/engine';
import {
  cycleMarchingGait,
  getMarchTempo,
  getInstrumentCarryPose,
  getMarchingGaitIndex,
  MARCHING_GAITS,
  MAX_MARCH_TEMPO_BPM,
  MIN_MARCH_TEMPO_BPM,
  setMarchTempo,
  toggleInstrumentCarryPose,
} from '../robot/robot';

const TEMPO_SLIDER_SCREENS = new Map<BABYLON.AbstractMesh, (worldX: number) => void>();
const GAIT_SELECTOR_SCREENS = new Map<BABYLON.AbstractMesh, (worldX: number) => void>();
const HORN_POSE_SCREENS = new Map<BABYLON.AbstractMesh, () => void>();
const GAIT_SELECTOR_WORLD_Y = 10;
const HORN_POSE_WORLD_Y = 9.34;
const TEMPO_TRACK_WORLD_Y = 8.38;

export function isScoreboardTempoScreen(mesh: BABYLON.AbstractMesh): boolean {
  return TEMPO_SLIDER_SCREENS.has(mesh);
}

export function isScoreboardTempoPick(pick: BABYLON.PickingInfo): boolean {
  return !!pick.pickedMesh && TEMPO_SLIDER_SCREENS.has(pick.pickedMesh) && !!pick.pickedPoint &&
    Math.abs(pick.pickedPoint.y - TEMPO_TRACK_WORLD_Y) <= 0.7;
}

export function updateScoreboardTempoFromPick(pick: BABYLON.PickingInfo): boolean {
  if (!isScoreboardTempoPick(pick) || !pick.pickedMesh || !pick.pickedPoint) return false;
  TEMPO_SLIDER_SCREENS.get(pick.pickedMesh)!(pick.pickedPoint.x);
  return true;
}

export function isScoreboardGaitPick(pick: BABYLON.PickingInfo): boolean {
  return !!pick.pickedMesh && GAIT_SELECTOR_SCREENS.has(pick.pickedMesh) && !!pick.pickedPoint &&
    Math.abs(pick.pickedPoint.y - GAIT_SELECTOR_WORLD_Y) <= 0.7;
}

export function updateScoreboardGaitFromPick(pick: BABYLON.PickingInfo): boolean {
  if (!isScoreboardGaitPick(pick) || !pick.pickedMesh || !pick.pickedPoint) return false;
  GAIT_SELECTOR_SCREENS.get(pick.pickedMesh)!(pick.pickedPoint.x);
  return true;
}

export function isScoreboardHornPosePick(pick: BABYLON.PickingInfo): boolean {
  return !!pick.pickedMesh && HORN_POSE_SCREENS.has(pick.pickedMesh) && !!pick.pickedPoint &&
    Math.abs(pick.pickedPoint.y - HORN_POSE_WORLD_Y) <= 0.55;
}

export function updateScoreboardHornPoseFromPick(pick: BABYLON.PickingInfo): boolean {
  if (!isScoreboardHornPosePick(pick) || !pick.pickedMesh) return false;
  HORN_POSE_SCREENS.get(pick.pickedMesh)!();
  return true;
}

// Create the stadium scoreboard texture and mesh. It is intentionally static in
// this demo, but it renders using a canvas so it is easy to update later.
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

  function drawTempoSlider() {
    const tempo = getMarchTempo();
    const fraction = (tempo - MIN_MARCH_TEMPO_BPM) /
      (MAX_MARCH_TEMPO_BPM - MIN_MARCH_TEMPO_BPM);
    boardCtx.fillStyle = "rgba(20, 35, 26, 0.96)";
    boardCtx.fillRect(72, 178, 368, 74);
    boardCtx.fillStyle = "#b9ffd0";
    boardCtx.font = "bold 16px 'Segoe UI', Arial";
    boardCtx.textAlign = "center";
    boardCtx.textBaseline = "middle";
    boardCtx.fillText(`‹   ${MARCHING_GAITS[getMarchingGaitIndex()].name.toUpperCase()}   ›`, 256, 193);
    boardCtx.fillText(`HORN: ${getInstrumentCarryPose() ? "CARRY" : "PLAY"}`, 256, 211);
    boardCtx.font = "bold 15px 'Segoe UI', Arial";
    boardCtx.fillText(`MARCH TEMPO  ${Math.round(tempo)} BPM`, 256, 227);
    boardCtx.fillStyle = "#53695b";
    boardCtx.fillRect(144, 245, 224, 6);
    boardCtx.fillStyle = "#83f0a2";
    boardCtx.fillRect(144, 245, 224 * fraction, 6);
    boardCtx.beginPath();
    boardCtx.arc(144 + 224 * fraction, 248, 9, 0, Math.PI * 2);
    boardCtx.fill();
    boardTexture.update(true);
  }

  TEMPO_SLIDER_SCREENS.set(screen, (worldX) => {
    const fraction = Math.min(1, Math.max(0, (4 - worldX) / 8));
    setMarchTempo(MIN_MARCH_TEMPO_BPM + fraction * (MAX_MARCH_TEMPO_BPM - MIN_MARCH_TEMPO_BPM));
    drawTempoSlider();
  });
  GAIT_SELECTOR_SCREENS.set(screen, (worldX) => {
    cycleMarchingGait(worldX > 0 ? -1 : 1);
    drawTempoSlider();
  });
  HORN_POSE_SCREENS.set(screen, () => {
    toggleInstrumentCarryPose();
    drawTempoSlider();
  });
  drawTempoSlider();

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
