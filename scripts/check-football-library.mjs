// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const context = vm.createContext({ Vector3, FIELD_SURFACE_Y: -.48 });
for (const file of ['footballPlayGeometry', 'footballPlaySequence', 'footballSpecialTeams',
  'footballPlayLibrary', 'footballBallFlight', 'footballTackles']) {
  vm.runInContext(stripTypeScriptTypes(readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8'),
    { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);
}
const library = vm.runInContext('FOOTBALL_PLAY_LIBRARY', context);
assert.equal(library.length, 13);
assert.equal(new Set(library.map(play => play.value)).size, 13);
assert.deepEqual([...new Set(library.map(play => play.category))].sort(), ['Offense', 'Sequences', 'Special teams']);
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
  const priorPass = drive.ballEvents[index * 2 + 1];
  const priorCarrier = drive.players.find(player => player.id === priorPass.toId);
  assert.equal(center.positions[segment.startCount].z,
    priorCarrier.positions[drive.sequence[index].endCount].z, 'Next snap is at previous carrier dead-ball spot');
});
assert.equal(drive.tackles.length, 5, 'No tackle after the scoring play');
const touchdown = drive.outcomes[0];
const carrier = drive.players.find(player => player.id === touchdown.playerId);
assert.ok(touchdown.count >= drive.ballEvents[11].endCount, 'Ball is caught before scoring');
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
console.log('Football library passed: 13 selectable plays, six advancing dead-ball spots, touchdown crossing, five tackles, kicker/punter/holder roles, kickoff/punt returns, field goal, flight apex/endpoints, continuous routes and deterministic generation.');
