import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import type { MarcherInstrument } from '../robot/robot';
import type { ModelTemplate } from '../robot/lowPolyInstrument';
import { getTrumpetTemplate } from '../robot/trumpetModel';
import { getMellophoneTemplate } from '../robot/mellophoneModel';
import { getTromboneTemplate } from '../robot/tromboneModel';
import { getEuphoniumTemplate } from '../robot/euphoniumModel';
import { getSousaphoneTemplate } from '../robot/sousaphoneModel';
import { getSaxophoneTemplate } from '../robot/saxophoneModel';
import { getBariSaxophoneTemplate } from '../robot/bariSaxophoneModel';
import { getClarinetTemplate } from '../robot/clarinetModel';
import { getFluteTemplate } from '../robot/fluteModel';
import { getSnareTemplate, getTenorTemplate, getBassDrumTemplate, getGlockenspielTemplate } from '../robot/percussionModels';
import { getGuardFlagTemplate, getGuardRifleTemplate, getGuardSabreTemplate } from '../robot/colorGuardModels';

const templates: Record<MarcherInstrument, ModelTemplate> = {
  trumpet: getTrumpetTemplate, mellophone: getMellophoneTemplate,
  trombone: getTromboneTemplate, euphonium: getEuphoniumTemplate,
  sousaphone: getSousaphoneTemplate, altoSax: getSaxophoneTemplate,
  bariSax: getBariSaxophoneTemplate, clarinet: getClarinetTemplate,
  flute: getFluteTemplate, snare: getSnareTemplate,
  tenors: getTenorTemplate, bassDrum: getBassDrumTemplate, glockenspiel: getGlockenspielTemplate,
  guardFlag: getGuardFlagTemplate, guardRifle: getGuardRifleTemplate, guardSabre: getGuardSabreTemplate,
};

export function addInstrumentButtonModel(button: Mesh, instrument: MarcherInstrument, size: number) {
  const scene = button.getScene();
  const model = templates[instrument](scene, 'low').clone(`handMenuInstrument-${instrument}`, null, true);
  if (!model) throw new Error(`Could not create hand-menu instrument: ${instrument}.`);
  model.isVisible = true;
  model.setEnabled(true);
  model.isPickable = false;
  model.rotation.set(0.2, -0.6, 0);
  model.position.setAll(0);
  model.computeWorldMatrix(true);
  model.position.copyFrom(model.getBoundingInfo().boundingBox.centerWorld.scale(-1));
  model.computeWorldMatrix(true);
  const extent = model.getBoundingInfo().boundingBox;
  const width = extent.maximumWorld.x - extent.minimumWorld.x;
  const height = extent.maximumWorld.y - extent.minimumWorld.y;
  const depth = extent.maximumWorld.z - extent.minimumWorld.z;
  const scale = size * 0.78 / Math.max(width, height, depth);
  const pivot = new TransformNode(`handMenuInstrumentRoot-${instrument}`, scene);
  model.parent = pivot;
  pivot.scaling.setAll(scale);
  pivot.parent = button;
  pivot.position.z = -size * 0.35;
  const material = new StandardMaterial(`handMenuInstrumentMaterial-${instrument}`, scene);
  material.diffuseColor = Color3.White();
  material.emissiveColor = new Color3(0.45, 0.45, 0.45);
  material.specularColor = new Color3(0.15, 0.15, 0.15);
  model.material = material;
  model.onDisposeObservable.addOnce(() => material.dispose());
}
