import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { FIELD_LENGTH_YARDS, FIELD_SURFACE_Y, FIELD_WIDTH_YARDS } from '../field/constants';
import { measureDraftLine, sampleDraftSpline } from './draftingGeometry';

export const DRAFTING_WORKSPACE_KEY = 'chartxr.draftingWorkspace.v1';

export interface WorkspaceGuide {
  points: Vector3[];
  options: {
    editable?: 'yarn' | 'spline';
    controls?: Vector3[];
    label?: string;
    measure?: boolean;
    divisions?: Vector3[];
    sticky?: boolean;
  };
}

export interface DraftingWorkspace {
  version: 1;
  guides: WorkspaceGuide[];
  settings: {
    spacing: number;
    angle: number;
    text: string;
    offsetSide: number;
    parallelReference: boolean;
    gridVisible: boolean;
    gridInterval: number;
  };
}

export function serializeDraftingWorkspace(workspace: DraftingWorkspace): string {
  const plainPoints = (items: Vector3[]) => items.map(point => ({ x: point.x, z: point.z }));
  const json = JSON.stringify({
    ...workspace,
    guides: workspace.guides.map(guide => ({
      points: plainPoints(guide.points),
      options: {
        ...guide.options,
        controls: guide.options.controls ? plainPoints(guide.options.controls) : undefined,
        divisions: guide.options.divisions ? plainPoints(guide.options.divisions) : undefined,
      },
    })),
  });
  parseDraftingWorkspace(json);
  return json;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid workspace object.');
  return value as Record<string, unknown>;
}

function numberIn(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('Invalid workspace numeric setting.');
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid workspace toggle.');
  return value;
}

function points(value: unknown, min: number, max: number): Vector3[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('Invalid guide point count.');
  return value.map(item => {
    const point = record(item);
    return new Vector3(
      numberIn(point.x, -FIELD_WIDTH_YARDS / 2, FIELD_WIDTH_YARDS / 2),
      FIELD_SURFACE_Y + 0.025,
      numberIn(point.z, -FIELD_LENGTH_YARDS / 2, FIELD_LENGTH_YARDS / 2)
    );
  });
}

export function parseDraftingWorkspace(json: string): DraftingWorkspace {
  if (json.length > 8_000_000) throw new Error('Saved workspace is too large.');
  const source = record(JSON.parse(json));
  if (source.version !== 1) throw new Error('Unsupported drafting workspace version.');
  if (!Array.isArray(source.guides) || source.guides.length > 100) throw new Error('Invalid workspace guide count.');
  const guides: WorkspaceGuide[] = source.guides.map(item => {
    const guide = record(item), options = record(guide.options);
    const result: WorkspaceGuide = { points: points(guide.points, 2, 512), options: {} };
    if (options.editable !== undefined) {
      if (options.editable !== 'yarn' && options.editable !== 'spline') throw new Error('Invalid editable guide type.');
      result.options.editable = options.editable;
      const controls = points(options.controls, options.editable === 'spline' ? 3 : 2,
        options.editable === 'spline' ? 3 : 64);
      if (controls.some((p, i) => i > 0 && Vector3.Distance(p, controls[i - 1]) < 0.05)) {
        throw new Error('Saved drafting pins are too close together.');
      }
      result.options.controls = controls;
      result.points = options.editable === 'spline' ? sampleDraftSpline(controls) : controls.map(p => p.clone());
    } else if (options.controls !== undefined) throw new Error('Unexpected guide controls.');
    if (measureDraftLine(result.points).yards < 0.05) throw new Error('Saved guide is too short.');
    if (options.label !== undefined) {
      if (typeof options.label !== 'string' || options.label.length > 160) throw new Error('Invalid guide label.');
      result.options.label = options.label;
    }
    if (options.measure !== undefined) result.options.measure = boolean(options.measure);
    if (options.sticky !== undefined) result.options.sticky = boolean(options.sticky);
    if (options.divisions !== undefined) result.options.divisions = points(options.divisions, 2, 513);
    return result;
  });
  const settings = record(source.settings);
  const angle = numberIn(settings.angle, 30, 90);
  if (![30, 45, 60, 90].includes(angle)) throw new Error('Invalid set-square angle.');
  const offsetSide = numberIn(settings.offsetSide, -1, 1);
  if (Math.abs(offsetSide) !== 1) throw new Error('Invalid offset side.');
  if (typeof settings.text !== 'string' || settings.text.length > 80) throw new Error('Invalid annotation text.');
  return {
    version: 1, guides,
    settings: {
      spacing: numberIn(settings.spacing, 0.05, 20), angle, text: settings.text, offsetSide,
      parallelReference: boolean(settings.parallelReference), gridVisible: boolean(settings.gridVisible),
      gridInterval: numberIn(settings.gridInterval, 0.5, 20),
    },
  };
}
