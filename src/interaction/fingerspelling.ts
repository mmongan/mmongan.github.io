export type HandPose = readonly number[];
export type LetterSample = readonly HandPose[];
export interface LetterMatch { letter: string; confidence: number }

export function resampleLetterSample(sample: LetterSample, frames = 12): number[][] {
  if (sample.length < 2 || sample.some(pose => pose.length !== 78 || !pose.every(Number.isFinite))) return [];
  return Array.from({ length: frames }, (_, index) => {
    const position = index * (sample.length - 1) / (frames - 1);
    const a = Math.floor(position), b = Math.min(sample.length - 1, a + 1);
    return sample[a].map((value, joint) => {
      const interpolated = value + (sample[b][joint] - value) * (position - a);
      return joint < 75 ? interpolated : (interpolated - sample[0][joint]) / 0.08;
    });
  });
}

export class FingerspellingTemplates {
  private templates = new Map<string, number[][]>();

  get size() { return this.templates.size; }
  get letters() { return [...this.templates.keys()].sort().join(' '); }
  clear() { this.templates.clear(); }

  record(letter: string, sample: LetterSample): boolean {
    const normalized = resampleLetterSample(sample);
    if (!/^[A-Z0-9]$/.test(letter) || normalized.length === 0) return false;
    this.templates.set(letter, normalized);
    return true;
  }

  match(sample: LetterSample): LetterMatch | null {
    const normalized = resampleLetterSample(sample);
    if (normalized.length === 0 || this.templates.size < 2) return null;
    const ranked = [...this.templates].map(([letter, template]) => {
      let sum = 0;
      normalized.forEach((pose, frame) => pose.forEach((value, joint) => {
        sum += (value - template[frame][joint]) ** 2 / (joint < 75 ? 75 : 3);
      }));
      return { letter, distance: Math.sqrt(sum / normalized.length) };
    }).sort((a, b) => a.distance - b.distance);
    const [best, second] = ranked;
    if (best.distance > 0.13 || second.distance - best.distance < 0.025) return null;
    return { letter: best.letter, confidence: Math.max(0, 1 - best.distance / 0.13) };
  }
}
