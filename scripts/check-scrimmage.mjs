import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const compile = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const context = vm.createContext({ FIELD_WIDTH_YARDS: 53.333 });
vm.runInContext(compile('../src/robot/footballPlayGeometry.ts'), context);
vm.runInContext(compile('../src/robot/scrimmageGeometry.ts'), context);
for (const formation of ['shotgun', 'spread', 'i-form']) {
  const geometry = context.generateFootballPlay(formation, 'slants');
  geometry.players.forEach((player, index) => {
    const path = context.scrimmagePlayerRoute(player.positions, index);
    assert.equal(path.length, 113, 'Exit, entry and play share one timeline');
    for (let count = 0; count <= 48; count++) {
      assert.ok(Math.abs(path[count].x) > 53.333 / 2, 'Players wait outside the field during band exit');
      assert.deepEqual(path[count], path[0], 'Players hold still until band exit completes');
    }
    assert.deepEqual(path[96], player.positions[0], 'Players reach their formation before the snap');
    assert.deepEqual(path[112], player.positions[16], 'The entire football play is preserved');
    for (let count = 1; count <= 96; count++) {
      assert.ok(Math.hypot(path[count].x - path[count - 1].x, path[count].z - path[count - 1].z) < 1.25,
        'Entry is continuous, without teleporting');
    }
  });
}
const exit = context.scrimmageWalk({ x: 0, z: 5 }, context.scrimmageSideline({ x: 0, z: 5 }, 0), 48);
assert.equal(exit.length, 49);
assert.ok(exit.at(-1).x > 53.333 / 2, 'Band finishes outside the sideline');
assert.equal(exit.at(-1).z, 5, 'Band exits toward the sideline rather than an end zone');
console.log('Scrimmage passed: waiting sidelines, band exit, sequential player entry, continuous routes and delayed play.');
