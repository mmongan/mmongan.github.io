// Shared DOM references for the canvas and application controls.
export const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
export const xrModeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="xrMode"]')
);
export const fieldLevelInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="fieldLevel"]')
);
export const videoScreenSizeInput = document.getElementById("videoScreenSize") as HTMLInputElement | null;
export const videoScreenSizeValue = document.getElementById("videoScreenSizeValue") as HTMLOutputElement | null;
export const statusText = document.getElementById("statusText");
export const floorCalibrationToggle = document.getElementById("floorCalibrationToggle") as HTMLInputElement | null;
export const sittingModeToggle = document.getElementById("sittingModeToggle") as HTMLInputElement | null;
export const fullScaleVRButton = document.getElementById("fullScaleVRButton") as HTMLButtonElement | null;
export const tabletopScaleButton = document.getElementById("tabletopScaleButton") as HTMLButtonElement | null;
export const giantModeButton = document.getElementById("giantModeButton") as HTMLButtonElement | null;
export const roomWidthInput = document.getElementById("roomWidth") as HTMLInputElement | null;
export const roomLengthInput = document.getElementById("roomLength") as HTMLInputElement | null;
export const floorHeightInput = document.getElementById("floorHeight") as HTMLInputElement | null;
export const floorHeightValue = document.getElementById("floorHeightValue") as HTMLOutputElement | null;
export const tableHeightInput = document.getElementById("tableHeight") as HTMLInputElement | null;
export const tableHeightValue = document.getElementById("tableHeightValue") as HTMLOutputElement | null;
export const showAllPathsToggle = document.getElementById("showAllPathsToggle") as HTMLInputElement | null;
export const collisionMarkersToggle = document.getElementById("collisionMarkersToggle") as HTMLInputElement | null;
export const placementModeToggle = document.getElementById("placementModeToggle") as HTMLInputElement | null;
export const addRandomRobotsButton = document.getElementById("addRandomRobotsButton") as HTMLButtonElement | null;
export const marcherCountInput = document.getElementById("marcherCount") as HTMLInputElement | null;
export const marcherCountValue = document.getElementById("marcherCountValue") as HTMLOutputElement | null;
export const generateDrillButton = document.getElementById("generateDrillButton") as HTMLButtonElement | null;

export function getSelectedXRMode(): XRSessionMode {
  const selected = xrModeInputs.find((input) => input.checked)?.value as XRSessionMode | undefined;
  return selected || "immersive-vr";
}

export function getSelectedFieldLevel(): string {
  return fieldLevelInputs.find((input) => input.checked)?.value || "highschool";
}
