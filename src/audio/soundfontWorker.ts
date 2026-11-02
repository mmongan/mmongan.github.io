// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Dedicated worker that downloads a MIDI.js soundfont and extracts the
// required samples as binary audio. The multi-megabyte JSON.parse and
// per-note base64 decodes run here so they can never stall main-thread
// rendering (which freezes the browser on standalone XR headsets).

export interface SoundfontRequest {
  id: number;
  url: string;
  pitches: number[];
}

export interface SoundfontSample {
  pitch: number;
  data: ArrayBuffer;
}

export interface SoundfontResponse {
  id: number;
  samples?: SoundfontSample[];
  error?: string;
}

const NOTE_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteNameToMidi(name: string): number | undefined {
  const match = /^([A-Ga-g])([#b]*)(-?\d+)$/.exec(name.trim());
  if (!match) return undefined;
  let semitone = NOTE_SEMITONES[match[1].toUpperCase()];
  for (const accidental of match[2]) semitone += accidental === '#' ? 1 : -1;
  const midi = 12 * (Number(match[3]) + 1) + semitone;
  return Number.isInteger(midi) && midi >= 0 && midi <= 127 ? midi : undefined;
}

function midiJsToJson(source: string): Record<string, string> {
  const header = source.indexOf('MIDI.Soundfont.');
  if (header < 0) throw new Error('Invalid MIDI.js soundfont format.');
  const start = source.indexOf('=', header) + 2;
  const end = source.lastIndexOf(',');
  return JSON.parse(source.slice(start, end) + '}');
}

function base64ToBytes(dataUri: string): ArrayBuffer {
  const decoded = atob(dataUri.slice(dataUri.indexOf(',') + 1));
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes.buffer;
}

async function loadSamples({ url, pitches }: SoundfontRequest): Promise<SoundfontSample[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Soundfont download failed (HTTP ${response.status}).`);
  const json = midiJsToJson(await response.text());
  const byMidi = new Map<number, string>();
  for (const [name, data] of Object.entries(json)) {
    const midi = noteNameToMidi(name);
    if (midi !== undefined && typeof data === 'string' && !byMidi.has(midi)) byMidi.set(midi, data);
  }
  if (!byMidi.size) throw new Error('The soundfont contains no samples.');
  const available = [...byMidi.keys()];
  const chosen = new Set<number>();
  for (const pitch of pitches) {
    // The nearest available sample substitutes for a missing pitch, matching
    // the pitch-shifted key ranges the sampler spreads on the main thread.
    chosen.add(available.reduce((best, midi) =>
      Math.abs(midi - pitch) < Math.abs(best - pitch) ? midi : best));
  }
  return [...chosen].map(pitch => ({ pitch, data: base64ToBytes(byMidi.get(pitch)!) }));
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SoundfontRequest>) => void) | null;
  postMessage(message: SoundfontResponse, options?: { transfer: ArrayBuffer[] }): void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  loadSamples(request).then(
    samples => workerScope.postMessage({ id: request.id, samples },
      { transfer: samples.map(sample => sample.data) }),
    error => workerScope.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    }));
};
