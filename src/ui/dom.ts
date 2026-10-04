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
export const fullScaleVRButton = document.getElementById("fullScaleVRButton") as HTMLButtonElement | null;
export const tabletopScaleButton = document.getElementById("tabletopScaleButton") as HTMLButtonElement | null;
export const showAllPathsToggle = document.getElementById("showAllPathsToggle") as HTMLInputElement | null;
export const collisionMarkersToggle = document.getElementById("collisionMarkersToggle") as HTMLInputElement | null;
export const placementModeToggle = document.getElementById("placementModeToggle") as HTMLInputElement | null;
export const addRandomRobotsButton = document.getElementById("addRandomRobotsButton") as HTMLButtonElement | null;
export const add100RobotsButton = document.getElementById("add100RobotsButton") as HTMLButtonElement | null;
export const generateDrillButton = document.getElementById("generateDrillButton") as HTMLButtonElement | null;

export function getSelectedXRMode(): XRSessionMode {
  const selected = xrModeInputs.find((input) => input.checked)?.value as XRSessionMode | undefined;
  return selected || "immersive-vr";
}

export function getSelectedFieldLevel(): string {
  return fieldLevelInputs.find((input) => input.checked)?.value || "highschool";
}

