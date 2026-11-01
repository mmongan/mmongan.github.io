// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const context = vm.createContext({ Vector3, FIELD_SURFACE_Y: -.48,
  FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120, END_ZONE_DEPTH_YARDS: 10 });
for (const file of ['footballPlayGeometry', 'footballPlaySequence', 'footballSpecialTeams', 'footballPlayLibrary',
  'footballMovement', 'footballTackles', 'footballBodyClearance', 'footballBallFlight', 'footballLineOfScrimmage']) {
  vm.runInContext(stripTypeScriptTypes(readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8'),
    { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
}
const check = bodies => {
  const before = JSON.stringify(bodies), positions = context.separateFootballBodies(bodies);
  assert.equal(JSON.stringify(bodies), before, 'Clearance never mutates authored input poses');
  const resolved = bodies.map((body, i) => ({ ...body, ...positions[i] }));
  resolved.forEach(body => {
    assert.ok(body.z >= (body.minZ ?? -Infinity) - 1e-6 && body.z <= (body.maxZ ?? Infinity) + 1e-6,
      'Body clearance preserves pre-snap team-side limits');
  });
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    assert.ok(context.footballBodyGap(resolved[i], resolved[j]).distance >=
      .53 * (bodies[i].scale + bodies[j].scale) - 1.01e-6,
    `Bodies ${i}/${j} must have full capsule clearance`);
  }
  return positions;
};
let samples = 0;
for (const play of ['slants', 'sweep', 'four-verticals', 'sequence', 'drive', 'slant-flat',
  'stick', 'smash', 'flood', 'mesh', 'kickoff', 'punt', 'field-goal',
  'edge-sack', 'blitz-sack', 'four-man-rush', 'linebacker-blitz']) {
  const data = context.generateFootballLibraryPlay('spread', play);
  const saved = JSON.stringify(data);
  for (let beat = 0; beat <= data.players[0].positions.length - 1; beat += .25) {
    const spot = context.footballPresnapSpot(data.ballEvents, beat,
      (id, count) => data.players.find(player => player.id === id)?.positions[count] ?? null);
    const bodies = data.players.map(player => {
      const index = Math.floor(beat), from = player.positions[index];
      const to = player.positions[Math.min(index + 1, player.positions.length - 1)];
      const movement = context.footballMovement({ team: player.team, role: player.label, playStart: 0,
        playWindows: data.sequence, rush: player.rush }, beat, to.x - from.x, to.z - from.z);
      let yaw = movement.bodyYaw;
      const tackle = data.tackles?.find(event => [event.defenderId, event.carrierId].includes(player.id) &&
        context.footballTacklePose(event, beat));
      const fall = tackle ? context.footballTacklePose(tackle, beat).fall : 0;
      const snapEvent = data.ballEvents.find(event => event.fromId === player.id && context.footballSnapPose(event, beat));
      const snap = snapEvent ? context.footballSnapPose(snapEvent, beat) : null;
      if (tackle) {
        const a = data.players.find(player => player.id === tackle.defenderId).positions[tackle.count];
        const b = data.players.find(player => player.id === tackle.carrierId).positions[tackle.count];
        const target = context.footballTackleYaw(a, b);
        yaw += Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw)) * fall;
      }
      const body = { x: from.x + (to.x - from.x) * (beat - index),
        z: from.z + (to.z - from.z) * (beat - index), yaw, fall,
        lean: snap ? movement.lean * (1 - snap.crouch) + snap.lean : movement.lean, scale: 1 };
      return spot && fall === 0 ? context.footballPresnapBody(body, player.team, spot, beat) : body;
    });
    let positions;
    try { positions = check(bodies); }
    catch (error) { console.error(play, beat); throw error; }
    if (spot && beat === spot.count) {
      positions.forEach((position, index) => {
        const range = context.footballBodyZRange({ ...bodies[index], ...position });
        assert.ok(data.players[index].team === 'offense' ? range.max <= spot.z - .08 + 1e-6
          : range.min >= spot.z + .08 - 1e-6,
        `${play}/${beat}: full bodies start on opposite sides of the snap line`);
      });
    }
    for (const formation of ['shotgun', 'spread', 'i-form']) {
      const data = context.generateFootballPlay(formation, 'slants');
      const bodies = data.players.map(player => ({
        ...player.positions[0], yaw: player.team === 'offense' ? 0 : Math.PI, fall: 0, lean: 0, scale: 1,
      }));
      const positions = check(bodies);
      positions.forEach((position, index) => {
        assert.ok(Math.hypot(position.x - bodies[index].x, position.z - bodies[index].z) < 1e-8,
          `${formation}: all 22 snap positions retain their formation coordinates`);
      });
    }
    if (Number.isInteger(beat)) assert.deepEqual(positions, check(bodies), 'Reverse/paused sampling is deterministic');
    samples++;
  }
  assert.equal(JSON.stringify(data), saved, `${play}: routes, ball/tackle events and counts are preserved`);
}
check(Array.from({ length: 22 }, (_, i) => ({ x: 0, z: 0, yaw: i * .3, fall: i % 2, scale: 1 })));
check(Array.from({ length: 22 }, () => ({ x: 0, z: 0, yaw: 0, fall: 0, scale: 1 })));
check([{ x: 0, z: 0, yaw: 0, fall: 1, scale: 2 }, { x: 0, z: 0, yaw: Math.PI / 2, fall: 1, scale: .5 }]);
let previous;
for (let step = 0; step <= 80; step++) {
  const z = -2 + step * .05;
  const positions = check([{ x: 0, z, yaw: 0, fall: 0, scale: 1 },
    { x: 0, z: -z, yaw: Math.PI, fall: 0, scale: 1 }]);
  if (previous) {
    positions.forEach((position, index) => assert.ok(
      Math.hypot(position.x - previous[index].x, position.z - previous[index].z) < .3,
      'Head-on crossings slide alongside each other, without an instantaneous side swap'));
  }
  previous = positions;
}
assert.throws(() => check([{ x: NaN, z: 0, yaw: 0, fall: 0, scale: 1 }]), /finite poses/);
assert.throws(() => check([{ x: 0, z: 0, yaw: 0, fall: 0, scale: 1, minZ: 2, maxZ: 1 }]), /finite poses/);
console.log(`Football body clearance passed: ${samples} fractional library poses, standing/blocking/route crossings, fall/recovery, exact coincidence, mixed scales, deterministic seeks and immutable routes.`);
