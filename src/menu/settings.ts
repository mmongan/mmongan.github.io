import { floorHeightInput, floorHeightValue, tableHeightInput, tableHeightValue, sittingModeToggle } from '../ui/dom';
import { setFieldHeightSetting } from '../xr/ar';

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
for (const [mode, input, output] of [
  ["floor", floorHeightInput, floorHeightValue],
  ["table", tableHeightInput, tableHeightValue],
] as const) {
  input?.addEventListener("input", () => {
    if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
      input.reportValidity();
      return;
    }

    sittingModeToggle?.addEventListener("change", () => {
      const height = sittingModeToggle?.checked ? 0.75 : 1;
      if (tableHeightInput) tableHeightInput.value = String(height);
      if (tableHeightValue) tableHeightValue.value = `${height.toFixed(2)} m`;
      setFieldHeightSetting("table", height);
    });
    setFieldHeightSetting(mode, input.valueAsNumber);
    if (output) output.value = `${input.valueAsNumber.toFixed(2)} m`;
  });
}
