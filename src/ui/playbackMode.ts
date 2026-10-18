import {
  DESKTOP_PLAYBACK_NOTICE, isDrillEditingEnabled, onEditingModeChangedObservable,
  isDraftingToolsEnabled, onDraftingToolsChangedObservable,
} from '../interaction/editingMode';

export function initPlaybackModeControls() {
  const update = () => {
    const enabled = isDrillEditingEnabled();
    document.querySelectorAll<HTMLElement>('[data-xr-editing]').forEach(element => {
      element.hidden = !enabled;
      element.inert = !enabled;
    });
    document.querySelectorAll<HTMLElement>('[data-drafting-tools]').forEach(element => {
      element.hidden = !enabled || !isDraftingToolsEnabled();
      element.inert = element.hidden;
    });
    const notice = document.getElementById('playbackModeNotice');
    if (notice) {
      notice.hidden = enabled;
      notice.textContent = DESKTOP_PLAYBACK_NOTICE;
    }
  };
  update();
  onEditingModeChangedObservable.add(update);
  onDraftingToolsChangedObservable.add(update);
  for (const type of ['click', 'input', 'change', 'submit', 'contextmenu']) {
    document.addEventListener(type, event => {
      if (!(event.target instanceof Element)) return;
      const blocked = (!isDrillEditingEnabled() && event.target.closest('[data-xr-editing]')) ||
        (!isDraftingToolsEnabled() && event.target.closest('[data-drafting-tools]'));
      if (!blocked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const notice = document.getElementById('playbackModeNotice');
      if (notice) notice.textContent = DESKTOP_PLAYBACK_NOTICE;
    }, true);
  }
}
