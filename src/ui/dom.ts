// Shared DOM references for the canvas and application controls.
export const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
export const aslNamingEnabled = document.getElementById("aslNamingEnabled") as HTMLInputElement | null;
export const aslNamingHand = document.getElementById("aslNamingHand") as HTMLSelectElement | null;
export const aslNamingTarget = document.getElementById("aslNamingTarget") as HTMLSelectElement | null;
export const aslTrainingLetter = document.getElementById("aslTrainingLetter") as HTMLSelectElement | null;
export const aslLetterReference = document.getElementById("aslLetterReference") as HTMLOutputElement | null;
export const aslLetterImage = document.getElementById("aslLetterImage") as HTMLImageElement | null;
export const aslTrainedLetters = document.getElementById("aslTrainedLetters") as HTMLOutputElement | null;
export const aslRecordLetter = document.getElementById("aslRecordLetter") as HTMLButtonElement | null;
export const aslAcceptLetter = document.getElementById("aslAcceptLetter") as HTMLButtonElement | null;
export const aslNameText = document.getElementById("aslNameText") as HTMLInputElement | null;
export const aslNamingStatus = document.getElementById("aslNamingStatus") as HTMLOutputElement | null;
export const aslNameBackspace = document.getElementById("aslNameBackspace") as HTMLButtonElement | null;
export const aslNameSpace = document.getElementById("aslNameSpace") as HTMLButtonElement | null;
export const aslApplyName = document.getElementById("aslApplyName") as HTMLButtonElement | null;
export const ghostBandToggle = document.getElementById("ghostBandToggle") as HTMLInputElement | null;
export const ghostBandTimeline = document.getElementById("ghostBandTimeline") as HTMLInputElement | null;
export const ghostBandStatus = document.getElementById("ghostBandStatus") as HTMLOutputElement | null;
export const marcherPOVSelect = document.getElementById("marcherPOVSelect") as HTMLSelectElement | null;
export const marcherPOVStatus = document.getElementById("marcherPOVStatus") as HTMLOutputElement | null;
export const marcherPOVExitButton = document.getElementById("marcherPOVExitButton") as HTMLButtonElement | null;
export const marcherPOVModeButton = document.getElementById("marcherPOVModeButton") as HTMLButtonElement | null;
export const xrModeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="xrMode"]')
);
export const fieldLevelInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="fieldLevel"]')
);
export const videoScreenSizeInput = document.getElementById("videoScreenSize") as HTMLInputElement | null;
export const videoScreenSizeValue = document.getElementById("videoScreenSizeValue") as HTMLOutputElement | null;
export const statusText = document.getElementById("statusText");
export const legBakePanel = document.getElementById("legBakePanel");
export const legBakeLabel = document.getElementById("legBakeLabel");
export const legBakeProgress = document.getElementById("legBakeProgress") as HTMLProgressElement | null;
export const legBakeDetails = document.getElementById("legBakeDetails");
export const legPrebakeButton = document.getElementById("legPrebakeButton") as HTMLButtonElement | null;
export const floorCalibrationToggle = document.getElementById("floorCalibrationToggle") as HTMLInputElement | null;
export const swapControllerRolesToggle = document.getElementById("swapControllerRolesToggle") as HTMLInputElement | null;
export const handThumbJogToggle = document.getElementById("handThumbJogToggle") as HTMLInputElement | null;
export const fieldGridToggle = document.getElementById("fieldGridToggle") as HTMLInputElement | null;
export const fieldGridInterval = document.getElementById("fieldGridInterval") as HTMLInputElement | null;
export const lowPolygonMarchersToggle = document.getElementById("lowPolygonMarchersToggle") as HTMLInputElement | null;
export const midiFileInput = document.getElementById("midiFile") as HTMLInputElement | null;
export const midiAudioButton = document.getElementById("midiAudioButton") as HTMLButtonElement | null;
export const midiPlaybackHint = document.getElementById("midiPlaybackHint") as HTMLOutputElement | null;
export const midiClearButton = document.getElementById("midiClearButton") as HTMLButtonElement | null;
export const midiVolumeInput = document.getElementById("midiVolume") as HTMLInputElement | null;
export const midiStatus = document.getElementById("midiStatus") as HTMLOutputElement | null;
export const midiUrlForm = document.getElementById("midiUrlForm") as HTMLFormElement | null;
export const midiUrlInput = document.getElementById("midiUrl") as HTMLInputElement | null;
export const midiExampleButton = document.getElementById("midiExampleButton") as HTMLButtonElement | null;
export const midiScoreDetails = document.getElementById("midiScore") as HTMLDetailsElement | null;
export const midiScoreTrack = document.getElementById("midiScoreTrack") as HTMLSelectElement | null;
export const midiScoreFollow = document.getElementById("midiScoreFollow") as HTMLInputElement | null;
export const midiScorePrevious = document.getElementById("midiScorePrevious") as HTMLButtonElement | null;
export const midiScoreNext = document.getElementById("midiScoreNext") as HTMLButtonElement | null;
export const midiScoreStatus = document.getElementById("midiScoreStatus") as HTMLOutputElement | null;
export const midiScoreCanvas = document.getElementById("midiScoreCanvas");
export const musicStandToggle = document.getElementById("musicStandToggle") as HTMLInputElement | null;
export const instrumentPanelButton = document.getElementById("instrumentPanelButton") as HTMLButtonElement | null;
export const instrumentPanelToggle = document.getElementById("instrumentPanelToggle") as HTMLInputElement | null;
export const drawingToolsButton = document.getElementById("drawingToolsButton") as HTMLButtonElement | null;
export const draftingToolsButton = document.getElementById("draftingToolsButton") as HTMLButtonElement | null;
export const draftingSpacing = document.getElementById("draftingSpacing") as HTMLInputElement | null;
export const draftingAngle = document.getElementById("draftingAngle") as HTMLSelectElement | null;
export const draftingText = document.getElementById("draftingText") as HTMLInputElement | null;
export const draftingSaveButton = document.getElementById("draftingSaveButton") as HTMLButtonElement | null;
export const draftingRestoreButton = document.getElementById("draftingRestoreButton") as HTMLButtonElement | null;
export const draftingDeleteButton = document.getElementById("draftingDeleteButton") as HTMLButtonElement | null;
export const draftingSaveStatus = document.getElementById("draftingSaveStatus") as HTMLOutputElement | null;
export const draftingCameraButton = document.getElementById("draftingCameraButton") as HTMLButtonElement | null;
export const draftingPhotoRestoreButton = document.getElementById("draftingPhotoRestoreButton") as HTMLButtonElement | null;
export const draftingPhotoDownloadButton = document.getElementById("draftingPhotoDownloadButton") as HTMLButtonElement | null;
export const draftingPhotoPreview = document.getElementById("draftingPhotoPreview") as HTMLImageElement | null;
export const stencilTrayButton = document.getElementById("stencilTrayButton") as HTMLButtonElement | null;
export const cookieCutterTrayButton = document.getElementById("cookieCutterTrayButton") as HTMLButtonElement | null;
export const musicStandPlaceButton = document.getElementById("musicStandPlaceButton") as HTMLButtonElement | null;
export const musicStandStatus = document.getElementById("musicStandStatus") as HTMLOutputElement | null;
export const musicStandSizeInput = document.getElementById("musicStandSize") as HTMLInputElement | null;
export const musicStandSizeValue = document.getElementById("musicStandSizeValue") as HTMLOutputElement | null;
export const musicScoreMeasuresSelect = document.getElementById("musicScoreMeasures") as HTMLSelectElement | null;

export function getNavigationControllerHand(): "left" | "right" {
  return swapControllerRolesToggle?.checked ? "right" : "left";
}

export function getMediaControllerHand(): "left" | "right" {
  return getNavigationControllerHand() === "left" ? "right" : "left";
}
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
export const eraseModeToggle = document.getElementById("eraseModeToggle") as HTMLInputElement | null;
export const undoEraseButton = document.getElementById("undoEraseButton") as HTMLButtonElement | null;
export const redoEraseButton = document.getElementById("redoEraseButton") as HTMLButtonElement | null;
export const drillChartPadToggle = document.getElementById("drillChartPadToggle") as HTMLInputElement | null;
export const marcherInstrumentRadios = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="marcherInstrument"]')
);
export const addRandomRobotsButton = document.getElementById("addRandomRobotsButton") as HTMLButtonElement | null;
export const marcherCountInput = document.getElementById("marcherCount") as HTMLInputElement | null;
export const marcherCountValue = document.getElementById("marcherCountValue") as HTMLOutputElement | null;
export const generateDrillButton = document.getElementById("generateDrillButton") as HTMLButtonElement | null;
export const duplicateDrillButton = document.getElementById("duplicateDrillButton") as HTMLButtonElement | null;
export const duplicateDrillStatus = document.getElementById("duplicateDrillStatus") as HTMLOutputElement | null;
export const openMarchForm = document.getElementById("openMarchForm") as HTMLFormElement | null;
export const openMarchUrlInput = document.getElementById("openMarchUrl") as HTMLInputElement | null;
export const openMarchButton = document.getElementById("openMarchButton") as HTMLButtonElement | null;
export const openMarchExampleButton = document.getElementById("openMarchExampleButton") as HTMLButtonElement | null;
export const openMarchStatus = document.getElementById("openMarchStatus") as HTMLOutputElement | null;
export const drillLabelsToggle = document.getElementById("drillLabelsToggle") as HTMLInputElement | null;
export const showInfo = document.getElementById("showInfo") as HTMLDetailsElement | null;
export const showInfoSummary = document.getElementById("showInfoSummary");
export const showInfoPages = document.getElementById("showInfoPages") as HTMLTableSectionElement | null;
export const showInfoMarchers = document.getElementById("showInfoMarchers") as HTMLTableSectionElement | null;
export const formationEditor = document.getElementById("formationEditor") as HTMLFormElement | null;
export const formationPresetSelect = document.getElementById("formationPreset") as HTMLSelectElement | null;
export const formationSelection = document.getElementById("formationSelection") as HTMLSelectElement | null;
export const formationSpacingInput = document.getElementById("formationSpacing") as HTMLInputElement | null;
export const formationOriginX = document.getElementById("formationOriginX") as HTMLInputElement | null;
export const formationOriginZ = document.getElementById("formationOriginZ") as HTMLInputElement | null;
export const formationMoveX = document.getElementById("formationMoveX") as HTMLInputElement | null;
export const formationMoveZ = document.getElementById("formationMoveZ") as HTMLInputElement | null;
export const formationRotation = document.getElementById("formationRotation") as HTMLInputElement | null;
export const formationScale = document.getElementById("formationScale") as HTMLInputElement | null;
export const formationEditorStatus = document.getElementById("formationEditorStatus") as HTMLOutputElement | null;
export const gridSnapToggle = document.getElementById("gridSnapToggle") as HTMLInputElement | null;
export const gridSnapInterval = document.getElementById("gridSnapInterval") as HTMLSelectElement | null;
export const gridSnapX = document.getElementById("gridSnapX") as HTMLInputElement | null;
export const gridSnapZ = document.getElementById("gridSnapZ") as HTMLInputElement | null;
export const formationLockX = document.getElementById("formationLockX") as HTMLInputElement | null;
export const formationLockZ = document.getElementById("formationLockZ") as HTMLInputElement | null;
export const angleSnapToggle = document.getElementById("angleSnapToggle") as HTMLInputElement | null;
export const selectionEditor = document.getElementById("selectionEditor") as HTMLFormElement;
export const drillSelectionMode = document.getElementById("drillSelectionMode") as HTMLInputElement;
export const drillSetEditMode = document.getElementById("drillSetEditMode") as HTMLInputElement;
export const drillEditSet = document.getElementById("drillEditSet") as HTMLSelectElement;
export const drillSelectionStatus = document.getElementById("drillSelectionStatus") as HTMLOutputElement;
export const drillShapeKind = document.getElementById("drillShapeKind") as HTMLSelectElement;
export const drillShapeInputs = {
  startX: document.getElementById("drillShapeStartX") as HTMLInputElement,
  startZ: document.getElementById("drillShapeStartZ") as HTMLInputElement,
  endX: document.getElementById("drillShapeEndX") as HTMLInputElement,
  endZ: document.getElementById("drillShapeEndZ") as HTMLInputElement,
  controlX: document.getElementById("drillShapeControlX") as HTMLInputElement,
  controlZ: document.getElementById("drillShapeControlZ") as HTMLInputElement,
  control2X: document.getElementById("drillShapeControl2X") as HTMLInputElement,
  control2Z: document.getElementById("drillShapeControl2Z") as HTMLInputElement,
};

export function getSelectedXRMode(): XRSessionMode {
  const selected = xrModeInputs.find((input) => input.checked)?.value as XRSessionMode | undefined;
  return selected || "immersive-vr";
}

export function getSelectedFieldLevel(): string {
  return fieldLevelInputs.find((input) => input.checked)?.value || "highschool";
}
