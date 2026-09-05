import { createTurf } from './turf';
import { createHashMarks, createYardNumbers } from './markings';
import { createStands } from './stands';
import { createGoalPosts } from './goalPosts';
import { createScoreboard } from './scoreboard';
import { createVideoBoard } from './videoBoard';

export function createFootballField(): { setFieldLevel: (level: string) => void } {
  const { whiteMaterial, sidelineMat } = createTurf();
  const { updateHashMarks } = createHashMarks(whiteMaterial);
  createYardNumbers();
  const { updateStands } = createStands();
  const { updateGoalPosts } = createGoalPosts(sidelineMat);
  createScoreboard();
  createVideoBoard();

  function setFieldLevel(level: string) {
    updateHashMarks(level);
    updateGoalPosts(level);
    updateStands(level);
  }

  setFieldLevel("highschool");

  return { setFieldLevel };
}
