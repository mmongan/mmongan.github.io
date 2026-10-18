import {
  DESKTOP_PLAYBACK_NOTICE, isDrillEditingEnabled, onEditingModeChangedObservable,
} from '../interaction/editingMode';

export function initPlaybackModeControls() {
  const update = () => {
    const enabled = isDrillEditingEnabled();
    document.querySelectorAll<HTMLElement>('[data-xr-editing]').forEach(element => {
      element.hidden = !enabled;
      element.inert = !enabled;
    });
    const notice = document.getElementById('playbackModeNotice');
    if (notice) {
      notice.hidden = enabled;
      notice.textContent = DESKTOP_PLAYBACK_NOTICE;
    }
  };
  update();
  onEditingModeChangedObservable.add(update);
  for (const type of ['click', 'input', 'change', 'submit', 'contextmenu']) {
    document.addEventListener(type, event => {
      if (isDrillEditingEnabled() || !(event.target instanceof Element) ||
        !event.target.closest('[data-xr-editing]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const notice = document.getElementById('playbackModeNotice');
      if (notice) notice.textContent = DESKTOP_PLAYBACK_NOTICE;
    }, true);
  }
}
