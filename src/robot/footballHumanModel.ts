// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import type { BakedLegPose } from './bakedLegAnimation';

export function createFootballHumanModel(robot: TransformNode, torso: TransformNode,
  jerseyMaterial: StandardMaterial, skin: StandardMaterial, white: StandardMaterial, dark: StandardMaterial,
  brown: StandardMaterial) {
  const scene = robot.getScene();
  const sphere = (name: string, parent: TransformNode, x: number, y: number, z: number,
    width: number, height: number, depth: number, material: StandardMaterial) => {
    const mesh = MeshBuilder.CreateSphere(name, { diameter: 1, segments: 8 }, scene);
    mesh.parent = parent; mesh.position.set(x, y, z); mesh.scaling.set(width, height, depth);
    mesh.material = material;
    return mesh;
  };
  const id = torso.name.replace('football-player-', '');
  sphere(`football-jersey-${id}`, torso, 0, .3, 0, .59, .72, .36, jerseyMaterial);
  sphere(`football-waist-${id}`, torso, 0, -.005, 0, .47, .27, .32, white);
  sphere(`football-neck-${id}`, torso, 0, .65, 0, .14, .19, .14, skin);
  // Helmet modeled on a modern shell (reference: Riddell Speed): deeper
  // front-to-back than wide, enclosing the head down over the ears and jaw,
  // with the face recessed so it sits barely proud of the shell's front
  // window instead of bulging out of it.
  sphere(`football-face-${id}`, torso, 0, .82, .085, .22, .26, .22, skin);
  sphere(`football-helmet-${id}`, torso, 0, .85, -.01, .34, .4, .38, jerseyMaterial);
  // Forward jaw flaps at the sides of the window anchor the face guard.
  for (const side of [-1, 1]) {
    sphere(`football-jaw-${id}-${side}`, torso, side * .13, .71, .09, .11, .13, .14, jerseyMaterial);
  }
  // Center helmet stripe: a thin white sliver proud of the crown, running
  // front to back. Both spheres tessellate coarsely, so it needs real
  // clearance over the shell to surface between the facets.
  sphere(`football-stripe-${id}`, torso, 0, .87, -.01, .05, .42, .39, white);
  sphere(`football-nose-${id}`, torso, 0, .8, .185, .05, .07, .06, skin);
  // Layered eyes (white, brown iris, pupil) under low brows, with a soft
  // mouth shadow in the cage gap, keep the small face readable as a face.
  for (const side of [-1, 1]) {
    sphere(`football-eye-white-${id}-${side}`, torso, side * .05, .85, .19, .055, .032, .015, white);
    sphere(`football-iris-${id}-${side}`, torso, side * .05, .85, .197, .03, .028, .013, brown);
    sphere(`football-pupil-${id}-${side}`, torso, side * .05, .851, .203, .014, .016, .01, dark);
    sphere(`football-brow-${id}-${side}`, torso, side * .052, .876, .188, .05, .013, .02, brown);
  }
  sphere(`football-mouth-${id}`, torso, 0, .757, .182, .042, .011, .012, brown);
  // Front-only two-bar cage: one tube snakes across the top bar, down the
  // right side, and back across the chin bar, attached at the jaw flaps; a
  // short center bar ties the bars together in front of the chin. Nothing
  // wraps behind the head.
  const cagePath: Vector3[] = [];
  const cageArc = (y: number, reverse: boolean) => {
    for (let step = 0; step <= 8; step++) {
      const t = (reverse ? 8 - step : step) / 8 * 2.7 - 1.35;
      cagePath.push(new Vector3(.155 * Math.sin(t), y, .02 + .22 * Math.cos(t)));
    }
  };
  cageArc(.78, false);
  cageArc(.71, true);
  const cage = MeshBuilder.CreateTube(`football-mask-${id}`,
    { path: cagePath, radius: .012, tessellation: 6 }, scene);
  cage.parent = torso; cage.material = white;
  const chinBar = MeshBuilder.CreateCapsule(`football-mask-center-${id}`,
    { height: .13, radius: .011, tessellation: 6, subdivisions: 1 }, scene);
  chinBar.parent = torso; chinBar.position.set(0, .745, .238); chinBar.material = white;
  const arms = [-1, 1].map(side => {
    sphere(`football-shoulder-pad-${id}-${side}`, torso, side * .275, .53, 0, .31, .25, .35, jerseyMaterial);
    const shoulder = new TransformNode(`football-shoulder-${id}-${side}`, scene);
    shoulder.parent = torso; shoulder.position.set(side * .32, .5, 0);
    const upper = MeshBuilder.CreateCapsule(`football-arm-${id}-${side}`,
      { height: .32, radius: .07, tessellation: 8, subdivisions: 1 }, scene);
    upper.parent = shoulder; upper.position.y = -.13; upper.material = skin;
    // Short jersey sleeve over the top of the arm, moving with the shoulder.
    sphere(`football-sleeve-${id}-${side}`, shoulder, 0, -.08, 0, .17, .2, .17, jerseyMaterial);
    const elbow = new TransformNode(`football-elbow-${id}-${side}`, scene);
    elbow.parent = shoulder; elbow.position.y = -.26; elbow.rotation.x = -1.1;
    const forearm = MeshBuilder.CreateCapsule(`football-forearm-${id}-${side}`,
      { height: .29, radius: .058, tessellation: 8, subdivisions: 1 }, scene);
    forearm.parent = elbow; forearm.position.y = -.12; forearm.material = skin;
    sphere(`football-glove-${id}-${side}`, elbow, 0, -.25, 0, .095, .13, .08, white);
    return shoulder;
  });
  const elbows = arms.map(arm => {
    const elbow = arm.getChildren().find(node => node instanceof TransformNode &&
      node.name.startsWith('football-elbow-'));
    if (!(elbow instanceof TransformNode)) throw new Error('Football arm requires an elbow joint.');
    return elbow;
  });
  const hands = elbows.map(elbow => {
    const hand = elbow.getChildren().find(node => node instanceof TransformNode &&
      node.name.startsWith('football-glove-'));
    if (!(hand instanceof TransformNode)) throw new Error('Football arm requires a glove.');
    return hand;
  });
  const legsRoot = new TransformNode(`football-human-legs-${id}`, scene);
  legsRoot.parent = torso;
  const hidden: { node: TransformNode; enabled: boolean }[] = [];
  const restore = () => hidden.forEach(({ node, enabled }) => {
    if (!node.isDisposed()) node.setEnabled(enabled);
  });
  torso.onDisposeObservable.addOnce(restore);
  const rig = robot.getChildren().find(node => node.name === 'marcherLegRoot');
  const legs = rig?.getChildren().filter(node => node.name === 'marcherLeg' && node instanceof TransformNode)
    .map((hip, index) => {
      const knee = hip.getChildren().find(node => node.name === 'marcherKnee');
      const ankle = knee?.getChildren().find(node => node.name === 'marcherAnkle');
      if (!(hip instanceof TransformNode) || !(knee instanceof TransformNode) || !(ankle instanceof TransformNode)) {
        throw new Error('Football human model requires the shared hip/knee/ankle rig.');
      }
      for (const node of [...hip.getChildren(), ...knee.getChildren()]) {
        if (['marcherThigh', 'marcherCalf', 'marcherKneeJoint'].includes(node.name) && node instanceof TransformNode) {
          hidden.push({ node, enabled: node.isEnabled(false) }); node.setEnabled(false);
        }
        for (const node of ankle.getChildren()) {
          if (node.name === 'marcherShoe' && node instanceof TransformNode) {
            hidden.push({ node, enabled: node.isEnabled(false) }); node.setEnabled(false);
          }
        }
      }
      const thigh = MeshBuilder.CreateCapsule(`football-thigh-${id}-${index}`,
        { height: 1, radius: .12, tessellation: 8, subdivisions: 1 }, scene);
      const calf = MeshBuilder.CreateCapsule(`football-calf-${id}-${index}`,
        { height: 1, radius: .08, tessellation: 8, subdivisions: 1 }, scene);
      thigh.parent = calf.parent = legsRoot;
      // Team-colored knee-high socks under white pants.
      thigh.material = white; calf.material = jerseyMaterial;
      const pad = sphere(`football-knee-pad-${id}-${index}`, legsRoot, 0, 0, 0, .17, .18, .18, white);
      const shoe = sphere(`football-cleat-${id}-${index}`, legsRoot, 0, 0, 0, .14, .08, .28, dark);
      return { hip, knee, ankle, thigh, calf, pad, shoe };
    }) ?? [];
  const inverse = Matrix.Identity();
  const local = (node: TransformNode) => Vector3.TransformCoordinates(node.getAbsolutePosition(), inverse);
  const updateLegs = (seated = 0, seatYaw = 0, fall = 0, kick = 0) => {
    robot.computeWorldMatrix(true);
    rig?.computeWorldMatrix(true);
    torso.computeWorldMatrix(true);
    legsRoot.computeWorldMatrix(true).invertToRef(inverse);
    const seatedPoint = (x: number, y: number, z: number) =>
      Vector3.TransformCoordinates(Vector3.TransformCoordinates(
        Vector3.TransformCoordinates(new Vector3(x, y, z), Matrix.RotationY(seatYaw)),
        robot.computeWorldMatrix(true)), inverse);
    for (const [index, { hip, knee, ankle, thigh, calf, pad, shoe }] of legs.entries()) {
      hip.computeWorldMatrix(true);
      knee.computeWorldMatrix(true);
      ankle.computeWorldMatrix(true);
      const x = index === 0 ? -.12 : .12;
      const a = local(hip), b = local(knee), c = local(ankle);
      if (seated > 0) {
        Vector3.LerpToRef(a, seatedPoint(x, .60, 0), seated, a);
        Vector3.LerpToRef(b, seatedPoint(x, .60, .4), seated, b);
        Vector3.LerpToRef(c, seatedPoint(x, .09, .4), seated, c);
      }
      if (fall > 0) {
        Vector3.LerpToRef(a, new Vector3(x, 0, 0), fall, a);
        Vector3.LerpToRef(b, new Vector3(x, -.43, .03), fall, b);
        Vector3.LerpToRef(c, new Vector3(x, -.88, .04), fall, c);
      }
      if (index === 1 && kick > 0) {
        Vector3.LerpToRef(a, new Vector3(x, 0, 0), kick, a);
        Vector3.LerpToRef(b, new Vector3(x, -.24, .35), kick, b);
        Vector3.LerpToRef(c, new Vector3(x, -.42, .75), kick, c);
      }
      for (const [mesh, from, to] of [[thigh, a, b], [calf, b, c]] as const) {
        const direction = to.subtract(from);
        mesh.position.copyFrom(Vector3.Center(from, to));
        mesh.scaling.y = direction.length();
        mesh.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.normalize(), Quaternion.Identity());
      }
      pad.position.copyFrom(b);
      shoe.position.copyFrom(local(ankle));
      if (seated > 0) Vector3.LerpToRef(shoe.position, seatedPoint(x, .05, .47), seated, shoe.position);
      shoe.position.z += (1 - seated) * .07;
      if (fall > 0) Vector3.LerpToRef(shoe.position, new Vector3(x, -.91, .1), fall, shoe.position);
      if (index === 1 && kick > 0) Vector3.LerpToRef(shoe.position, new Vector3(x, -.43, .82), kick, shoe.position);
      shoe.rotationQuaternion = ankle.absoluteRotationQuaternion.clone();
      const parentRotation = legsRoot.absoluteRotationQuaternion.conjugate();
      shoe.rotationQuaternion = parentRotation.multiply(shoe.rotationQuaternion);
      shoe.rotationQuaternion = Quaternion.Slerp(shoe.rotationQuaternion, Quaternion.Identity(), fall);
      if (seated > 0) {
        const seatRotation = parentRotation.multiply(robot.absoluteRotationQuaternion)
          .multiply(Quaternion.FromEulerAngles(0, seatYaw, 0));
        shoe.rotationQuaternion = Quaternion.Slerp(shoe.rotationQuaternion, seatRotation, seated);
      }
    }
  };
  return { arms, elbows, hands, updateLegs, dispose() {
    legsRoot.dispose();
    restore();
  } };
}
