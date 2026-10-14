import { Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { buildInstrumentTemplate, cachedInstrumentTemplate, InstrumentGeometry, PEARL, SILVER } from './lowPolyInstrument';

// Marching percussion in the same Quest-friendly style as the trumpet: one
// hand-indexed, vertex-colored mesh per instrument, sticks or mallets
// included. Drums are worn on a carrier, so like the sousaphone they are
// modelled directly in marcher instrument-root coordinates (unrotated, origin
// at the marcher's feet, +Z forward, +X to the marcher's right, x and z already
// squashed like the body; see robot.ts). Each exports its [left, right] grips:
// the hands hold the sticks there, poised over the heads.

const NAVY_SHELL = new Color4(0.08, 0.13, 0.3, 1);
const CARRIER = new Color4(0.12, 0.12, 0.13, 1);
const WOOD = new Color4(0.78, 0.6, 0.38, 1);
const FELT = new Color4(0.93, 0.93, 0.9, 1);

// Carrier bar from the chest out to the drum.
function carrier(geometry: InstrumentGeometry, y: number, frontZ: number) {
  geometry.box(new Vector3(-0.03, y - 0.03, 0.1), new Vector3(0.03, y + 0.03, frontZ), CARRIER);
}

// Snare: flat at waist height, a stick in each hand angled in toward the head.
export const SNARE_GRIPS: [Vector3, Vector3] = [new Vector3(-0.1, 0.93, 0.27), new Vector3(0.1, 0.93, 0.27)];

function createSnareTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");
  geometry.drum(new Vector3(0, 0.79, 0.33), Vector3.Up(), 0.18, 0.15, 12, SILVER, PEARL, true);
  carrier(geometry, 0.8, 0.17);
  SNARE_GRIPS.forEach((grip, index) => {
    const side = index === 0 ? -1 : 1;
    geometry.stick(grip.add(new Vector3(side * 0.02, 0.02, -0.06)), new Vector3(side * 0.04, 0.875, 0.42), 0.008, WOOD);
  });
  return buildInstrumentTemplate("snareTemplate", geometry, scene);
}

// Tenors (quads): two larger drums in front, two smaller ones to the sides.
export const TENOR_GRIPS: [Vector3, Vector3] = [new Vector3(-0.11, 0.94, 0.28), new Vector3(0.11, 0.94, 0.28)];

function createTenorTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");
  for (const side of [-1, 1]) {
    geometry.drum(new Vector3(side * 0.115, 0.8, 0.42), Vector3.Up(), 0.11, 0.14, 8, NAVY_SHELL, PEARL);
    geometry.drum(new Vector3(side * 0.25, 0.8, 0.26), Vector3.Up(), 0.09, 0.12, 8, NAVY_SHELL, PEARL);
  }
  carrier(geometry, 0.8, 0.31);
  TENOR_GRIPS.forEach((grip, index) => {
    const side = index === 0 ? -1 : 1;
    geometry.stick(grip.add(new Vector3(side * 0.02, 0.02, -0.06)), new Vector3(side * 0.09, 0.885, 0.43), 0.008, WOOD,
      0.012, FELT);
  });
  return buildInstrumentTemplate("tenorTemplate", geometry, scene);
}

// Bass drum: on its side at chest height, heads facing left and right, a
// felt mallet held upright beside each head.
export const BASS_DRUM_GRIPS: [Vector3, Vector3] = [new Vector3(-0.17, 0.9, 0.36), new Vector3(0.17, 0.9, 0.36)];

function createBassDrumTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");
  geometry.drum(new Vector3(0, 0.9, 0.45), new Vector3(1, 0, 0), 0.25, 0.2, 12, NAVY_SHELL, PEARL, true);
  carrier(geometry, 0.9, 0.21);
  BASS_DRUM_GRIPS.forEach((grip, index) => {
    const side = index === 0 ? -1 : 1;
    geometry.stick(grip.add(new Vector3(0, -0.06, -0.02)), new Vector3(side * 0.14, 1.06, 0.48), 0.008, WOOD,
      0.025, FELT);
  });
  return buildInstrumentTemplate("bassDrumTemplate", geometry, scene);
}

// Glockenspiel (marching bells): a level keyboard on the carrier at waist
// height, its low end to the marcher's left. Silver natural bars (graduated,
// longest at the low end) nearest the player; the sharps on a raised rail
// behind them, grouped in twos and threes. A hard-headed mallet in each hand,
// the left on a natural and the right on a sharp.
export const GLOCKENSPIEL_GRIPS: [Vector3, Vector3] = [new Vector3(-0.12, 0.96, 0.25), new Vector3(0.12, 0.96, 0.25)];

const GLOCK_LEFT = -0.3;
const GLOCK_RIGHT = 0.3;
const GLOCK_TOP = 0.845;
const GLOCK_NATURAL_FRONT = 0.27;
const GLOCK_SHARP_FRONT = 0.43;
const GLOCK_SHARP_TOP = 0.875;
const GLOCK_NATURALS = 11; // C to F
// Sharps sit between these naturals (C#, D#, F#, G#, A#, C#, D#).
const GLOCK_SHARP_AFTER = [0, 1, 3, 4, 5, 7, 8];
const MALLET_HEAD = new Color4(0.75, 0.12, 0.14, 1);

function createGlockenspielTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");
  const pitch = (GLOCK_RIGHT - GLOCK_LEFT - 0.02) / GLOCK_NATURALS;
  const barLeft = (index: number) => GLOCK_LEFT + 0.01 + index * pitch;
  geometry.box(new Vector3(GLOCK_LEFT, 0.79, 0.24), new Vector3(GLOCK_RIGHT, GLOCK_TOP - 0.005, 0.56), CARRIER);
  for (let index = 0; index < GLOCK_NATURALS; index++) {
    const length = 0.14 - (0.04 * index) / (GLOCK_NATURALS - 1);
    geometry.plate(barLeft(index) + 0.004, barLeft(index + 1) - 0.004, GLOCK_TOP,
      GLOCK_NATURAL_FRONT, GLOCK_NATURAL_FRONT + length, SILVER);
  }
  geometry.fine(() => {
    geometry.box(new Vector3(GLOCK_LEFT + 0.02, GLOCK_TOP - 0.01, GLOCK_SHARP_FRONT - 0.01),
      new Vector3(GLOCK_RIGHT - 0.02, GLOCK_SHARP_TOP - 0.003, 0.55), CARRIER);
    for (const after of GLOCK_SHARP_AFTER) {
      const center = barLeft(after + 1);
      geometry.plate(center - pitch * 0.32, center + pitch * 0.32, GLOCK_SHARP_TOP,
        GLOCK_SHARP_FRONT, GLOCK_SHARP_FRONT + 0.1 - 0.025 * (after / 8), SILVER);
    }
  });
  carrier(geometry, 0.8, 0.24);
  const malletTips = [new Vector3(-0.15, GLOCK_TOP + 0.013, 0.34), new Vector3(0.1, GLOCK_SHARP_TOP + 0.013, 0.47)];
  GLOCKENSPIEL_GRIPS.forEach((grip, index) => {
    const side = index === 0 ? -1 : 1;
    geometry.stick(grip.add(new Vector3(side * 0.01, 0.02, -0.06)), malletTips[index], 0.006, WOOD,
      0.012, MALLET_HEAD);
  });
  return buildInstrumentTemplate("glockenspielTemplate", geometry, scene);
}

// Shared, hidden source meshes; clone them (clones share geometry and material).
export const getSnareTemplate = cachedInstrumentTemplate(createSnareTemplate);
export const getTenorTemplate = cachedInstrumentTemplate(createTenorTemplate);
export const getBassDrumTemplate = cachedInstrumentTemplate(createBassDrumTemplate);
export const getGlockenspielTemplate = cachedInstrumentTemplate(createGlockenspielTemplate);
