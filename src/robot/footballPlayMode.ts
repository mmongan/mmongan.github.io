// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { getDrillTransportState, getRobotCounts, setRobotColor, setRobotFootballMotion,
  TOP_DOWN_MARKER_LAYER_MASK } from './robot';
import { footballMovement } from './footballMovement';
import { setFootballTeam, setFootballPositionSampler, getFootballPlaybackPosition } from './footballPresentation';
import { separateFootballBodies } from './footballBodyClearance';
import { getFootballSymbolTemplate } from './footballSymbolModel';
import { createFootballHumanModel } from './footballHumanModel';
import { scrimmageBenchSeat, scrimmageSeatedBlend } from './scrimmageGeometry';
import { footballTacklePose, footballTackleYaw, validateFootballTackle, type FootballTackleEvent } from './footballTackles';
import { FOOTBALL_PLAY_LIBRARY } from './footballPlayLibrary';
import { footballFlightEndpoints, footballFlightPoint, footballKickPose, footballSnapPose,
  footballThrowPose, footballCatchPose } from './footballBallFlight';
import { footballPresnapBody, footballPresnapSpot, footballScrimmageSpot } from './footballLineOfScrimmage';
import { createFootballFuturePreview } from './footballFuturePreview';
import { initFootballTackleEditor, executeFootballTackleCommand, type FootballTackleCommand } from './footballTackleEditor';
import { floorCalibrationToggle, footballFormationSelect, footballPlaySelect, footballLoadButton,
  footballExitButton, footballStatus, scrimmageButton,
  footballDraftTeam, footballDraftFrom, footballDraftTo, footballChartEdit,
  footballBallHighlight, footballFlightPath, footballFutureGhosts } from '../ui/dom';
import { FIELD_SURFACE_Y, FIELD_WIDTH_YARDS } from '../field/constants';
import { FOOTBALL_FORMATIONS, FOOTBALL_PLAYS, FOOTBALL_FORMATION_OPTIONS, FOOTBALL_PLAY_OPTIONS,
  FOOTBALL_SCRIMMAGE_DEFAULT, FOOTBALL_PLAY_PRESETS,
  type FootballFormation, type FootballPlay, type FootballBallEvent, type FootballPlayer,
  type FootballOutcome } from './footballPlayGeometry';

export type FootballCommand = 'load' | 'exit' | 'formation' | 'play' | 'scrimmage' | FootballTackleCommand |
  'draftTeam' | 'draftFrom' | 'draftTo' | 'chart' | 'ballHighlight' | 'flightPath' | 'futureGhosts';
let shiftActiveTimeline: ((at: number, amount: number) => void) | null = null;
export function shiftFootballTimeline(at: number, amount: number) {
  if (!shiftActiveTimeline || !Number.isInteger(at) || !Number.isInteger(amount) || at < 0 || amount < 1) {
    throw new Error('An active football timeline and valid inserted counts are required.');
  }
  shiftActiveTimeline(at, amount);
}
let notifyFootball = (message: string) => {
  if (footballStatus) footballStatus.value = message;
};

export function executeFootballCommand(command: FootballCommand) {
  if (command === 'ballHighlight' || command === 'flightPath' || command === 'futureGhosts') {
    const toggle = command === 'ballHighlight' ? footballBallHighlight
      : command === 'futureGhosts' ? footballFutureGhosts : footballFlightPath;
    if (!toggle) throw new Error('Football ball display controls are unavailable.');
    toggle.checked = !toggle.checked;
    toggle.dispatchEvent(new Event('change'));
    return;
  }
  if (command === 'chart') { footballChartEdit?.click(); return; }
  if (command === 'draftTeam') {
    if (footballDraftTeam?.options.length) {
      footballDraftTeam.selectedIndex = (footballDraftTeam.selectedIndex + 1) % footballDraftTeam.options.length;
      footballDraftTeam.dispatchEvent(new Event('change'));
    }
    return;
  }
  if (command === 'draftFrom' || command === 'draftTo') {
    const input = command === 'draftFrom' ? footballDraftFrom : footballDraftTo;
    if (input) input.value = String(Math.floor(getDrillTransportState().beat));
    return;
  }
  if (command === 'tackleDefender' || command === 'tackleCarrier' || command === 'tackleCount' ||
    command === 'tackleAdd' || command === 'tackleEvent' || command === 'tackleRemove') {
    executeFootballTackleCommand(command);
    return;
  }
  if (command === 'load') footballLoadButton?.click();
  else if (command === 'scrimmage') scrimmageButton?.click();
  else if (command === 'exit') footballExitButton?.click();
  else {
    const select = command === 'formation' ? footballFormationSelect : footballPlaySelect;
    if (!select) throw new Error('Football play controls are unavailable.');
    select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
    select.dispatchEvent(new Event('change'));
    notifyFootball(`Selected ${select.selectedOptions[0].text}. Load play to apply.`);
  }
}

export function initFootballControls(load: (formation: FootballFormation, play: FootballPlay) => void,
  exit: () => void, notify: (message: string) => void,
  scrimmage: (formation: FootballFormation, play: FootballPlay) => void) {
  notifyFootball = message => {
    if (footballStatus) footballStatus.value = message;
    notify(message);
  };
  const formation = footballFormationSelect;
  const play = footballPlaySelect;
  if (!formation || !play || !footballLoadButton || !footballExitButton) return;
  formation.replaceChildren(...FOOTBALL_FORMATION_OPTIONS.map(option => new Option(option.label, option.value)));
  play.replaceChildren(...['Sequences', 'Offense', 'Defense', 'Special teams'].map(category => {
    const group = document.createElement('optgroup');
    group.label = category;
    group.append(...FOOTBALL_PLAY_LIBRARY.filter(option => option.category === category)
      .map(option => new Option(option.label, option.value)));
    return group;
  }));
  formation.value = FOOTBALL_SCRIMMAGE_DEFAULT.formation;
  play.value = FOOTBALL_SCRIMMAGE_DEFAULT.play;
  const run = (scrimmageMode = false) => {
    try {
      const selectedFormation = FOOTBALL_FORMATIONS.find(value => value === formation.value);
      const selectedPlay = FOOTBALL_PLAYS.find(value => value === play.value);
      if (!selectedFormation || !selectedPlay) throw new Error('Select a valid football formation and play.');
      const fixedFormation = !['slants', 'sweep', 'four-verticals',
        'edge-sack', 'blitz-sack', 'four-man-rush', 'linebacker-blitz'].includes(selectedPlay);
      if (fixedFormation) formation.value = 'spread';
      const effectiveFormation = fixedFormation ? 'spread' : selectedFormation;
      if (scrimmageMode) scrimmage(effectiveFormation, selectedPlay);
      else load(effectiveFormation, selectedPlay);
      notifyFootball(selectedPlay === 'drive' ? 'Touchdown drive ready: six completions advance from the own 20 to the end zone.'
        : selectedPlay === 'sequence' ? 'Six sourced plays ready: Slant / Flat, Stick, Smash, Flood, Mesh, Four Verticals. Players walk back between plays.'
        : ['kickoff', 'punt', 'field-goal'].includes(selectedPlay) ? `${FOOTBALL_PLAY_OPTIONS.find(option => option.value === selectedPlay)!.label} ready. Play or scrub the shared timeline.`
        : ['edge-sack', 'blitz-sack', 'four-man-rush', 'linebacker-blitz'].includes(selectedPlay)
          ? `${FOOTBALL_PLAY_PRESETS[selectedPlay].label} ready. ${scrimmageMode ? 'Band exits and teams enter before the snap. ' : ''}Play or scrub the shared timeline.`
        : scrimmageMode ? 'Scrimmage: band walks off, players walk on, then the play runs.'
        : '22 players ready. Use the timeline to play/scrub; select players to edit routes and set endpoints.');
    } catch (error) {
      console.error('Football play setup failed:', error);
      notifyFootball(error instanceof Error ? error.message : String(error));
    }
  };
  const leave = () => {
    try { exit(); notifyFootball('Football mode exited; previous band and timeline restored.'); }
    catch (error) {
      console.error('Could not exit football mode:', error);
      notifyFootball(error instanceof Error ? error.message : String(error));
    }
  };
  const loadClick = () => run();
  const scrimmageClick = () => run(true);
  footballLoadButton.addEventListener('click', loadClick);
  scrimmageButton?.addEventListener('click', scrimmageClick);
  footballExitButton.addEventListener('click', leave);
  scene.onDisposeObservable.addOnce(() => {
    footballLoadButton?.removeEventListener('click', loadClick);
    scrimmageButton?.removeEventListener('click', scrimmageClick);
    footballExitButton?.removeEventListener('click', leave);
  });
}

export function createFootballVisuals(
  players: ReadonlyArray<{ robot: TransformNode; player: FootballPlayer }>,
  inputEvents: ReadonlyArray<FootballBallEvent>, parent: TransformNode, visibleFromCount = 0,
  inputSequence?: ReadonlyArray<{ label: string; startCount: number; endCount: number; source: string }>,
  authoredTackles: ReadonlyArray<FootballTackleEvent> = [],
  inputOutcomes: ReadonlyArray<FootballOutcome> = [],
) {
  const events = inputEvents.map(event => ({ ...event }));
  const sequence = inputSequence?.map(segment => ({ ...segment }));
  const initialVisibleFromCount = visibleFromCount;
  const seatInsertions: { at: number; amount: number }[] = [];
  const tackles = authoredTackles.map(event => ({ ...event }));
  const outcomes = inputOutcomes.map(event => ({ ...event }));
  let disposeFlightLine = () => {};
  let disposeFuturePreview = () => {};
  let disposeTackleEditor: ReturnType<typeof initFootballTackleEditor> = Object.assign(() => {}, { refresh: () => {} });
  let disposeObserver = () => {};
  let releaseTimeline = () => {};
  let disposeClearance = () => {};
  const materials: StandardMaterial[] = [];
  const roots: TransformNode[] = [];
  const hiddenNodes: { node: TransformNode; enabled: boolean }[] = [];
  const animations: { robot: TransformNode; player: FootballPlayer; root: TransformNode;
    human: ReturnType<typeof createFootballHumanModel> }[] = [];
  const material = (name: string, color: Color3) => {
    const result = new StandardMaterial(name, scene);
    result.diffuseColor = color;
    result.specularColor = new Color3(.12, .12, .12);
    materials.push(result);
    return result;
  };
  const cleanup = () => {
    disposeTackleEditor();
    disposeObserver();
    releaseTimeline();
    disposeFlightLine();
    disposeFuturePreview();
    disposeClearance();
    animations.forEach(({ human }) => human.dispose());
    players.forEach(({ robot }) => {
      setRobotFootballMotion(robot, null);
      setFootballTeam(robot, null);
      setFootballPositionSampler(robot, null);
    });
    roots.forEach(root => root.dispose());
    materials.forEach(value => value.dispose(false, true));
    hiddenNodes.forEach(({ node, enabled }) => { if (!node.isDisposed()) node.setEnabled(enabled); });
  };
  try {
    const offense = material('football-offense', Color3.FromHexString('#1967d2'));
    const defense = material('football-defense', Color3.FromHexString('#c62828'));
    const white = material('football-facemask', Color3.White());
    const dark = material('football-eyes', Color3.FromHexString('#18263b'));
    const scrimmageLine = MeshBuilder.CreateBox('football-line-of-scrimmage',
      { width: FIELD_WIDTH_YARDS, height: .006, depth: .16 }, scene);
    scrimmageLine.parent = parent; scrimmageLine.isPickable = false; scrimmageLine.checkCollisions = false;
    scrimmageLine.position.y = FIELD_SURFACE_Y + .016;
    const lineMaterial = material('football-scrimmage-blue', Color3.FromHexString('#168cff'));
    lineMaterial.emissiveColor = lineMaterial.diffuseColor.clone(); lineMaterial.disableLighting = true;
    lineMaterial.alpha = .8; scrimmageLine.material = lineMaterial; roots.push(scrimmageLine);
    const skins = ['#f2c7a5', '#b77c50', '#67432f'].map((color, index) =>
      material(`football-skin-${index}`, Color3.FromHexString(color)));
    if (visibleFromCount > 0) {
      const benchMaterial = material('football-bench', Color3.FromHexString('#a7afb9'));
      for (const side of [-1, 1]) {
        const bench = new TransformNode(`football-bench-${side}`, scene);
        bench.parent = parent;
        bench.position.set(scrimmageBenchSeat(side < 0 ? 0 : 11).x, -.48, 0);
        roots.push(bench);
        const seat = MeshBuilder.CreateBox(`football-bench-seat-${side}`,
          { width: .55, height: .08, depth: 12.2 }, scene);
        const teamMaterial = side < 0 ? offense : defense;
        seat.parent = bench; seat.position.y = .43; seat.material = teamMaterial; seat.isPickable = false;
        const back = MeshBuilder.CreateBox(`football-bench-back-${side}`,
          { width: .08, height: .55, depth: 12.2 }, scene);
        back.parent = bench; back.position.set(side * .32, .75, 0);
        back.material = teamMaterial; back.isPickable = false;
        const text = new DynamicTexture(`football-bench-label-${side}`, { width: 1024, height: 128 }, scene, false);
        text.drawText(side < 0 ? 'OFFENSE TEAM BENCH' : 'DEFENSE TEAM BENCH',
          null, 85, 'bold 65px Arial', 'white', side < 0 ? '#1967d2' : '#c62828', true);
        const labelMaterial = material(`football-bench-label-material-${side}`, Color3.White());
        labelMaterial.diffuseTexture = text;
        const label = MeshBuilder.CreatePlane(`football-bench-label-${side}`, { width: 5, height: .4 }, scene);
        label.parent = bench;
        label.position.set(side * .367, .75, 0);
        label.rotation.y = -side * Math.PI / 2;
        label.material = labelMaterial; label.isPickable = false;
        for (const z of [-5, 0, 5]) {
          const support = MeshBuilder.CreateBox(`football-bench-support-${side}-${z}`,
            { width: .45, height: .39, depth: .16 }, scene);
          support.parent = bench; support.position.set(0, .195, z);
          support.material = benchMaterial; support.isPickable = false;
        }
      }
    }
    for (const { robot, player } of players) {
      setFootballTeam(robot, player.team);
      setRobotFootballMotion(robot, { team: player.team, role: player.label, playStart: visibleFromCount,
        playWindows: sequence, rush: player.rush });
      setRobotColor(robot, player.team === 'offense' ? offense.diffuseColor : defense.diffuseColor);
      // Human football meshes follow the existing route, selection root and leg solver.
      const body = robot.getChildren().find(node => node.name === 'marcherBody');
      const instrument = robot.getChildren().find(node => node.name === 'marcherInstrumentRoot');
      const marker = robot.getChildren().find(node => node.name === 'robotTopDownMarker');
      for (const node of [body, instrument, marker]) {
        if (node instanceof TransformNode) {
          hiddenNodes.push({ node, enabled: node.isEnabled(false) });
          node.setEnabled(false);
        }
      }
      const root = new TransformNode(`football-player-${player.id}`, scene);
      root.parent = robot;
      roots.push(root);
      const symbol = getFootballSymbolTemplate(scene, player.team, TOP_DOWN_MARKER_LAYER_MASK)
        .createInstance('robotTopDownMarker');
      symbol.parent = robot;
      symbol.position.y = 2;
      symbol.layerMask = TOP_DOWN_MARKER_LAYER_MASK;
      symbol.isPickable = false;
      symbol.setEnabled(Number.isFinite(visibleFromCount));
      roots.push(symbol);
      const human = createFootballHumanModel(robot, root, player.team === 'offense' ? offense : defense,
        skins[animations.length % skins.length], white, dark);
      animations.push({ robot, player, root, human });
      const label = new DynamicTexture(`football-label-${player.id}`, { width: 256, height: 128 }, scene, false);
      label.drawText(player.label, null, 90, 'bold 60px Arial', 'white', '#18263b', true);
      const labelMaterial = material(`football-label-material-${player.id}`, Color3.White());
      labelMaterial.diffuseTexture = label; labelMaterial.emissiveColor = Color3.White();
      const plate = MeshBuilder.CreatePlane(`football-role-${player.id}`, { width: .6, height: .3 }, scene);
      plate.parent = root; plate.position.set(0, .3, .19); plate.rotation.y = Math.PI;
      plate.scaling.set(.65, .65, .65);
      plate.material = labelMaterial;
    }
    const ball = MeshBuilder.CreateSphere('football-ball', { diameter: .24, segments: 8 }, scene);
    roots.push(ball);
    ball.parent = parent; ball.scaling.set(1, 1, 1.65); ball.isPickable = false;
    ball.material = material('football-leather', Color3.FromHexString('#754024'));
    const openingKick = events[0]?.kind === 'kick' && events[0].startPosition ? events[0] : null;
    const tee = openingKick ? MeshBuilder.CreateCylinder('football-kicking-tee', {
      diameterTop: .05, diameterBottom: .15, height: .09, tessellation: 8,
    }, scene) : null;
    if (tee && openingKick?.startPosition) {
      tee.parent = parent;
      tee.position.set(openingKick.startPosition.x, FIELD_SURFACE_Y + .045, openingKick.startPosition.z);
      tee.material = material('football-tee-orange', Color3.FromHexString('#ff8f00'));
      tee.isPickable = false; roots.push(tee);
    }
    const halo = MeshBuilder.CreateSphere('football-ball-highlight', { diameter: .65, segments: 12 }, scene);
    halo.parent = ball; halo.isPickable = false;
    const haloMaterial = material('football-highlight-gold', Color3.FromHexString('#ffd54f'));
    haloMaterial.emissiveColor = Color3.FromHexString('#ffd54f'); haloMaterial.alpha = .3;
    halo.material = haloMaterial;
    halo.setEnabled(false);
    const possessionHalo = MeshBuilder.CreateTorus('football-possession-halo',
      { diameter: 1.8, thickness: .08, tessellation: 48 }, scene);
    possessionHalo.parent = parent; possessionHalo.isPickable = false; possessionHalo.checkCollisions = false;
    possessionHalo.scaling.y = .2;
    const possessionMaterial = material('football-possession-gold', Color3.FromHexString('#ffe45c'));
    possessionMaterial.emissiveColor = possessionMaterial.diffuseColor.clone();
    possessionMaterial.disableLighting = true;
    possessionHalo.material = possessionMaterial;
    possessionHalo.setEnabled(false); roots.push(possessionHalo);
    const flightLine = MeshBuilder.CreateLines('football-flight-path', {
      points: Array.from({ length: 33 }, () => Vector3.Zero()), updatable: true,
    }, scene);
    flightLine.parent = parent; flightLine.isPickable = false;
    flightLine.color = Color3.FromHexString('#ffe45c'); flightLine.setEnabled(false);
    disposeFlightLine = () => flightLine.dispose(false, true);
    let flightSignature = '';
    const score = MeshBuilder.CreatePlane('football-score-sign', { width: 5, height: .8 }, scene);
    score.parent = parent; score.isPickable = false; score.setEnabled(false); roots.push(score);
    const scoreTexture = new DynamicTexture('football-score-text', { width: 1024, height: 160 }, scene, false);
    const scoreMaterial = material('football-score-material', Color3.White());
    scoreMaterial.diffuseTexture = scoreTexture; scoreMaterial.emissiveColor = Color3.White();
    score.material = scoreMaterial;
    let scoreText = '';
    const byId = new Map(players.map(({ robot, player }) => [player.id, robot]));
    const tacklePosition = (id: string, count: number) => {
      const robot = byId.get(id);
      return robot && !robot.isDisposed() ? getRobotCounts(robot)?.[count]?.position ?? null : null;
    };
    const validateTackle = (event: FootballTackleEvent, others = tackles) => {
      const last = Math.min(...[event.defenderId, event.carrierId].map(id => {
        const robot = byId.get(id);
        return robot ? (getRobotCounts(robot)?.length ?? 0) - 1 : -1;
      }));
      validateFootballTackle(event, players.map(entry => entry.player), tacklePosition, last, others, events);
      if (event.count < visibleFromCount) throw new Error('Tackles must occur after players enter the field.');
    };
    tackles.forEach(event => validateTackle(event, tackles.filter(other => other !== event)));
    const invalidTackles = new Set<FootballTackleEvent>();
    const seatBeatAt = (beat: number) => {
      for (let index = seatInsertions.length - 1; index >= 0; index--) {
        const insertion = seatInsertions[index];
        if (beat > insertion.at) beat -= Math.min(insertion.amount, beat - insertion.at);
      }
      return beat;
    };
    const activeTacklesAt = (beat: number) => tackles.filter(event => {
      if (floorCalibrationToggle?.checked || !footballTacklePose(event, beat)) return false;
      try {
        validateTackle(event, tackles.filter(other => other !== event));
        invalidTackles.delete(event);
        return true;
      } catch (error) {
        if (!invalidTackles.has(event)) {
          invalidTackles.add(event);
          console.error('Scripted tackle no longer matches edited routes:', error);
          notifyFootball(error instanceof Error ? error.message : String(error));
        }
        return false;
      }
    });
    const positionCache = new Map<number, Map<TransformNode, { x: number; z: number }>>();
    let clearanceSignature = '';
    const clearanceObserver = scene.onBeforeRenderObservable.add(() => {
      const signature = JSON.stringify([floorCalibrationToggle?.checked, visibleFromCount, seatInsertions, tackles,
        events, sequence, players.map(({ robot }) => [robot.isDisposed(), robot.isEnabled(),
          robot.scaling.x, robot.scaling.z, getRobotCounts(robot)?.map(count =>
            [count.position.x, count.position.z, count.rotationY, count.facingY])])]);
      if (signature !== clearanceSignature) { positionCache.clear(); clearanceSignature = signature; }
    }, -1, true);
    disposeClearance = () => scene.onBeforeRenderObservable.remove(clearanceObserver);
    const samplePositions = (beat: number) => {
      const cached = positionCache.get(beat);
      if (cached) return cached;
      const activeTackles = activeTacklesAt(beat);
      const presnap = !floorCalibrationToggle?.checked && Number.isFinite(visibleFromCount)
        ? footballPresnapSpot(events, beat, tacklePosition) : null;
      const entries = players.flatMap(({ robot, player }, playerIndex) => {
        const counts = getRobotCounts(robot);
        if (robot.isDisposed() || !robot.isEnabled() || !counts?.length) return [];
        const time = Math.max(0, Math.min(counts.length - 1, beat)), index = Math.floor(time);
        const from = counts[index], to = counts[Math.min(index + 1, counts.length - 1)];
        const movement = footballMovement({ team: player.team, role: player.label,
          playStart: visibleFromCount, playWindows: sequence, rush: player.rush }, time,
        to.position.x - from.position.x, to.position.z - from.position.z);
        const seated = scrimmageSeatedBlend(seatBeatAt(beat), initialVisibleFromCount);
        const snap = seated === 0 && !floorCalibrationToggle?.checked
          ? events.find(event => event.fromId === player.id && footballSnapPose(event, beat)) : null;
        const snapPose = snap ? footballSnapPose(snap, beat) : null;
        let yaw = seated > 0 ? scrimmageBenchSeat(playerIndex).x < 0 ? Math.PI / 2 : -Math.PI / 2
          : movement.gait === 'ready' ? from.facingY ?? from.rotationY ?? movement.bodyYaw : movement.bodyYaw;
        const tackle = activeTackles.find(event => event.defenderId === player.id || event.carrierId === player.id);
        const fall = tackle ? footballTacklePose(tackle, beat)!.fall : 0;
        if (tackle) {
          const target = footballTackleYaw(tacklePosition(tackle.defenderId, tackle.count)!,
            tacklePosition(tackle.carrierId, tackle.count)!);
          yaw += Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw)) * fall;
        }
        const position = Vector3.Lerp(from.position, to.position, time - index);
        const body = { x: position.x, z: position.z, yaw, fall,
          lean: seated > 0 ? .4 : snapPose ? movement.lean * (1 - snapPose.crouch) + snapPose.lean : movement.lean,
          scale: Math.max(Math.abs(robot.scaling.x), Math.abs(robot.scaling.z)) };
        return [{ robot, body: presnap && seated === 0 && fall === 0
          ? footballPresnapBody(body, player.team, presnap, beat) : body }];
      });
      let positions: ReturnType<typeof separateFootballBodies>;
      try {
        positions = separateFootballBodies(entries.map(entry => entry.body));
      } catch (error) {
        console.error('Football body clearance failed:', error);
        notifyFootball(error instanceof Error ? error.message : String(error));
        throw error;
      }
      const resolved = new Map(entries.map((entry, index) => [entry.robot, positions[index]]));
      const oldest = positionCache.keys().next().value;
      if (positionCache.size >= 128 && oldest !== undefined) positionCache.delete(oldest);
      positionCache.set(beat, resolved);
      return resolved;
    };
    players.forEach(({ robot }) => setFootballPositionSampler(robot, beat => samplePositions(beat).get(robot) ?? null));
    const anchor = (id: string, count: number) => {
      const robot = byId.get(id);
      if (!robot || robot.isDisposed() || !robot.isEnabled()) return null;
      const counts = getRobotCounts(robot);
      if (!counts?.length) return null;
      const beat = Math.max(0, Math.min(counts.length - 1, count));
      const index = Math.floor(beat);
      const position = Vector3.Lerp(counts[index].position, counts[Math.min(index + 1, counts.length - 1)].position, beat - index);
      const resolved = getFootballPlaybackPosition(robot, beat);
      if (resolved) { position.x = resolved.x; position.z = resolved.z; }
      const opening = events.find(event => event.kind === 'snap' && event.fromId === id && beat <= event.startCount);
      if (opening) {
        const spot = tacklePosition(id, opening.startCount);
        if (spot) position.z = spot.z;
      }
      return position.add(new Vector3(0, opening ? opening.startHeight ?? .22
        : players.find(entry => entry.player.id === id)?.player.label === 'H' ? .14 : 1.05, 0));
    };
    const update = () => {
      const currentBeat = getDrillTransportState().beat;
      const spot = footballScrimmageSpot(events, currentBeat, tacklePosition);
      scrimmageLine.setEnabled(!!spot && Number.isFinite(visibleFromCount) && !floorCalibrationToggle?.checked);
      if (spot) scrimmageLine.position.z = spot.z;
      const activeTackles = activeTacklesAt(currentBeat);
      for (const [playerIndex, { robot, player, root, human }] of animations.entries()) {
        const counts = getRobotCounts(robot);
        const index = Math.min(Math.floor(currentBeat), Math.max(0, (counts?.length ?? 1) - 1));
        const from = counts?.[index]?.position;
        const to = counts?.[index + 1]?.position ?? from;
        const motion = { team: player.team, role: player.label, playStart: visibleFromCount,
          playWindows: sequence, rush: player.rush };
        const movement = footballMovement(motion,
          currentBeat, from && to ? to.x - from.x : 0, from && to ? to.z - from.z : 0);
        let steps = (currentBeat - index) * movement.stepsPerCount;
        for (let count = 0; counts && count < index; count++) {
          const a = counts[count].position, b = counts[count + 1].position;
          steps += footballMovement(motion,
            count, b.x - a.x, b.z - a.z).stepsPerCount;
        }
        const phase = steps * Math.PI;
        const bob = movement.stepsPerCount ? Math.abs(Math.sin(phase)) * .04 : 0;
        const seatBeat = seatBeatAt(currentBeat);
        const benchSeated = scrimmageSeatedBlend(seatBeat, initialVisibleFromCount);
        const holding = player.label === 'H' && currentBeat >= visibleFromCount;
        const seated = holding ? .65 : benchSeated;
        const benchSeat = scrimmageBenchSeat(playerIndex);
        const benchYaw = holding ? 0 : benchSeat.x < 0 ? Math.PI / 2 : -Math.PI / 2;
        root.position.y = .98 + (bob - movement.crouch) * (1 - seated) - .38 * seated;
        root.rotation.x = movement.lean * (1 - seated) + .03 * seated;
        const snapEvent = !floorCalibrationToggle?.checked && benchSeated === 0
          ? events.find(event => event.fromId === player.id && footballSnapPose(event, currentBeat)) : null;
        const snap = snapEvent ? footballSnapPose(snapEvent, currentBeat) : null;
        if (snap) {
          root.position.y -= .2 * snap.crouch;
          root.rotation.x = root.rotation.x * (1 - snap.crouch) + snap.lean;
        }
        const bodyYaw = movement.gait === 'ready'
          ? counts?.[index]?.facingY ?? counts?.[index]?.rotationY ?? movement.bodyYaw : movement.bodyYaw;
        root.rotation.y = (seated > 0 ? benchYaw : bodyYaw) - robot.rotation.y;
        const tackle = activeTackles.find(event => event.defenderId === player.id || event.carrierId === player.id);
        const pose = tackle ? footballTacklePose(tackle, currentBeat) : null;
        if (pose && tackle) {
          const a = tacklePosition(tackle.defenderId, tackle.count)!;
          const b = tacklePosition(tackle.carrierId, tackle.count)!;
          const contactYaw = footballTackleYaw(a, b);
          const currentYaw = root.rotation.y + robot.rotation.y;
          const turn = Math.atan2(Math.sin(contactYaw - currentYaw), Math.cos(contactYaw - currentYaw));
          root.rotation.y += turn * pose.fall;
          root.rotation.x = root.rotation.x * (1 - pose.fall) + Math.PI / 2 * pose.fall;
          root.position.y = root.position.y * (1 - pose.fall) + .22 * pose.fall;
        }
        const throwEvent = !floorCalibrationToggle?.checked && seated === 0 && !pose && !snap
          ? events.find(event => event.fromId === player.id && footballThrowPose(event, currentBeat)) : null;
        const throwing = throwEvent ? footballThrowPose(throwEvent, currentBeat) : null;
        const catchEvent = !floorCalibrationToggle?.checked && seated === 0 && !pose && !snap
          ? events.find(event => event.toId === player.id && footballCatchPose(event, currentBeat)) : null;
        const catching = catchEvent ? footballCatchPose(catchEvent, currentBeat) : null;
        human.arms.forEach((arm, side) => {
          arm.rotation.z = 0;
          const normal = seated > 0 ? -.4 : movement.gait === 'block' ? movement.blockArm :
            Math.sin(phase + side * Math.PI) * movement.armSwing;
          arm.rotation.x = pose ? normal * (1 - pose.fall) + (.5 - pose.wrap * .9) * pose.fall : normal;
          if (snap && !pose) arm.rotation.x = arm.rotation.x * (1 - snap.crouch) + snap.arm;
          human.elbows[side].rotation.x = snap && !pose ? -.3
            : seated === 0 && movement.gait === 'block' && !pose ? movement.blockElbow : -1.1;
          if (throwing) {
            const targetArm = side === 1 ? throwing.arm : throwing.supportArm;
            const targetElbow = side === 1 ? throwing.elbow : throwing.supportElbow;
            arm.rotation.x += (targetArm - arm.rotation.x) * throwing.blend;
            human.elbows[side].rotation.x += (targetElbow - human.elbows[side].rotation.x) * throwing.blend;
          } else if (catching) {
            arm.rotation.z = (side === 0 ? 1 : -1) * catching.inward * catching.blend;
            arm.rotation.x += (catching.arm - arm.rotation.x) * catching.blend;
            human.elbows[side].rotation.x += (catching.elbow - human.elbows[side].rotation.x) * catching.blend;
          }
        });
        const kickEvent = events.find(event => (event.kind === 'kick' || event.kind === 'punt') &&
          event.fromId === player.id && currentBeat >= event.startCount - 1 && currentBeat <= event.startCount + 2);
        const kick = !floorCalibrationToggle?.checked && benchSeated === 0 && kickEvent
          ? footballKickPose(kickEvent.startCount, currentBeat) : 0;
        if (kick > 0) {
          const turn = Math.atan2(Math.sin(-root.rotation.y - robot.rotation.y),
            Math.cos(-root.rotation.y - robot.rotation.y));
          root.rotation.y += turn * kick;
          root.rotation.x = root.rotation.x * (1 - kick) - .12 * kick;
          human.arms.forEach((arm, index) => {
            arm.rotation.x = arm.rotation.x * (1 - kick) + (index === 0 ? .7 : -.4) * kick;
          });
        }
        human.updateLegs(seated, benchYaw - robot.rotation.y, pose?.fall ?? 0, kick);
      }
      const activeSegment = sequence?.find(segment => currentBeat >= segment.startCount && currentBeat <= segment.endCount);
      const outcome = outcomes.find(event => currentBeat >= event.count &&
        (event.kind === 'fieldGoal' || !!event.playerId &&
          (tacklePosition(event.playerId, event.count)?.z ?? -Infinity) >= 50));
      score.setEnabled(!!outcome && !floorCalibrationToggle?.checked);
      if (outcome) {
        const text = outcome.kind === 'touchdown' ? 'TOUCHDOWN!' : 'FIELD GOAL!';
        if (scoreText !== text) {
          scoreText = text; scoreTexture.drawText(text, null, 112, 'bold 88px Arial', '#ffe45c', '#18263b', true);
        }
        const point = outcome.playerId ? anchor(outcome.playerId, currentBeat) : new Vector3(0, FIELD_SURFACE_Y + 1, 55);
        if (point) score.position.set(point.x, FIELD_SURFACE_Y + 3, point.z);
      }
      if (sequence && footballStatus && invalidTackles.size === 0) {
        footballStatus.value = outcome ? 'TOUCHDOWN! Drive complete.'
          : activeTackles.length ? activeTackles.some(event =>
            players.find(entry => entry.player.id === event.carrierId)?.player.label === 'QB')
            ? 'Quarterback sack: defender and quarterback fall and recover.'
            : 'Scripted tackle: both players fall and recover.'
          : activeSegment ? `Play ${sequence.indexOf(activeSegment) + 1}/${sequence.length}: ${activeSegment.label}`
          : currentBeat < visibleFromCount ? 'Scrimmage entrance: band exits, teams enter.'
          : currentBeat >= sequence[sequence.length - 1].endCount + 8 ? 'Play sequence complete.'
          : 'Players walking to the next line of scrimmage.';
      }
      if (outcome && footballStatus) footballStatus.value = outcome.kind === 'touchdown' ? 'TOUCHDOWN! Drive complete.' : 'FIELD GOAL! Kick is good.';
      if (!sequence && outcomes.length && !outcome && footballStatus) {
        footballStatus.value = currentBeat < visibleFromCount ? 'Special teams entering the field.'
          : 'Field goal: snap to holder, kicker approach, then kick.';
      }
      let possession: string | null = null;
      const updateBall = () => {
        ball.setEnabled(!floorCalibrationToggle?.checked && currentBeat >= visibleFromCount &&
          (!sequence || !!activeSegment || activeTackles.length > 0 || !!outcome));
        if (!ball.isEnabled()) return;
        const beat = currentBeat;
        let carrier = events[0]?.fromId;
        for (const event of events) {
          if (beat < event.startCount) {
            if (event.startPosition && event === events[0]) {
              ball.position.set(event.startPosition.x, FIELD_SURFACE_Y + event.startPosition.height, event.startPosition.z);
              return;
            }
            break;
          }
          if (beat >= event.endCount) {
            if (event.targetPosition && !events.some(next => next.startCount > event.startCount && beat >= next.startCount)) {
              ball.position.set(event.targetPosition.x, FIELD_SURFACE_Y + event.targetPosition.height, event.targetPosition.z);
              return;
            }
            carrier = event.toId; continue;
          }
          const endpoints = footballFlightEndpoints(event, anchor);
          if (!endpoints) { ball.setEnabled(false); return; }
          const t = (beat - event.startCount) / (event.endCount - event.startCount);
          ball.position.copyFrom(footballFlightPoint(event, endpoints.from, endpoints.to, t));
          if (t === 0 && !event.startPosition) possession = event.launchId ?? event.fromId;
          ball.rotation.z = beat * Math.PI * 2;
          return;
        }
        const position = carrier ? anchor(carrier, beat) : null;
        if (position) {
          const drop = events.find(event => event.kind === 'punt' && event.fromId === carrier &&
            beat >= event.startCount - 1 && beat < event.startCount);
          if (drop) {
            const t = beat - drop.startCount + 1;
            position.y += ((FIELD_SURFACE_Y + (drop.startHeight ?? .3)) - position.y) * t;
          }
          const tackle = activeTackles.find(event => event.carrierId === carrier);
          const fall = tackle ? footballTacklePose(tackle, beat)?.fall ?? 0 : 0;
          const torso = animations.find(entry => entry.player.id === carrier)?.root;
          if (fall > 0 && torso) {
            const inverse = Matrix.Identity();
            parent.computeWorldMatrix(true).invertToRef(inverse);
            const chest = Vector3.TransformCoordinates(new Vector3(0, .3, .19), torso.computeWorldMatrix(true));
            Vector3.LerpToRef(position, Vector3.TransformCoordinates(chest, inverse), fall, position);
          }
          ball.position.copyFrom(position);
          possession = carrier ?? null;
        }
        else ball.setEnabled(false);
      };
      updateBall();
      const carrierRobot = possession ? byId.get(possession) : null;
      const carrierPosition = carrierRobot ? getFootballPlaybackPosition(carrierRobot, currentBeat) : null;
      possessionHalo.setEnabled(ball.isEnabled() && !!carrierPosition);
      if (carrierPosition) {
        possessionHalo.position.set(carrierPosition.x, FIELD_SURFACE_Y + .025, carrierPosition.z);
      }
      tee?.setEnabled(ball.isEnabled() && currentBeat < (openingKick?.startCount ?? 0));
      halo.setEnabled(ball.isEnabled() && !!footballBallHighlight?.checked);
      const flight = events.find(event => ['pass', 'kick', 'punt'].includes(event.kind) &&
        currentBeat >= event.startCount && currentBeat <= event.endCount);
      const endpoints = flight ? footballFlightEndpoints(flight, anchor) : null;
      flightLine.setEnabled(ball.isEnabled() && !!footballFlightPath?.checked && !!endpoints);
      if (flightLine.isEnabled() && flight && endpoints) {
        const signature = JSON.stringify([flight, endpoints.from.asArray(), endpoints.to.asArray()]);
        if (signature !== flightSignature) {
          flightSignature = signature;
          MeshBuilder.CreateLines('football-flight-path', {
            points: Array.from({ length: 33 }, (_, index) =>
              footballFlightPoint(flight, endpoints.from, endpoints.to, index / 32)), instance: flightLine,
          }, scene);
        }
      }
    };
    const observer = scene.onBeforeRenderObservable.add(update);
    disposeObserver = () => { scene.onBeforeRenderObservable.remove(observer); };
    if (Number.isFinite(visibleFromCount)) {
      disposeTackleEditor = initFootballTackleEditor(players.map(entry => entry.player), tackles,
        (event, others) => validateTackle(event, others), () => {
          positionCache.clear(); invalidTackles.clear(); update();
        });
      const shift = (at: number, amount: number) => {
        positionCache.clear();
        seatInsertions.push({ at, amount });
        for (const event of events) {
          if (event.startCount > at) event.startCount += amount;
          if (event.endCount > at) event.endCount += amount;
        }
        for (const segment of sequence ?? []) {
          if (segment.startCount > at) segment.startCount += amount;
          if (segment.endCount > at) segment.endCount += amount;
        }
        for (const event of tackles) if (event.count > at) event.count += amount;
        for (const event of outcomes) if (event.count > at) event.count += amount;
        if (visibleFromCount > at) visibleFromCount += amount;
        players.forEach(({ robot, player }) => setRobotFootballMotion(robot, {
          team: player.team, role: player.label, playStart: visibleFromCount, playWindows: sequence,
        }));
        invalidTackles.clear(); disposeTackleEditor.refresh(); update();
      };
      shiftActiveTimeline = shift;
      releaseTimeline = () => { if (shiftActiveTimeline === shift) shiftActiveTimeline = null; };
    }
    update();
    if (Number.isFinite(visibleFromCount)) {
      disposeFuturePreview = createFootballFuturePreview(players.map(entry => entry.robot), parent, beat => {
        if (sequence) return sequence.find(segment => beat < segment.endCount) ?? null;
        const last = Math.min(...players.map(entry => (getRobotCounts(entry.robot)?.length ?? 0) - 1));
        return beat < last ? { startCount: visibleFromCount, endCount: last, label: 'Selected football play' } : null;
      });
    }
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
