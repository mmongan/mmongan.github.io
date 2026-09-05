export const FIELD_LENGTH_YARDS = 120;
export const FIELD_WIDTH_YARDS = 53.333;
export const END_ZONE_DEPTH_YARDS = 10;

// Distance from the field's centerline to each hash mark, by level of play.
export const HASH_OFFSETS_YARDS: Record<string, number> = {
  nfl: 3.0833,
  college: 6.6667,
  highschool: 8.8889,
};

// Distance between goalpost uprights, by level of play.
export const GOAL_POST_WIDTH_YARDS: Record<string, number> = {
  nfl: 6.1667,
  college: 6.1667,
  highschool: 7.7778,
};

// Bleacher tier counts and proportions differ a lot by level of play.
export type StandConfig = {
  rows: number;
  standLength: number;
  offset: number;
  hasUpperDeck: boolean;
  upperRows?: number;
  upperStandLength?: number;
};

export const STAND_CONFIGS: Record<string, StandConfig> = {
  highschool: {
    rows: 6,
    standLength: FIELD_LENGTH_YARDS * 0.55,
    offset: 4,
    hasUpperDeck: false,
  },
  college: {
    rows: 11,
    standLength: FIELD_LENGTH_YARDS + 4,
    offset: 4,
    hasUpperDeck: false,
  },
  nfl: {
    rows: 13,
    standLength: FIELD_LENGTH_YARDS + 18,
    offset: 4,
    hasUpperDeck: true,
    upperRows: 9,
    upperStandLength: FIELD_LENGTH_YARDS + 20,
  },
};
