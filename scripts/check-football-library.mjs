// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const context = vm.createContext({ Vector3, FIELD_SURFACE_Y: -.48 });
for (const file of ['footballPlayGeometry', 'footballPlaySequence', 'footballSpecialTeams',
  'footballPlayLibrary', 'footballAnimationLibrary', 'footballBallFlight', 'footballTackles']) {
  vm.runInContext(stripTypeScriptTypes(readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8'),
    { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
}
const library = vm.runInContext('FOOTBALL_PLAY_LIBRARY', context);
assert.equal(library.length, 17);
assert.equal(new Set(library.map(play => play.value)).size, 17);
assert.deepEqual([...new Set(library.map(play => play.category))].sort(), ['Defense', 'Offense', 'Sequences', 'Special teams']);
for (const entry of library) {
  const play = context.generateFootballLibraryPlay('spread', entry.value);
  assert.equal(play.players.length, 22, `${entry.value}: shared 11-on-11 roster`);
  assert.equal(new Set(play.players.map(player => player.id)).size, 22);
  const length = play.players[0].positions.length;
  assert.ok(play.players.every(player => player.positions.length === length));
  for (const player of play.players) {
    assert.ok(player.positions.every(point => Number.isFinite(point.x) && Number.isFinite(point.z) &&
      Math.abs(point.x) <= 26.6665 && Math.abs(point.z) <= 60), `${entry.value}/${player.id}: field bounds`);
  }
  if (!['kickoff', 'punt', 'field-goal'].includes(entry.value)) {
    const rushers = play.players.filter(player => player.rush);
    assert.ok(rushers.length >= 4, `${entry.value}: defensive line uses rush gait`);
    const snap = play.ballEvents.find(event => event.kind === 'snap');
    const front = play.players.filter(player => player.team === 'offense' &&
      ['LT', 'LG', 'C', 'RG', 'RT'].includes(player.label));
    const frontZ = Math.min(...front.map(player => player.positions[snap.startCount + 8].z));
    assert.ok(rushers.every(player => player.positions[snap.startCount + 12].z < frontZ - .5),
      `${entry.value}: rushers pass the offensive front into the backfield`);
  }
  const anchor = (id, count) => {
    const point = play.players.find(player => player.id === id)?.positions[count];
    return point ? new Vector3(point.x, -.48 + 1.05, point.z) : null;
  };
  for (const event of play.ballEvents) {
    assert.ok(event.startCount < event.endCount && event.endCount < length);
    const endpoints = context.footballFlightEndpoints(event, anchor);
    assert.ok(endpoints);
    assert.ok(context.footballFlightPoint(event, endpoints.from, endpoints.to, 0).equals(endpoints.from));
    assert.ok(context.footballFlightPoint(event, endpoints.from, endpoints.to, 1).equals(endpoints.to));
    const mid = context.footballFlightPoint(event, endpoints.from, endpoints.to, .5);
    assert.equal(mid.y, (endpoints.from.y + endpoints.to.y) / 2 +
      (event.flightHeight ?? (event.kind === 'pass' ? 4 : 0)), 'Measured flight apex above chord');
  }
  for (const event of play.tackles ?? []) {
    context.validateFootballTackle(event, play.players,
      (id, count) => play.players.find(player => player.id === id)?.positions[count] ?? null,
      length - 1, play.tackles.filter(other => other !== event), play.ballEvents);
  }
  assert.deepEqual(play, context.generateFootballLibraryPlay('spread', entry.value), 'Deterministic library playback');
}
const drive = context.generateFootballLibraryPlay('spread', 'drive');
const center = drive.players.find(player => player.id === 'offense-C');
const spots = drive.sequence.map(segment => center.positions[segment.startCount].z);
assert.deepEqual(Array.from(spots), [-30, -16, -12, 10, 22, 26],
  'Six-play drive advances from own 20 to opponent 24');
drive.sequence.slice(1).forEach((segment, index) => {
  const priorPass = drive.ballEvents.filter(event => event.kind === 'pass')[index];
  const priorCarrier = drive.players.find(player => player.id === priorPass.toId);
  assert.equal(center.positions[segment.startCount].z,
    priorCarrier.positions[drive.sequence[index].endCount].z, 'Next snap is at previous carrier dead-ball spot');
});
assert.equal(drive.tackles.length, 5, 'No tackle after the scoring play');
const touchdown = drive.outcomes[0];
const carrier = drive.players.find(player => player.id === touchdown.playerId);
assert.ok(touchdown.count >= drive.ballEvents.filter(event => event.kind === 'pass').at(-1).endCount,
  'Ball is caught before scoring');
assert.ok(carrier.positions[touchdown.count].z >= 50 && carrier.positions[touchdown.count - 1].z < 50,
  'Score occurs at first end-zone crossing, not merely when final play is loaded');
assert.ok(carrier.positions[264].z > 50 && carrier.positions[264].z < 60, 'Scorer holds inside the end zone');
for (const segment of drive.sequence.slice(1)) {
  for (const player of drive.players) {
    for (let count = segment.startCount - 23; count <= segment.startCount; count++) {
      const a = player.positions[count - 1], b = player.positions[count];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1.7, 'Walking reset stays continuous without teleportation');
    }
  }
}
for (const play of ['kickoff', 'punt', 'field-goal']) {
  const data = context.generateFootballLibraryPlay('spread', play);
  assert.equal(data.players.filter(player => player.team === 'offense').length, 11);
  const kick = data.ballEvents.find(event => event.kind === 'kick' || event.kind === 'punt');
  const kicker = data.players.find(player => player.id === kick.fromId);
  assert.equal(kicker.label, play === 'punt' ? 'P' : 'K');
  if (play !== 'kickoff') assert.equal(data.players.find(player => player.id === 'offense-C').label, 'LS');
  if (play === 'field-goal') {
    assert.equal(data.players.find(player => player.id === 'offense-QB').label, 'H');
    assert.equal(kick.targetPosition.z, 60);
    assert.ok(kick.targetPosition.height > 10 / 3, 'Kick clears goalpost crossbar');
    assert.equal(data.outcomes[0].count, kick.endCount);
  } else {
    const returner = data.players.find(player => player.id === kick.toId);
    assert.equal(returner.label, play === 'punt' ? 'PR' : 'KR');
    assert.ok(returner.positions[24].z < returner.positions[kick.endCount].z, 'Returner advances toward opposing goal after catch');
    assert.deepEqual(returner.positions[kick.endCount - 1], returner.positions[kick.endCount], 'Return starts after catch');
  }
  assert.equal(context.footballKickPose(kick.startCount, kick.startCount - 1), 0);
  assert.equal(context.footballKickPose(kick.startCount, kick.startCount + .5), 1);
  assert.equal(context.footballKickPose(kick.startCount, kick.startCount + 2), 0);
}
assert.throws(() => context.generateFootballLibraryPlay('spread', 'invalid'), /supported/);
const pass = { kind: 'pass', startCount: 5, endCount: 7 };
for (let elapsed = 0; elapsed < .8; elapsed += .001) {
  const t = elapsed < .35 ? elapsed / .35 : (elapsed - .35) / .45;
  const blend = t * t * (3 - 2 * t);
  const expectedArm = elapsed < .35 ? -2.2 + (-2.6 + 2.2) * blend : -2.6 + (-.8 + 2.6) * blend;
  assert.ok(Math.abs(context.footballThrowPose(pass, 5 + elapsed).arm - expectedArm) < 1e-12,
    'Shared precomputed throw-curve coefficients preserve the original pose');
}
assert.equal(context.footballThrowPose(pass, 4), null);
assert.equal(context.footballThrowPose(pass, 7), null);
assert.equal(context.footballCatchPose(pass, 6), null);
assert.equal(context.footballCatchPose(pass, 8.5), null);
assert.equal(context.footballThrowPose({ ...pass, kind: 'snap' }, 5), null);
assert.equal(context.footballThrowPose({ ...pass, kind: 'return' }, 5).blend, 1,
  'Between-play returns reuse the throwing arm pose');
assert.equal(context.footballCatchPose({ ...pass, kind: 'handoff' }, 7), null);
assert.equal(context.footballThrowPose(pass, 5).blend, 1);
assert.ok(context.footballThrowPose(pass, 5.35).elbow > context.footballThrowPose(pass, 5).elbow,
  'Throw straightens the cocked elbow through release');
assert.equal(context.footballCatchPose(pass, 7).blend, 1);
assert.ok(context.footballCatchPose(pass, 7.5).arm > context.footballCatchPose(pass, 7).arm,
  'Receiver brings outstretched arms back toward chest after catching');
for (const boundary of [5, 5.35, 5.8]) {
  const a = context.footballThrowPose(pass, boundary - 1e-6);
  const b = context.footballThrowPose(pass, boundary + 1e-6);
  assert.ok(Math.abs(a.blend * a.arm - b.blend * b.arm) < 1e-4, 'Throw phase transitions are continuous');
}
for (const formation of ['shotgun', 'spread', 'i-form']) {
  for (const play of ['edge-sack', 'blitz-sack', 'four-man-rush', 'linebacker-blitz']) {
    const data = context.generateFootballLibraryPlay(formation, play);
    const rushers = data.players.filter(player => player.rush);
    assert.equal(rushers.length, play.includes('blitz') ? 5 : 4);
    const sack = play.endsWith('sack');
    assert.equal(data.tackles.length, sack ? 1 : 0);
    assert.deepEqual(Array.from(data.ballEvents, event => event.kind), sack ? ['snap'] : ['snap', 'pass']);
    for (const player of data.players) {
      for (let count = 1; count < player.positions.length; count++) {
        const a = player.positions[count - 1], b = player.positions[count];
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 2.6, `${play}: continuous authored rush routes`);
      }
    }
    for (const tackle of data.tackles) {
      assert.equal(tackle.carrierId, 'offense-QB', 'A sack tackles the quarterback with possession');
      context.validateFootballTackle(tackle, data.players,
        (id, count) => data.players.find(player => player.id === id)?.positions[count] ?? null,
        24, [], data.ballEvents);
    }
    const qb = data.players.find(player => player.label === 'QB');
    rushers.forEach(player => assert.ok(
      Math.hypot(player.positions[12].x - qb.positions[12].x, player.positions[12].z - qb.positions[12].z) <
      Math.hypot(player.positions[0].x - qb.positions[0].x, player.positions[0].z - qb.positions[0].z),
      'Rushers close on the pocket, rather than dropping into coverage'));
  }
}
console.log('Football library passed: 17 plays, sacks with QB possession/contact/recovery, four/five-man pressure, quick/hot passes, advancing drive, special teams and deterministic routes.');
