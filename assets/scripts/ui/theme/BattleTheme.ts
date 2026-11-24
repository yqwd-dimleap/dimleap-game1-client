/** Presentation defaults, independent of deployment and simulation rules. */
export const TEAM_COLORS = ['#63DCC7', '#FA907F'] as const;
/** Outline sampling width in atlas texels; capped below the atlas gutters. */
export const TROOP_OUTLINE = Object.freeze({ width: .6, min: 0, max: 1.5, step: .1 });
