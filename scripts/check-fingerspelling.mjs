import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const context = vm.createContext({});
const alphabetSource = readFileSync(new URL('../src/menu/aslAlphabet.ts', import.meta.url), 'utf8');
vm.runInContext(stripTypeScriptTypes(alphabetSource, { mode: 'transform' })
  .replace(/export /g, '').replace(/import\.meta\.env\.BASE_URL/g, "'/'"), context);
assert.equal(vm.runInContext('ASL_ALPHABET.length', context), 26);
assert.equal(vm.runInContext('ASL_ALPHABET.map(item => item.letter).join("")', context), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
assert.equal(vm.runInContext('ASL_ALPHABET.filter(item => item.motion).map(item => item.letter).join("")', context), 'JZ');
assert.ok(vm.runInContext('ASL_ALPHABET.every(item => item.description.length > 40)', context));
assert.equal(context.getASLLetterReference(' z ').letter, 'Z');
assert.equal(context.getASLLetterReference('AA'), undefined);
assert.equal(context.getASLLetterImage(' z '), '/asl/Z.svg');
assert.equal(context.getASLLetterImage('../A'), undefined);
assert.equal(vm.runInContext('ASL_NUMBERS.map(item => item.letter).join("")', context), '0123456789');
assert.equal(vm.runInContext('ASL_SYMBOLS.length', context), 36);
assert.equal(context.getASLLetterImage('0'), '/asl/0.svg');
assert.equal(context.getASLLetterImage('9'), '/asl/9.jpg');
const imageSources = JSON.parse(readFileSync(new URL('../src/public/asl/sources.json', import.meta.url), 'utf8'));
assert.equal(imageSources.map(source => source.letter).join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
for (const source of imageSources) {
  const svg = readFileSync(new URL(`../src/public/asl/${source.file}`, import.meta.url));
  assert.equal(source.license, 'Public domain');
  assert.equal(createHash('sha256').update(svg).digest('hex'), source.sha256);
  if (source.file.endsWith('.svg')) {
    assert.match(svg.toString(), /<svg\b/);
    assert.doesNotMatch(svg.toString(), /<script\b|<foreignObject\b|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:|javascript:)/i);
  } else {
    assert.equal(svg.readUInt16BE(0), 0xffd8);
  }
}
for (const file of ['fingerspelling', 'objectNames']) {
  const code = stripTypeScriptTypes(readFileSync(new URL(`../src/interaction/${file}.ts`, import.meta.url), 'utf8'), { mode: 'transform' })
    .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '');
  vm.runInContext(code, context);
}
vm.runInContext('this.templates = new FingerspellingTemplates();', context);
const pose = value => Array.from({ length: 78 }, (_, index) => index < 75 ? value : 0);
const sample = value => Array.from({ length: 15 }, () => pose(value));
assert.equal(context.templates.record('AA', sample(0)), false);
assert.equal(context.templates.record('A', [[NaN]]), false);
assert.equal(context.templates.record('A', sample(0)), true);
assert.equal(context.templates.match(sample(0)), null, 'Require competing templates rather than trusting one taught sign');
assert.equal(context.templates.record('B', sample(0.3)), true);
assert.equal(context.templates.match(sample(0)).letter, 'A');
assert.equal(context.templates.match(sample(0.3)).letter, 'B');
assert.equal(context.templates.match(sample(0.15)), null, 'Ambiguous and out-of-threshold poses must not name things');
assert.equal(context.templates.match(sample(2)), null);
assert.equal(context.templates.record('C', sample(0.31)), true);
assert.equal(context.templates.match(sample(0.3)), null, 'Nearly identical taught letters are explicitly rejected');
const moving = Array.from({ length: 15 }, (_, frame) => {
  const p = pose(0.7); p[75] = frame * 0.008; p[76] = Math.sin(frame * 0.4) * 0.03; return p;
});
assert.equal(context.templates.record('Z', moving), true);
const shifted = moving.map(p => p.map((v, index) => index >= 75 ? v + 2 : v));
assert.equal(context.templates.match(shifted).letter, 'Z', 'Motion signs tolerate a shifted starting wrist location');
assert.equal(context.templates.match(sample(0.7)), null, 'Holding a static pose is not the taught wrist trajectory');
assert.equal(context.templates.record('0', sample(1.1)), true);
assert.equal(context.templates.record('9', sample(1.5)), true);
assert.equal(context.templates.record('10', sample(1.7)), false);
assert.equal(context.templates.match(sample(1.5)).letter, '9');
assert.equal(context.templates.record('O', sample(1.1)), true);
assert.equal(context.templates.match(sample(1.1)), null, 'Shared zero/O handshapes must remain ambiguous');
const object = { name: 'pathRobot', isDisposed: () => false };
assert.equal(context.setObjectName(object, '  ALICE  '), true);
assert.equal(context.getObjectName(object), 'ALICE');
assert.equal(object.name, 'pathRobot', 'Naming preserves internal identity and picking');
assert.equal(context.setObjectName(object, ''), false);
assert.equal(context.setObjectName(object, 'a'.repeat(41)), false);
assert.equal(context.setObjectName({ isDisposed: () => true }, 'A'), false);
console.log('Fingerspelling checks passed: personal templates, ambiguity/unknown rejection, motion trajectories, translation invariance, explicit object naming, limits and identity preservation.');
