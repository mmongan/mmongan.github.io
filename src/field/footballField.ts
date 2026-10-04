import { createTurf } from './turf';
import { createStands } from './stands';
import { createGoalPosts } from './goalPosts';
import { createScoreboard } from './scoreboard';
import { createVideoBoard } from './videoBoard';
import { videoScreenSizeInput, videoScreenSizeValue } from '../ui/dom';

// Assemble the field as a single scene object, with level-specific updates for
// the yard lines, bleachers, and goalposts.
export function createFootballField(): {
  setFieldLevel: (level: string) => void;
  updateVideoBoardProgress: (progress: number | null) => void;
} {
  const { updateFieldLevel } = createTurf();
  const { updateStands } = createStands();
  const { updateGoalPosts } = createGoalPosts();
  createScoreboard();
  const { updateProgress, updateFieldLevel: updateVideoFieldLevel, setScreenSize } = createVideoBoard();

  function updateVideoScreenSize() {
    if (!videoScreenSizeInput) return;
    const percent = Number(videoScreenSizeInput.value);
    setScreenSize(percent / 100);
    if (videoScreenSizeValue) videoScreenSizeValue.value = `${percent}%`;
  }
  videoScreenSizeInput?.addEventListener("input", updateVideoScreenSize);
  updateVideoScreenSize();

  function setFieldLevel(level: string) {
    updateFieldLevel(level);
    updateVideoFieldLevel(level);
    updateGoalPosts(level);
    updateStands(level);
  }

  setFieldLevel("highschool");

  return { setFieldLevel, updateVideoBoardProgress: updateProgress };
}
