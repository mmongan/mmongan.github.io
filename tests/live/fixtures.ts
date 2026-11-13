// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test as base, expect, type Page, type Route } from '@playwright/test';
import type { OpenChartxrDiagnostics } from '../../src/scene/diagnosticsHooks';

declare global {
  interface Window { __openchartxr?: OpenChartxrDiagnostics }
}

const SOUNDFONT_URLS = 'https://paulrosen.github.io/midi-js-soundfonts/**';
// Only the data fetch; Vite also serves an `example-show.openchart?url` module.
const STARTUP_SHOW_URLS = /\/example-show\.openchart$/;

// 80 samples of 8-bit mono silence: decodable by Web Audio, tiny, offline.
function silentWavDataUri(): string {
  const samples = 80;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(8000, 28);
  buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

const SILENT_SAMPLE = silentWavDataUri();

// MIDI.js format parsed by src/audio/soundfontWorker.ts. One sample per
// instrument; the worker substitutes the nearest sample for every pitch.
function fakeSoundfont(name: string): string {
  return `MIDI.Soundfont.${name} = {"C4":"${SILENT_SAMPLE}",\n}`;
}

export interface HeldRequests {
  // Number of requests currently intercepted.
  readonly count: () => number;
  release: () => void;
}

// Intercepts a URL pattern. With `hold`, every matching request waits until
// release(); otherwise `respond` (or the real network) answers immediately.
async function interceptRequests(page: Page, pattern: string | RegExp, hold: boolean,
  respond: (route: Route) => Promise<void>): Promise<HeldRequests> {
  let release = () => {};
  const gate = hold ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  let count = 0;
  await page.context().route(pattern, async route => {
    count++;
    await gate;
    await respond(route);
  });
  return { count: () => count, release: () => release() };
}

// Serves offline silent soundfonts (dedicated-worker fetches included).
export function routeSoundfonts(page: Page, { hold = false } = {}) {
  return interceptRequests(page, SOUNDFONT_URLS, hold, route => {
    const name = /([^/]+)-mp3\.js(?:\?|$)/.exec(route.request().url())?.[1] ?? 'instrument';
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: fakeSoundfont(name),
    });
  });
}

// Holds the bundled startup show so tests can act before marchers exist.
export function holdStartupShow(page: Page) {
  return interceptRequests(page, STARTUP_SHOW_URLS, true, route => route.continue());
}

export async function openApp(page: Page) {
  await page.goto('?diagnostics');
  await page.waitForFunction(() => !!window.__openchartxr, undefined, { timeout: 60_000 });
}

export async function waitForShowReady(page: Page) {
  await page.waitForFunction(() => {
    const app = window.__openchartxr;
    return !!app && app.startupFinished() && app.marcherCount() > 0 && app.isMidiPlaybackReady();
  }, undefined, { timeout: 90_000 });
}

export function diagnostics<T>(page: Page, read: (app: OpenChartxrDiagnostics) => T): Promise<T> {
  return page.evaluate(`(${read.toString()})(window.__openchartxr)`) as Promise<T>;
}

export async function beat(page: Page): Promise<number> {
  return diagnostics(page, app => app.transport().beat);
}

// Fails a test on uncaught page errors or unexpected console errors.
export const test = base.extend<{ pageErrors: string[]; allowedConsoleErrors: RegExp[] }>({
  allowedConsoleErrors: [[], { option: true }],
  pageErrors: [async ({ page, allowedConsoleErrors }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Headless software WebGL emits driver performance chatter.
      if (/GPU stall|GL Driver Message|WebGL: too many errors/i.test(text)) return;
      if (allowedConsoleErrors.some(pattern => pattern.test(text))) return;
      errors.push(`console.error: ${text}`);
    });
    await use(errors);
    expect(errors, 'No uncaught page errors or unexpected console errors').toEqual([]);
  }, { auto: true }],
});

export { expect };
