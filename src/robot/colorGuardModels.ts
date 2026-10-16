import { Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { cachedInstrumentTemplate, buildInstrumentTemplate, InstrumentGeometry, SILVER, PEARL, EBONY } from './lowPolyInstrument';

export const FLAG_GRIPS: [Vector3, Vector3] = [new Vector3(0.16, 1.03, 0.24), new Vector3(0.16, 0.68, 0.24)];
export const RIFLE_GRIPS: [Vector3, Vector3] = [new Vector3(-0.19, 0.87, 0.25), new Vector3(0.18, 0.87, 0.25)];
export const SABRE_GRIPS: [Vector3, Vector3] = [new Vector3(-0.18, 0.87, 0.25), new Vector3(0.2, 0.87, 0.25)];

export const getGuardFlagTemplate = cachedInstrumentTemplate(scene => {
  const geometry = new InstrumentGeometry('instrument');
  geometry.stick(new Vector3(0.16, 0.15, 0.24), new Vector3(0.16, 1.95, 0.24), 0.012, SILVER);
  geometry.box(new Vector3(0.143, 0.14, 0.223), new Vector3(0.177, 0.18, 0.257), EBONY);
  geometry.box(new Vector3(0.143, 1.92, 0.223), new Vector3(0.177, 1.96, 0.257), PEARL);
  const columns = geometry.low ? 4 : 8, rows = geometry.low ? 3 : 6;
  const gold = new Color4(1, 0.73, 0.12, 1), purple = new Color4(0.56, 0.12, 0.76, 1);
  const vertices: number[][] = [];
  for (let row = 0; row <= rows; row++) {
    vertices.push([]);
    for (let column = 0; column <= columns; column++) {
      const u = column / columns, v = row / rows;
      vertices[row].push(geometry.vertex(new Vector3(0.16 + u * 0.86, 1.91 - v * 0.62,
        0.24 + Math.sin(u * Math.PI * 3) * 0.045 * u), v < 0.5 ? purple : gold));
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = vertices[row][column], b = vertices[row][column + 1];
      const c = vertices[row + 1][column], d = vertices[row + 1][column + 1];
      geometry.indices.push(a, b, c, b, d, c);
    }
  }
  return buildInstrumentTemplate('guardFlagTemplate', geometry, scene);
});

export const getGuardRifleTemplate = cachedInstrumentTemplate(scene => {
  const geometry = new InstrumentGeometry('instrument');
  // Solid white parade prop, without firearm mechanisms.
  geometry.box(new Vector3(-0.5, 0.81, 0.22), new Vector3(-0.22, 0.92, 0.28), PEARL);
  geometry.box(new Vector3(-0.24, 0.845, 0.225), new Vector3(0.28, 0.895, 0.275), PEARL);
  geometry.stick(new Vector3(0.25, 0.87, 0.25), new Vector3(0.53, 0.87, 0.25), 0.018, PEARL);
  geometry.box(new Vector3(-0.1, 0.835, 0.217), new Vector3(0.06, 0.855, 0.283), EBONY);
  return buildInstrumentTemplate('guardRifleTemplate', geometry, scene);
});

export const getGuardSabreTemplate = cachedInstrumentTemplate(scene => {
  const geometry = new InstrumentGeometry('instrument');
  geometry.stick(new Vector3(0.12, 0.87, 0.25), new Vector3(0.3, 0.87, 0.25), 0.019, EBONY);
  geometry.tube([new Vector3(0.12, 0.87, 0.25), new Vector3(0.15, 0.78, 0.25),
    new Vector3(0.3, 0.78, 0.25), new Vector3(0.32, 0.87, 0.25)], 0.012, 4, SILVER, Vector3.Forward());
  geometry.box(new Vector3(0.1, 0.82, 0.22), new Vector3(0.12, 0.93, 0.28), SILVER);
  geometry.tube([new Vector3(0.11, 0.87, 0.25), new Vector3(-0.1, 0.88, 0.25),
    new Vector3(-0.35, 0.91, 0.25), new Vector3(-0.6, 0.96, 0.25)],
    [0.017, 0.015, 0.012, 0.002], 3, SILVER, Vector3.Forward());
  return buildInstrumentTemplate('guardSabreTemplate', geometry, scene);
});
