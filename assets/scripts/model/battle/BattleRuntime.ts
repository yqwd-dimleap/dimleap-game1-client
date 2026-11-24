import { DEFAULT_BATTLE_RULES, BattleRules } from '../config/BattleRules';
import type { ArenaEdges, RailRect } from './types';

/** Active editor/physics settings. Pure simulations receive a copied BattleConfig instead. */
export const RULES: BattleRules = { ...DEFAULT_BATTLE_RULES };

// The four authored rail inner faces own the arena; BoardRoot remains the visual coordinate space.
export function configureArena(width: number, height: number, centerX = 0, centerY = 0): void {
    if (![width, height, centerX, centerY].every(Number.isFinite) ||
        width <= RULES.tokenRadius * 2 || height <= RULES.tokenRadius * 2) {
        throw new Error(`Invalid arena size: ${width} × ${height}`);
    }
    RULES.width = width; RULES.height = height; RULES.centerX = centerX; RULES.centerY = centerY;
}

export function arenaEdges(margin = 0): ArenaEdges {
    return { left: RULES.centerX - RULES.width / 2 + margin, right: RULES.centerX + RULES.width / 2 - margin,
        bottom: RULES.centerY - RULES.height / 2 + margin, top: RULES.centerY + RULES.height / 2 - margin };
}

/** Collider rectangles are expressed in BoardRoot coordinates, including their offset and scale. */
export function configureArenaFromRails(rails: Record<'left' | 'right' | 'top' | 'bottom', RailRect>): void {
    for (const rail of Object.values(rails)) if (![rail.x, rail.y, rail.width, rail.height].every(Number.isFinite) || rail.width <= 0 || rail.height <= 0)
        throw new Error('Invalid arena rail rectangle');
    const left = rails.left.x + rails.left.width / 2, right = rails.right.x - rails.right.width / 2;
    const bottom = rails.bottom.y + rails.bottom.height / 2, top = rails.top.y - rails.top.height / 2;
    for (const rail of [rails.left, rails.right]) if (rail.y - rail.height / 2 > bottom || rail.y + rail.height / 2 < top)
        throw new Error('Arena side rail leaves a corner gap');
    for (const rail of [rails.top, rails.bottom]) if (rail.x - rail.width / 2 > left || rail.x + rail.width / 2 < right)
        throw new Error('Arena end rail leaves a corner gap');
    configureArena(right - left, top - bottom, (left + right) / 2, (bottom + top) / 2);
}

