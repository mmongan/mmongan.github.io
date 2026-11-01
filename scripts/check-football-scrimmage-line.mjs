// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const context = vm.createContext({ Vector3, FIELD_SURFACE_Y: -.48 });
for (const name of ['footballPlayGeometry', 'footballPlaySequence', 'footballSpecialTeams', 'footballPlayLibrary',
  'footballLineOfScrimmage', 'footballBallFlight']) {
  vm.runInContext(stripTypeScriptTypes(readFileSync(new URL(`../src/robot/${name}.ts`, import.meta.url), 'utf8'),
    { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
}
for (const play of ['drive', 'sequence', 'slants', 'four-verticals', 'sweep', 'kickoff', 'punt', 'field-goal']) {
  const data = context.generateFootballLibraryPlay('spread', play);
  const position = (id, count) => data.players.find(player => player.id === id)?.positions[count] ?? null;
  const openings = data.ballEvents.filter(event => event.kind === 'snap' || event.kind === 'kick' && event.startPosition);
  for (const event of openings) {
    const spot = context.footballScrimmageSpot(data.ballEvents, event.startCount, position);
    assert.equal(spot.z, event.startPosition?.z ?? position(event.fromId, event.startCount).z);
    for (const player of data.players) {
      const z = player.positions[event.startCount].z;
      if (spot.kickoff && player.id === event.fromId) continue;
      assert.ok(player.team === 'offense' ? z <= spot.z + 1e-6 : z >= spot.z - 1e-6,
        `${play}/${event.startCount}/${player.id} starts on its own side of the actual snap line`);
    }
    assert.equal(context.footballScrimmageSpot(data.ballEvents, event.startCount + .5, position).z, spot.z,
      'Line is locked to the snap spot, not the moving ball');
    if (event.kind === 'snap') {
      assert.equal(context.footballSnapPose(event, event.startCount).crouch, 1);
      assert.ok(context.footballSnapPose(event, event.startCount + .5).arm >
        context.footballSnapPose(event, event.startCount).arm, 'Center swings arms back through snap');
      assert.equal(context.footballSnapPose(event, event.endCount + 1), null);
    }
  }
  assert.equal(context.footballScrimmageSpot(data.ballEvents, -96, position).z,
    context.footballScrimmageSpot(data.ballEvents, openings[0].startCount, position).z,
  'Entrance previews the first actual snap line');
}
assert.throws(() => context.footballScrimmageSpot([{ kind: 'snap', startCount: 0, fromId: 'missing' }], 0, () => null),
  /valid snap position/);
assert.equal(context.footballScrimmageSpot([], 0, () => null), null);
console.log('Football TV scrimmage line passed: actual snap spots, drive changes, team sides, kickoff line, entrance preview, no ball-following drift, center snap/recovery and invalid coordinates.');
