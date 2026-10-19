import { floorHeightInput, floorHeightValue, tableHeightInput, tableHeightValue, sittingModeToggle, recallPanelsButton, resetPanelsButton } from '../ui/dom';
import { setFieldHeightSetting } from '../xr/ar';
import { recallFloatingPanels } from './floatingPanel';

recallPanelsButton?.addEventListener("click", recallFloatingPanels);
resetPanelsButton?.addEventListener("click", recallFloatingPanels);

const settingsButton = document.getElementById("settingsButton");
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsCloseButton = document.getElementById("settingsCloseButton");

if (settingsButton && settingsOverlay) {
  settingsButton.addEventListener("click", () => {
    settingsOverlay.classList.add("open");
  });
}

if (settingsCloseButton && settingsOverlay) {
  settingsCloseButton.addEventListener("click", () => {
    settingsOverlay.classList.remove("open");
  });
}

if (settingsOverlay) {
  settingsOverlay.addEventListener("click", (event) => {
    if (event.target === settingsOverlay) {
      settingsOverlay.classList.remove("open");
    }
  });
}

export function setTableHeightForPosture(sitting: boolean, height = sitting ? 0.75 : 1) {
  if (sittingModeToggle) sittingModeToggle.checked = sitting;
  if (tableHeightInput) tableHeightInput.value = String(height);
  if (tableHeightValue) tableHeightValue.value = `${height.toFixed(2)} m`;
  setFieldHeightSetting("table", height);
}

sittingModeToggle?.addEventListener("change", () => {
  setTableHeightForPosture(!!sittingModeToggle?.checked);
});

for (const [mode, input, output] of [
  ["floor", floorHeightInput, floorHeightValue],
  ["table", tableHeightInput, tableHeightValue],
] as const) {
  input?.addEventListener("input", () => {
    if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
      input.reportValidity();
      return;
    }

    setFieldHeightSetting(mode, input.valueAsNumber);
    if (output) output.value = `${input.valueAsNumber.toFixed(2)} m`;
  });
}
