// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const context = vm.createContext({ Vector3, FIELD_SURFACE_Y: -.48 });
for (const name of ['footballPlayGeometry', 'footballPlaySequence', 'footballSpecialTeams', 'footballPlayLibrary',
  'footballBodyClearance', 'footballMovement', 'footballLineOfScrimmage', 'footballAnimationLibrary', 'footballBallFlight']) {
  vm.runInContext(stripTypeScriptTypes(readFileSync(new URL(`../src/robot/${name}.ts`, import.meta.url), 'utf8'),
    { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
}
for (const play of ['drive', 'sequence', 'slants', 'four-verticals', 'sweep', 'kickoff', 'punt', 'field-goal',
  'edge-sack', 'blitz-sack', 'four-man-rush', 'linebacker-blitz']) {
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
      assert.equal(context.footballPresnapSpot(data.ballEvents, event.startCount, position).z, spot.z);
      assert.equal(context.footballPresnapSpot([event], event.startCount + 1, position), null,
        'Players may cross the line after the snap');
      const bodies = data.players.map(player => {
        const from = player.positions[event.startCount], to = player.positions[event.startCount + 1] ?? from;
        const movement = context.footballMovement({ team: player.team, role: player.label,
          playStart: event.startCount }, event.startCount, to.x - from.x, to.z - from.z);
        const snap = player.id === event.fromId ? context.footballSnapPose(event, event.startCount) : null;
        return context.footballPresnapBody({ ...from, yaw: movement.bodyYaw, fall: 0,
          lean: snap?.lean ?? movement.lean, scale: 1 }, player.team, spot, event.startCount);
      });
      const resolved = context.separateFootballBodies(bodies);
      resolved.forEach((point, index) => {
        const range = context.footballBodyZRange({ ...bodies[index], ...point });
        assert.ok(data.players[index].team === 'offense' ? range.max <= spot.z - .08 + 1e-6
          : range.min >= spot.z + .08 - 1e-6,
        `${play}/${event.startCount}/${data.players[index].id}: the full body stays behind the line`);
      });
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
