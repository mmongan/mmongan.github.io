// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/scene/engine.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source.slice(source.indexOf('function createEngine()'),
  source.indexOf('export const engine =')), { mode: 'transform' });
for (const failure of [null, new Error('WebGL not supported')]) {
  const status = { hidden: true, textContent: '' };
  const vr = { disabled: false }, ar = { disabled: false };
  const logs = [];
  let calls = 0;
  const context = vm.createContext({
    Error, canvas: {}, xrEntryStatus: status, enterVRButton: vr, enterARButton: ar,
    console: { error: (...args) => logs.push(args) },
    Engine: class {
      constructor(canvas, antialias, options) {
        calls++;
        assert.equal(antialias, true);
        assert.equal(options.preserveDrawingBuffer, true);
        if (failure) throw failure;
      }
    },
  });
  vm.runInContext(code, context);
  if (failure) {
    assert.throws(() => context.createEngine(), error => error === failure);
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /WebGL not supported/);
    assert.match(status.textContent, /embedded browser/);
    assert.equal(vr.disabled, true);
    assert.equal(ar.disabled, true);
    assert.equal(logs.length, 1);
  } else {
    assert.ok(context.createEngine());
    assert.equal(status.hidden, true);
    assert.equal(vr.disabled, false);
    assert.equal(logs.length, 0);
  }
  assert.equal(calls, 1, 'Only the shared engine is created');
}
console.log('Engine startup checks passed: unchanged renderer options and visible WebGL failures.');
