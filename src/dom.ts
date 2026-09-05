export const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
export const vrButton = document.getElementById("vrButton") as HTMLButtonElement;
export const arButton = document.getElementById("arButton") as HTMLButtonElement;
export const statusText = document.getElementById("statusText");
export const fieldLevelSelect = document.getElementById("fieldLevelSelect") as HTMLSelectElement | null;

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
