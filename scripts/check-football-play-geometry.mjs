import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/robot/footballPlayGeometry.ts', import.meta.url), 'utf8');
const compile = text => stripTypeScriptTypes(text, { mode: 'transform' }).replace(/export /g, '');
const context = vm.createContext({ Array, Error, Number, Math });
vm.runInContext(`${compile(source)}
globalThis.api = {
  FOOTBALL_FORMATIONS, FOOTBALL_PLAYS, FOOTBALL_FORMATION_OPTIONS, FOOTBALL_PLAY_OPTIONS,
  FOOTBALL_FORMATION_PRESETS, FOOTBALL_PLAY_PRESETS, generateFootballPlay,
};`, context);

const api = context.api;
assert.deepEqual(Array.from(api.FOOTBALL_FORMATIONS), ['shotgun', 'spread', 'i-form']);
assert.deepEqual(Array.from(api.FOOTBALL_PLAYS), ['slants', 'sweep', 'four-verticals']);
assert.equal(api.FOOTBALL_FORMATION_OPTIONS.length, 3);
assert.equal(api.FOOTBALL_PLAY_OPTIONS.length, 3);
assert.deepEqual(Object.keys(api.FOOTBALL_FORMATION_PRESETS).sort(), ['i-form', 'shotgun', 'spread']);
assert.deepEqual(Object.keys(api.FOOTBALL_PLAY_PRESETS).sort(), ['four-verticals', 'slants', 'sweep']);

for (const formation of api.FOOTBALL_FORMATIONS) {
  for (const play of api.FOOTBALL_PLAYS) {
    const result = api.generateFootballPlay(formation, play);
    assert.equal(result.players.length, 22, `${formation}/${play} has 22 players`);
    assert.equal(result.players.filter(player => player.team === 'offense').length, 11);
    assert.equal(result.players.filter(player => player.team === 'defense').length, 11);
    assert.equal(new Set(result.players.map(player => player.id)).size, 22, 'Player IDs are unique');
    assert.deepEqual(
      Array.from(result.players.filter(player => player.team === 'offense'), player => player.label).sort(),
      (formation === 'i-form'
        ? ['C', 'FB', 'LG', 'LT', 'QB', 'RB', 'RG', 'RT', 'TE', 'WR1', 'WR3']
        : ['C', 'LG', 'LT', 'QB', 'RB', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3']).sort(),
    );
    assert.ok(result.players.every(player => player.positions.length === 17), 'Every player has counts 0 through 16');
    const offense = result.players.filter(player => player.team === 'offense');
    assert.equal(offense.filter(player => player.positions[0].z === -10).length, 7,
      'Seven offensive players line up on the line of scrimmage');
    assert.ok(offense.every(player => player.positions[0].z <= -10),
      'No offensive player starts beyond the line of scrimmage');

    for (const player of result.players) {
      for (const position of player.positions) {
        assert.ok(position.x >= -26.666 && position.x <= 26.666, `${player.id} stays within field width`);
        assert.ok(position.z >= -60 && position.z <= 60, `${player.id} stays within field length`);
      }
    }

    const ids = new Set(result.players.map(player => player.id));
    let previousStart = -1;
    for (const event of result.ballEvents) {
      assert.ok(ids.has(event.fromId) && ids.has(event.toId), 'Ball event references existing players');
      assert.ok(event.startCount >= 0 && event.endCount <= 16, 'Ball event stays within route counts');
      assert.ok(event.startCount < event.endCount, 'Ball event has a positive count interval');
      assert.ok(event.startCount >= previousStart, 'Ball events are chronological');
      previousStart = event.startCount;
    }
    assert.equal(result.ballEvents[0].kind, 'snap');
    assert.deepEqual(Array.from(result.ballEvents, event => event.kind), play === 'sweep'
      ? ['snap', 'handoff'] : ['snap', 'pass']);

    const targeted = result.ballEvents.at(-1).toId;
    assert.equal(targeted, play === 'sweep' ? 'offense-RB'
      : play === 'slants' ? 'offense-WR1' : 'offense-WR3');
    if (play === 'sweep') {
      const handoff = result.ballEvents.at(-1);
      const quarterback = result.players.find(player => player.id === handoff.fromId).positions[handoff.startCount];
      const runningBack = result.players.find(player => player.id === handoff.toId).positions[handoff.endCount];
      assert.ok(Math.hypot(quarterback.x - runningBack.x, quarterback.z - runningBack.z) < 1,
        'Handoff takes place within reach instead of teleporting to a distant running back');
    }
    const routeSignatures = new Set(result.players.map(player =>
      player.positions.map(position => `${position.x.toFixed(4)},${position.z.toFixed(4)}`).join(';')));
    assert.equal(routeSignatures.size, 22, 'Each player has a distinct route');
    assert.deepEqual(result, api.generateFootballPlay(formation, play), 'Generation is deterministic');
  }
}

assert.throws(() => api.generateFootballPlay('invalid', 'slants'), /supported/);
assert.throws(() => api.generateFootballPlay('shotgun', 'invalid'), /supported/);
const sourced = api.generateFootballPlay('spread', 'four-verticals');
const player = role => sourced.players.find(player => player.label === role).positions;
for (const role of ['WR1', 'WR2', 'TE', 'WR3']) {
  const route = player(role);
  assert.ok(route.every(point => point.x === route[0].x), `${role} maintains its vertical lane`);
  assert.equal(route[16].z - route[0].z, 28, 'Four vertical threats advance downfield');
}
assert.equal(player('WR2')[0].x, -9, 'Left slot attacks the left seam');
assert.equal(player('TE')[0].x, 9, 'Right slot attacks the right seam');
for (const role of ['LT', 'LG', 'C', 'RG', 'RT']) {
  assert.ok(player(role)[3].z < player(role)[0].z, 'Linemen pass-set rather than run-block downfield');
}
assert.deepEqual(player('RB')[3], player('RB')[7], 'Back checks protection before releasing');
assert.ok(player('RB')[16].z > -10, 'Back releases as an underneath outlet');
assert.equal(player('FS')[16].x, -13);
assert.equal(player('SS')[16].x, 13);
assert.equal(player('QB')[12].z, -16.5, 'Quarterback drops and sets for the pass');
console.log('Football play geometry checks passed: all formations/plays, 22 routes, field bounds, deterministic sampling, and ball events.');
