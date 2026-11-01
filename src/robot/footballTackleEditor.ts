// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { floorCalibrationToggle, footballTackleDefender, footballTackleCarrier, footballTackleCount,
  footballTackleNow, footballTackleAdd, footballTackleEvents, footballTackleRemove, footballTackleStatus } from '../ui/dom';
import { getDrillTransportState } from './robot';
import type { FootballTackleEvent } from './footballTackles';

export type FootballTackleCommand = 'tackleDefender' | 'tackleCarrier' | 'tackleCount' | 'tackleAdd' | 'tackleEvent' | 'tackleRemove';
export function executeFootballTackleCommand(command: FootballTackleCommand) {
  if (command === 'tackleCount') footballTackleNow?.click();
  else if (command === 'tackleAdd') footballTackleAdd?.click();
  else if (command === 'tackleRemove') footballTackleRemove?.click();
  else {
    const select = command === 'tackleDefender' ? footballTackleDefender :
      command === 'tackleCarrier' ? footballTackleCarrier : footballTackleEvents;
    if (!select || !select.options.length) {
      if (footballTackleStatus) footballTackleStatus.value = 'Load a football play with authored tackles to use these controls.';
      return;
    }
    select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
    select.dispatchEvent(new Event('change'));
  }
}

export function initFootballTackleEditor(players: ReadonlyArray<{ id: string; label: string; team: string }>,
  events: FootballTackleEvent[], validate: (event: FootballTackleEvent, others: FootballTackleEvent[]) => void, changed: () => void) {
  const defender = footballTackleDefender, carrier = footballTackleCarrier, count = footballTackleCount;
  const list = footballTackleEvents;
  if (!defender || !carrier || !count || !list || !footballTackleAdd || !footballTackleRemove || !footballTackleNow) {
    return Object.assign(() => {}, { refresh: () => {} });
  }
  defender.replaceChildren(...players.filter(player => player.team === 'defense')
    .map(player => new Option(player.label, player.id)));
  carrier.replaceChildren(...players.filter(player => player.team === 'offense')
    .map(player => new Option(player.label, player.id)));
  const refresh = () => {
    list.replaceChildren(new Option('New tackle', '-1'), ...events.map((event, index) =>
      new Option(`${event.count}: ${event.defenderId} tackles ${event.carrierId}`, String(index))));
  };
  refresh();
  const notify = (message: string) => { if (footballTackleStatus) footballTackleStatus.value = message; };
  const run = (action: () => void) => {
    try {
      if (floorCalibrationToggle?.checked) throw new Error('Finish floor calibration before editing tackles.');
      action();
    } catch (error) {
      console.error('Football tackle edit failed:', error);
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  const now = () => { count.value = String(Math.floor(getDrillTransportState().beat)); };
  const selected = () => {
    const event = events[Number(list.value)];
    if (!event) return;
    defender.value = event.defenderId; carrier.value = event.carrierId; count.value = String(event.count);
  };
  const add = () => run(() => {
    const event = { defenderId: defender.value, carrierId: carrier.value, count: count.value === '' ? NaN : Number(count.value) };
    const index = Number(list.value);
    if (index !== -1 && !events[index]) throw new Error('Select New tackle or a valid authored event.');
    validate(event, events.filter((_, i) => i !== index));
    if (index === -1) events.push(event); else events[index] = event;
    events.sort((a, b) => a.count - b.count);
    refresh(); changed();
    notify(`Tackle saved at count ${event.count}; both players recover after eight counts.`);
  });
  const remove = () => run(() => {
    if (!list.options.length) throw new Error('Select an authored tackle to remove.');
    const index = Number(list.value);
    if (!Number.isInteger(index) || !events[index]) throw new Error('Select a valid tackle event.');
    events.splice(index, 1); refresh(); changed(); notify('Selected tackle removed.');
  });
  footballTackleNow.addEventListener('click', now);
  footballTackleAdd.addEventListener('click', add);
  footballTackleRemove.addEventListener('click', remove);
  list.addEventListener('change', selected);
  notify(`${events.length} scripted tackle events. Edit player routes before adding contact.`);
  return Object.assign(() => {
    footballTackleNow?.removeEventListener('click', now);
    footballTackleAdd?.removeEventListener('click', add);
    footballTackleRemove?.removeEventListener('click', remove);
    list.removeEventListener('change', selected);
    defender.replaceChildren(); carrier.replaceChildren(); list.replaceChildren();
    notify('Load a football play to edit tackles.');
  }, { refresh });
}
