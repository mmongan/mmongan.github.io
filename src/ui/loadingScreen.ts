// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Startup progress state shared by the DOM title screen and the in-scene 3D
// startup display. Progress only moves forward, and once startup finishes all
// later reports are ignored (reloading a new MIDI never re-shows either).

const overlay = document.getElementById('startupOverlay');
const bar = document.getElementById('startupBar');
const fill = document.getElementById('startupBarFill');
const detail = document.getElementById('startupDetail');

export interface StartupState {
  fraction: number;
  message: string;
  instrument: string | null;
  finished: boolean;
}

let fraction = 0;
let message = 'Preparing…';
let instrument: string | null = null;
let finished = false;
const listeners = new Set<(state: StartupState) => void>();

function snapshot(): StartupState {
  return { fraction, message, instrument, finished };
}

function notifyListeners() {
  const state = snapshot();
  listeners.forEach(listener => listener(state));
}

// Calls the listener immediately with the current state; returns unsubscribe.
export function onStartupStateChanged(listener: (state: StartupState) => void) {
  listeners.add(listener);
  listener(snapshot());
  return () => { listeners.delete(listener); };
}

export function reportStartupProgress(nextFraction: number, nextMessage?: string) {
  if (finished) return;
  fraction = Math.max(fraction, Math.min(1, nextFraction));
  if (nextMessage) message = nextMessage;
  const percent = Math.round(fraction * 100);
  if (fill) fill.style.width = `${percent}%`;
  bar?.setAttribute('aria-valuenow', String(percent));
  if (nextMessage && detail) detail.textContent = nextMessage;
  notifyListeners();
}

// Names the soundfont instrument currently preloading (null between loads),
// so the 3D display can present a matching instrument model.
export function setStartupInstrument(name: string | null) {
  if (finished || instrument === name) return;
  instrument = name;
  notifyListeners();
}

export function finishStartup() {
  if (finished) return;
  reportStartupProgress(1);
  finished = true;
  instrument = null;
  notifyListeners();
  listeners.clear();
  if (!overlay) return;
  overlay.classList.add('startup-overlay-done');
  window.setTimeout(() => overlay.remove(), 600);
}
