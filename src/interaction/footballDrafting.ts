// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import { footballDraftFrom, footballDraftTo, footballDraftStatus } from '../ui/dom';
import { captureMarcherMovement, restoreMarcherMovement, getRobotCounts, setRobotSetPoses,
  pauseAll, seekToCount, getBlankChartPageState } from '../robot/robot';
import { authorChartPage } from '../robot/chartPageTimeline';
import { sampleDestinationGuide, sampleGuideMarchers, type GuideMarcherSettings } from './guideMarcherLayout';
import { isGuideOnField } from './fieldDrawingGeometry';

export function footballDraftSpan() {
  const from = footballDraftFrom?.value === '' ? NaN : Number(footballDraftFrom?.value);
  const to = footballDraftTo?.value === '' ? NaN : Number(footballDraftTo?.value);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    throw new Error('Choose whole route counts, with destination at or after the start.');
  }
  return { from, to };
}

export function draftFootballGuide(robots: readonly TransformNode[], points: readonly Vector3[],
  mode: 'formation' | 'path' | 'routes', settings?: GuideMarcherSettings) {
  if (!robots.length) throw new Error('Select an existing football lineup or player before converting this guide.');
  if (mode === 'path' && robots.length !== 1) throw new Error('Select one football player for Path.');
  if (!isGuideOnField(points)) throw new Error('Keep the complete football guide inside the field.');
  const { from, to } = footballDraftSpan();
  if (mode !== 'formation' && to === from) throw new Error('Routes need a destination after the start count.');
  const blank = getBlankChartPageState();
  if (blank && blank.count !== to) throw new Error('Use the open blank page as the football destination, or finish it first.');
  if (robots.some(robot => robot.isDisposed() || (!robot.isEnabled() && !blank) || !getRobotCounts(robot)?.[to])) {
    throw new Error('Every chosen player needs a live schedule through the destination count. Add a chart page to extend it.');
  }
  const guidePoses = settings ? sampleGuideMarchers(points, settings) : null;
  const samples = mode === 'path' ? sampleDestinationGuide(points, to - from + 1)
    : guidePoses ? guidePoses.map(pose => pose.position)
    : sampleDestinationGuide(points, robots.length);
  const required = mode === 'path' ? to - from + 1 : robots.length;
  if (samples.length < required) {
    throw new Error('The guide needs distinct points and enough length/spacing for the existing lineup.');
  }
  if (mode === 'path') {
    const counts = getRobotCounts(robots[0])!;
    if (Vector3.Distance(samples[0], counts[from].position) > .25 ||
      Vector3.Distance(samples[samples.length - 1], counts[to].position) > .25) {
      throw new Error("Draw Path between the selected player's existing start and destination (within 0.25 yards). Edit chart sets to move endpoints.");
    }
    samples[0] = counts[from].position.clone();
    samples[samples.length - 1] = counts[to].position.clone();
  }
  pauseAll();
  if (mode === 'formation') {
    const poses = robots.map((robot, index) => ({ robot, position: samples[index],
      ...(guidePoses && { facingY: guidePoses[index].rotationY }) }));
    if (!setRobotSetPoses(to, poses, from, to, scene)) {
      throw new Error('Football formation blocked by overlapping players. Nothing was changed.');
    }
  } else {
    if (mode === 'routes' && !setRobotSetPoses(to, robots.map((robot, index) =>
      ({ robot, position: samples[index] })), from, to, scene)) {
      throw new Error('Football destinations overlap players. Nothing was changed.');
    }
    const plans = robots.map((robot, index) => {
      const snapshot = captureMarcherMovement(robot);
      const counts = snapshot.counts!;
      const route = mode === 'path' ? samples :
        Array.from({ length: to - from + 1 }, (_, count) =>
          Vector3.Lerp(counts[from].position, samples[index], count / (to - from)));
      route.forEach((position, count) => { counts[from + count].position = position.clone(); });
      counts.forEach((count, index) => {
        delete count.bakedGait; delete count.stepPhase;
        if (index < from || index > to) return;
        const next = counts[Math.min(index + 1, to)].position;
        if (Vector3.DistanceSquared(count.position, next) > 1e-8) {
          count.rotationY = Math.atan2(next.x - count.position.x, next.z - count.position.z);
        }
      });
      return { robot, snapshot: { ...snapshot, points: counts.map(count => count.position.clone()) } };
    });
    plans.forEach(({ robot, snapshot }) => restoreMarcherMovement(robot, snapshot));
  }
  authorChartPage(from); authorChartPage(to);
  seekToCount(to);
  const message = `${robots.length} existing football player${robots.length === 1 ? '' : 's'} updated: ` +
    `${mode === 'formation' ? 'formation at' : `route ${from} to`} count ${to}. Lineup identities preserved.`;
  if (footballDraftStatus) footballDraftStatus.value = message;
  return message;
}
