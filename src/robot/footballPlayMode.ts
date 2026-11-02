// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { getDrillTransportState, getRobotCounts, setRobotColor, setRobotFootballMotion,
  createRobotAnimationSampler, getRobotAnimationSignature, setRobotPreparedAnimation,
  addPlaybackPreparationGuard, retryPendingPlaybackStart,
  type PreparedRobotAnimationFrame,
  TOP_DOWN_MARKER_LAYER_MASK } from './robot';
import { FootballAnimationCache } from './footballAnimationCache';
import { sampleFootballUpperPose, type FootballUpperPose } from './footballAnimationPose';
import { MARCHER_THIGH_LENGTH } from './marcherLegPose';
import { footballMovement } from './footballMovement';
import { setFootballTeam, setFootballPositionSampler, getFootballPlaybackPosition } from './footballPresentation';
import { separateFootballBodies } from './footballBodyClearance';
import { getFootballSymbolTemplate } from './footballSymbolModel';
import { createFootballHumanModel } from './footballHumanModel';
import { scrimmageBenchSeat, scrimmageSeatedBlend, SCRIMMAGE_RETURN_COUNTS,
  SCRIMMAGE_SIT_COUNTS, SCRIMMAGE_BAND_RETURN_COUNTS } from './scrimmageGeometry';
import { footballTacklePose, footballTackleYaw, validateFootballTackle, type FootballTackleEvent } from './footballTackles';
import { FOOTBALL_PLAY_LIBRARY } from './footballPlayLibrary';
import { footballFlightEndpoints, footballFlightPoint, footballKickPose, footballSnapPose,
  footballThrowPose, footballReturnThrowYaw } from './footballBallFlight';
import { footballPresnapBody, footballPresnapSpot, footballScrimmageSpot } from './footballLineOfScrimmage';
import { createFootballFuturePreview } from './footballFuturePreview';
import { initFootballSnapPauses } from './footballSnapPauses';
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
function updateScrimmageButton(returnBand: boolean) {
  if (!scrimmageButton || scrimmageButton.dataset.returnBand === String(returnBand)) return;
  scrimmageButton.dataset.returnBand = String(returnBand);
  scrimmageButton.textContent = returnBand ? '🎺 Return band' : '🏈 Start scrimmage';
  scrimmageButton.dispatchEvent(new Event('change'));
}

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
  scrimmage: (formation: FootballFormation, play: FootballPlay) => boolean | void) {
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
      if (scrimmageMode && scrimmage(effectiveFormation, selectedPlay)) {
        notifyFootball('Ending scrimmage: players return to benches while the band marches back to formation.');
        return;
      }
      if (!scrimmageMode) load(effectiveFormation, selectedPlay);
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
  returnStart?: number,
  bandReturnDelay = SCRIMMAGE_RETURN_COUNTS + SCRIMMAGE_SIT_COUNTS,
) {
  const events = inputEvents.map(event => ({ ...event }));
  const sequence = inputSequence?.map(segment => ({ ...segment }));
  const initialVisibleFromCount = visibleFromCount;
  const initialReturnStart = returnStart;
  const seatInsertions: { at: number; amount: number }[] = [];
  const tackles = authoredTackles.map(event => ({ ...event }));
  const outcomes = inputOutcomes.map(event => ({ ...event }));
  let disposeFlightLine = () => {};
  let disposeFuturePreview = () => {};
  let disposeTackleEditor: ReturnType<typeof initFootballTackleEditor> = Object.assign(() => {}, { refresh: () => {} });
  let disposeObserver = () => {};
  let disposeSnapPauses = () => {};
  let releaseTimeline = () => {};
  let disposeClearance = () => {};
  let disposePreparation = () => {};
  let disposeScene = () => {};
  let cleanedUp = false;
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
    if (cleanedUp) return;
    cleanedUp = true;
    disposeScene();
    updateScrimmageButton(false);
    disposeTackleEditor();
    disposeObserver();
    disposeSnapPauses();
    releaseTimeline();
    disposeFlightLine();
    disposeFuturePreview();
    disposeClearance();
    disposePreparation();
    animations.forEach(({ human }) => human.dispose());
    players.forEach(({ robot }) => {
      setRobotFootballMotion(robot, null);
      setFootballTeam(robot, null);
      setFootballPositionSampler(robot, null);
      setRobotPreparedAnimation(robot, null);
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
        playWindows: sequence, rush: player.rush, playEnd: returnStart });
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
    const stepPrefixes = new Map<TransformNode, number[]>();
    const routeSnapshots = new Map<TransformNode, Float64Array>();
    let clearanceSignature = '';
    let animationCache: FootballAnimationCache | null = null;
    let preparationError: Error | null = null;
    let preparationTimer: ReturnType<typeof setTimeout> | undefined;
    let preparing = false;
    let disposed = false;
    let invalidateAnimation = () => {};
    const PLAYER_CHANNELS = 93;
    const checkAnimationInputs = () => {
      const signature = JSON.stringify([visibleFromCount, returnStart, seatInsertions, tackles, events, sequence,
        players.map(({ robot }) => getRobotAnimationSignature(robot, false))]);
      let changed = signature !== clearanceSignature;
      for (const { robot } of players) {
        const counts = getRobotCounts(robot);
        const length = 5 + (counts?.length ?? 0) * 13;
        let snapshot = routeSnapshots.get(robot);
        if (!snapshot || snapshot.length !== length) {
          snapshot = new Float64Array(length);
          routeSnapshots.set(robot, snapshot);
          changed = true;
        }
        const compare = (index: number, value: number) => {
          if (!Object.is(snapshot[index], value)) { snapshot[index] = value; changed = true; }
        };
        compare(0, Number(robot.isDisposed())); compare(1, Number(robot.isEnabled()));
        compare(2, robot.scaling.x); compare(3, robot.scaling.z); compare(4, robot.scaling.y);
        for (let index = 0; counts && index < counts.length; index++) {
          const count = counts[index], offset = 5 + index * 13;
          compare(offset, count.position.x); compare(offset + 1, count.position.z);
          compare(offset + 2, count.rotationY ?? NaN); compare(offset + 3, count.facingY ?? NaN);
          compare(offset + 4, count.position.y); compare(offset + 5, count.styleIndex ?? NaN);
          compare(offset + 6, count.stepPhase ?? NaN);
          const gait = count.bakedGait;
          compare(offset + 7, gait?.gaitIndex ?? NaN); compare(offset + 8, gait?.stepsPerCount ?? NaN);
          compare(offset + 9, gait?.bodyYaw ?? NaN); compare(offset + 10, gait?.legYawOffset ?? NaN);
          compare(offset + 11, gait ? Number(gait.inPlace) : NaN); compare(offset + 12, gait ? Number(gait.sideways) : NaN);
        }
      }
      if (changed) {
        positionCache.clear(); stepPrefixes.clear(); clearanceSignature = signature;
        invalidateAnimation();
      }
    };
    const clearanceObserver = scene.onBeforeRenderObservable.add(checkAnimationInputs, -1, true);
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
          playStart: visibleFromCount, playWindows: sequence, rush: player.rush, playEnd: returnStart }, time,
        to.position.x - from.position.x, to.position.z - from.position.z);
        const seated = scrimmageSeatedBlend(seatBeatAt(beat), initialVisibleFromCount, initialReturnStart);
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
        const returnThrow = seated === 0 && !fall && !snapPose && !floorCalibrationToggle?.checked
          ? events.find(event => event.kind === 'return' && event.fromId === player.id && footballThrowPose(event, beat)) : null;
        if (returnThrow) yaw = footballReturnThrowYaw(returnThrow, beat, yaw, position.x, position.z);
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
    const anchor = (id: string, count: number) => {
      const robot = byId.get(id);
      if (!robot || robot.isDisposed() || !robot.isEnabled()) return null;
      const counts = getRobotCounts(robot);
      if (!counts?.length) return null;
      const beat = Math.max(0, Math.min(counts.length - 1, count));
      const index = Math.floor(beat);
      const position = Vector3.Lerp(counts[index].position, counts[Math.min(index + 1, counts.length - 1)].position, beat - index);
      const resolved = preparing ? samplePositions(beat).get(robot) : getFootballPlaybackPosition(robot, beat);
      if (resolved) { position.x = resolved.x; position.z = resolved.z; }
      const opening = events.find(event => event.kind === 'snap' && event.fromId === id && beat <= event.startCount);
      if (opening) {
        const spot = tacklePosition(id, opening.startCount);
        if (spot) position.z = spot.z;
      }
      return position.add(new Vector3(0, opening ? opening.startHeight ?? .22
        : players.find(entry => entry.player.id === id)?.player.label === 'H' ? .14 : 1.05, 0));
    };
    const unpackRobot = (values: ArrayLike<number>, offset: number): PreparedRobotAnimationFrame => ({
      position: new Vector3(values[offset], values[offset + 1], values[offset + 2]), yaw: values[offset + 3],
      pose: {
        legs: [0, 1].map(side => ({
          thighLength: MARCHER_THIGH_LENGTH, kneeAngle: values[offset + 28 + side],
          legRotation: Quaternion.FromArray(values, offset + 4 + side * 12),
          kneeRotation: Quaternion.FromArray(values, offset + 8 + side * 12),
          ankleRotation: Quaternion.FromArray(values, offset + 12 + side * 12),
        })) as PreparedRobotAnimationFrame['pose']['legs'],
        hipHalfSpacing: values[offset + 30], limited: !!values[offset + 31],
      },
    });
    const cachedRobot = (robot: TransformNode, beat: number) => {
      const index = players.findIndex(entry => entry.robot === robot);
      const values = animationCache?.frameAt(beat);
      return values && index >= 0 ? unpackRobot(values, index * PLAYER_CHANNELS) : null;
    };
    for (const { robot } of players) {
      setRobotPreparedAnimation(robot, beat => cachedRobot(robot, beat));
      setFootballPositionSampler(robot, beat => cachedRobot(robot, beat)?.position ?? null);
    }
    const flightPoints = new Map<FootballBallEvent, Vector3[]>();
    const failPreparation = (error: unknown) => {
      animationCache?.dispose(); animationCache = null;
      preparationError = error instanceof Error ? error : new Error(String(error));
      preparing = false;
      console.error('Football animation preparation failed:', preparationError);
      notifyFootball(`Preparation failed: ${preparationError.message} Edit the play to rebuild; playback is blocked.`);
    };
    const buildAnimation = () => {
      if (events.some(event => !Number.isFinite(event.startCount) || !Number.isFinite(event.endCount) ||
        event.startCount < 0 || event.endCount <= event.startCount)) {
        throw new Error('Football ball flights require finite ordered counts.');
      }
      tackles.forEach(event => validateTackle(event, tackles.filter(other => other !== event)));
      invalidTackles.clear();
      const samplers = players.map(({ robot }) => createRobotAnimationSampler(robot));
      const last = Math.max(0, ...players.map(({ robot }) => (getRobotCounts(robot)?.length ?? 1) - 1));
      const sample = (beat: number) => {
        const resolved = samplePositions(beat);
        const activeTackles = activeTacklesAt(beat);
        const returning = returnStart !== undefined && beat >= returnStart;
        const seated = scrimmageSeatedBlend(seatBeatAt(beat), initialVisibleFromCount, initialReturnStart);
        const upperPoses: FootballUpperPose[] = [];
        const robotFrames: PreparedRobotAnimationFrame[] = [];
        const result: number[] = [];
        for (const [index, { robot, player, human }] of animations.entries()) {
          const frame = samplers[index](beat);
          const point = resolved.get(robot);
          if (point) { frame.position.x = point.x; frame.position.z = point.z; }
          const counts = getRobotCounts(robot) ?? [{ position: frame.position, rotationY: frame.yaw }];
          const motion = { team: player.team, role: player.label, playStart: visibleFromCount,
            playWindows: sequence, rush: player.rush, playEnd: returnStart };
          let prefix = stepPrefixes.get(robot);
          if (!prefix) {
            prefix = [0];
            for (let count = 0; count < counts.length - 1; count++) {
              const a = counts[count].position, b = counts[count + 1].position;
              prefix.push(prefix[count] + footballMovement(motion, count, b.x - a.x, b.z - a.z).stepsPerCount);
            }
            stepPrefixes.set(robot, prefix);
          }
          const upper = sampleFootballUpperPose(player, index, counts, prefix, motion, beat,
            frame.yaw, seated, returning, events, activeTackles, tacklePosition);
          upperPoses.push(upper); robotFrames.push(frame);
          result.push(...frame.position.asArray(), frame.yaw,
            ...frame.pose.legs.flatMap(leg => [...leg.legRotation.asArray(), ...leg.kneeRotation.asArray(), ...leg.ankleRotation.asArray()]),
            frame.pose.legs[0].kneeAngle, frame.pose.legs[1].kneeAngle, frame.pose.hipHalfSpacing, Number(frame.pose.limited),
            upper.height, upper.pitch, upper.yaw, ...upper.arms, ...human.sampleLegs(upper, frame.pose));
        }
        let enabled = !returning && beat >= visibleFromCount &&
          (!sequence || beat < sequence[sequence.length - 1].endCount + 8 || outcomes.some(event => beat >= event.count));
        let point = Vector3.Zero(), rotation = Quaternion.Identity(), possession = -1;
        const sampleBall = () => {
          if (!enabled) return;
          let carrier = events[0]?.fromId;
          for (const event of events) {
            if (beat < event.startCount) {
              if (event.startPosition && event === events[0]) {
                point.set(event.startPosition.x, FIELD_SURFACE_Y + event.startPosition.height, event.startPosition.z);
                return;
              }
              break;
            }
            if (beat >= event.endCount) {
              if (event.targetPosition && !events.some(next => next.startCount > event.startCount && beat >= next.startCount)) {
                point.set(event.targetPosition.x, FIELD_SURFACE_Y + event.targetPosition.height, event.targetPosition.z);
                return;
              }
              carrier = event.toId; continue;
            }
            const endpoints = footballFlightEndpoints(event, anchor);
            if (!endpoints) throw new Error(`Ball flight at count ${event.startCount} has no valid player anchors.`);
            const t = (beat - event.startCount) / (event.endCount - event.startCount);
            point = footballFlightPoint(event, endpoints.from, endpoints.to, t);
            if (t === 0 && !event.startPosition) possession = players.findIndex(entry => entry.player.id === (event.launchId ?? event.fromId));
            rotation = Quaternion.FromEulerAngles(0, 0, beat * Math.PI * 2);
            return;
          }
          const position = carrier ? anchor(carrier, beat) : null;
          if (!position) { enabled = false; return; }
          const drop = events.find(event => event.kind === 'punt' && event.fromId === carrier &&
            beat >= event.startCount - 1 && beat < event.startCount);
          if (drop) position.y += (FIELD_SURFACE_Y + (drop.startHeight ?? .3) - position.y) * (beat - drop.startCount + 1);
          const index = players.findIndex(entry => entry.player.id === carrier);
          const caughtPass = events.find(event => event.kind === 'pass' && event.toId === carrier && beat >= event.endCount &&
            !events.some(next => next.startCount >= event.endCount && next.startCount <= beat && next !== event));
          if (caughtPass && index >= 0) {
            const hands = animations[index].human.sampleHands(upperPoses[index], robotFrames[index]);
            position.copyFrom(hands.position);
            rotation = Quaternion.FromRotationMatrix(Matrix.RotationY(Math.PI / 2).multiply(hands.torso));
          } else if (index >= 0 && upperPoses[index].fall > 0) {
            const torso = animations[index].human.sampleHands(upperPoses[index], robotFrames[index]).torso;
            Vector3.LerpToRef(position, Vector3.TransformCoordinates(new Vector3(0, .3, .19), torso),
              upperPoses[index].fall, position);
          }
          point = position; possession = index;
        };
        sampleBall();
        result.push(...point.asArray(), ...rotation.asArray(), Number(enabled), possession);
        return result;
      };
      animationCache = new FootballAnimationCache(last, players.length * PLAYER_CHANNELS + 9, sample,
        events.flatMap(event => [event.startCount - 1, event.startCount, event.startCount + .175,
          event.startCount + .35, event.startCount + .5, event.startCount + .8, event.startCount + 2,
          event.endCount - 1, event.endCount, event.endCount + .5, event.endCount + 1, event.endCount + 1.5]));
      flightPoints.clear();
      for (const event of events.filter(event => ['pass', 'kick', 'punt', 'return'].includes(event.kind))) {
        const endpoints = footballFlightEndpoints(event, anchor);
        if (!endpoints) throw new Error('Football preparation requires valid ball flight anchors.');
        flightPoints.set(event, Array.from({ length: 33 }, (_, index) => footballFlightPoint(event, endpoints.from, endpoints.to, index / 32)));
      }
    };
    const prepareChunk = () => {
      preparationTimer = undefined;
      if (disposed || preparationError) return;
      checkAnimationInputs();
      if (floorCalibrationToggle?.checked) {
        preparationTimer = setTimeout(prepareChunk, 50); return;
      }
      preparing = true;
      try {
        if (!animationCache) buildAnimation();
        const deadline = performance.now() + 6;
        do { animationCache!.advance(1); } while (!animationCache!.ready && performance.now() < deadline);
        if (animationCache!.ready) {
          preparing = false;
          notifyFootball(`Football animation ready (${Math.ceil(animationCache!.byteLength / 1024 / 1024)} MiB).`);
          retryPendingPlaybackStart();
          return;
        }
        notifyFootball(`Preparing complete football animation: ${Math.floor(animationCache!.progress * 100)}%`);
        preparationTimer = setTimeout(prepareChunk, 0);
      } catch (error) { failPreparation(error); }
    };
    invalidateAnimation = () => {
      animationCache?.dispose(); animationCache = null;
      preparationError = null; preparing = true;
      flightPoints.clear();
      flightSignature = '';
      if (preparationTimer === undefined) preparationTimer = setTimeout(prepareChunk, 0);
    };
    const releaseGuard = addPlaybackPreparationGuard(() => {
      checkAnimationInputs();
      return !floorCalibrationToggle?.checked && !!animationCache?.ready && !preparationError;
    });
    disposePreparation = () => {
      disposed = true;
      if (preparationTimer !== undefined) clearTimeout(preparationTimer);
      animationCache?.dispose(); animationCache = null;
      positionCache.clear(); stepPrefixes.clear(); routeSnapshots.clear(); flightPoints.clear();
      releaseGuard();
    };
    checkAnimationInputs();
    const update = () => {
      const values = animationCache?.frameAt(getDrillTransportState().beat);
      const hidden = !!floorCalibrationToggle?.checked || !values;
      for (const { root } of animations) root.setEnabled(!hidden);
      if (hidden) {
        ball.setEnabled(false); possessionHalo.setEnabled(false); halo.setEnabled(false);
        tee?.setEnabled(false); flightLine.setEnabled(false); score.setEnabled(false); scrimmageLine.setEnabled(false);
        return;
      }
      const currentBeat = animationCache!.sampledBeat(getDrillTransportState().beat);
      const lastCount = Math.max(...players.map(({ robot }) => (getRobotCounts(robot)?.length ?? 1) - 1));
      updateScrimmageButton(returnStart !== undefined && currentBeat < lastCount);
      const spot = footballScrimmageSpot(events, currentBeat, tacklePosition);
      const returning = returnStart !== undefined && currentBeat >= returnStart;
      scrimmageLine.setEnabled(!!spot && Number.isFinite(visibleFromCount) &&
        !returning && !floorCalibrationToggle?.checked);
      if (spot) scrimmageLine.position.z = spot.z;
      const activeTackles = tackles.filter(event => footballTacklePose(event, currentBeat));
      const seatBeat = seatBeatAt(currentBeat);
      for (const [playerIndex, { root, human }] of animations.entries()) {
        const offset = playerIndex * PLAYER_CHANNELS;
        root.position.y = values![offset + 32];
        root.rotation.set(values![offset + 33], values![offset + 34], 0);
        human.arms.forEach((arm, side) => {
          arm.rotation.set(values![offset + 35 + side * 3], 0, values![offset + 36 + side * 3]);
          human.elbows[side].rotation.x = values![offset + 37 + side * 3];
        });
        human.applyLegs(values!, offset + 41);
      }
      const activeSegment = sequence?.find(segment => currentBeat >= segment.startCount && currentBeat <= segment.endCount);
      const outcome = outcomes.find(event => currentBeat >= event.count &&
        (event.kind === 'fieldGoal' || !!event.playerId &&
          (tacklePosition(event.playerId, event.count)?.z ?? -Infinity) >= 50));
      score.setEnabled(!!outcome && !returning && !floorCalibrationToggle?.checked);
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
      if (returning && footballStatus) {
        const elapsed = seatBeatAt(currentBeat) - (initialReturnStart ?? 0);
        footballStatus.value = elapsed >= Math.max(SCRIMMAGE_RETURN_COUNTS + SCRIMMAGE_SIT_COUNTS,
          bandReturnDelay + SCRIMMAGE_BAND_RETURN_COUNTS)
          ? 'Scrimmage complete: teams seated; band back in starting formation.'
          : bandReturnDelay === 0 ? 'Players returning to benches; band marching back to starting formation.'
          : elapsed >= SCRIMMAGE_RETURN_COUNTS + SCRIMMAGE_SIT_COUNTS
            ? 'Teams seated: band marching back to starting formation.'
            : 'Scrimmage complete: players returning to team benches.';
      }
      let possession: string | null = null;
      const ballOffset = players.length * PLAYER_CHANNELS;
      ball.position.set(values![ballOffset], values![ballOffset + 1], values![ballOffset + 2]);
      ball.rotationQuaternion = Quaternion.FromArray(values!, ballOffset + 3);
      ball.setEnabled(!!values![ballOffset + 7]);
      possession = players[values![ballOffset + 8]]?.player.id ?? null;
      const carrierRobot = possession ? byId.get(possession) : null;
      const carrierPosition = carrierRobot ? getFootballPlaybackPosition(carrierRobot, currentBeat) : null;
      possessionHalo.setEnabled(ball.isEnabled() && !!carrierPosition);
      if (carrierPosition) {
        possessionHalo.position.set(carrierPosition.x, FIELD_SURFACE_Y + .025, carrierPosition.z);
      }
      tee?.setEnabled(ball.isEnabled() && currentBeat < (openingKick?.startCount ?? 0));
      halo.setEnabled(ball.isEnabled() && !!footballBallHighlight?.checked);
      const flight = events.find(event => ['pass', 'kick', 'punt', 'return'].includes(event.kind) &&
        currentBeat >= event.startCount && currentBeat <= event.endCount);
      const points = flight ? flightPoints.get(flight) : null;
      flightLine.setEnabled(ball.isEnabled() && !!footballFlightPath?.checked && !!points);
      if (flightLine.isEnabled() && flight && points) {
        const signature = `${events.indexOf(flight)}:${clearanceSignature}`;
        if (signature !== flightSignature) {
          flightSignature = signature;
          MeshBuilder.CreateLines('football-flight-path', {
            points, instance: flightLine,
          }, scene);
        }
      }
    };
    const observer = scene.onBeforeRenderObservable.add(update);
    disposeObserver = () => { scene.onBeforeRenderObservable.remove(observer); };
    disposeSnapPauses = initFootballSnapPauses(events);
    if (Number.isFinite(visibleFromCount)) {
      disposeTackleEditor = initFootballTackleEditor(players.map(entry => entry.player), tackles,
        (event, others) => validateTackle(event, others), () => {
          positionCache.clear(); invalidTackles.clear(); invalidateAnimation(); update();
        });
      const shift = (at: number, amount: number) => {
        positionCache.clear(); stepPrefixes.clear();
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
        if (returnStart !== undefined && returnStart > at) returnStart += amount;
        players.forEach(({ robot, player }) => setRobotFootballMotion(robot, {
          team: player.team, role: player.label, playStart: visibleFromCount, playWindows: sequence,
          rush: player.rush, playEnd: returnStart,
        }));
        invalidTackles.clear(); disposeTackleEditor.refresh(); invalidateAnimation(); update();
      };
      shiftActiveTimeline = shift;
      releaseTimeline = () => { if (shiftActiveTimeline === shift) shiftActiveTimeline = null; };
    }
    update();
    if (Number.isFinite(visibleFromCount)) {
      disposeFuturePreview = createFootballFuturePreview(players.map(entry => entry.robot), parent, beat => {
        if (returnStart !== undefined && beat >= returnStart) return null;
        if (sequence) return sequence.find(segment => beat < segment.endCount) ?? null;
        const last = returnStart ?? Math.min(...players.map(entry => (getRobotCounts(entry.robot)?.length ?? 0) - 1));
        return beat < last ? { startCount: visibleFromCount, endCount: last, label: 'Selected football play' } : null;
      });
    }
    const disposal = scene.onDisposeObservable.addOnce(cleanup);
    disposeScene = () => { scene.onDisposeObservable.remove(disposal); };
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
