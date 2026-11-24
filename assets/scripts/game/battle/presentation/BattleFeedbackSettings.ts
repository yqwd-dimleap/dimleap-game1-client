import { DEFAULT_BATTLE_RULES } from '../../../model/config/BattleRules';

export interface BattleFeedbackSettings {
    healthBars: boolean;
    damageValues: boolean;
    troopScale: number;
    hitOpacity: number;
    enemyOutlineScale: number;
}

interface FeedbackLimit { min: number; max: number; step: number }

export const DEFAULT_HIT_OPACITY = 0;
export const TROOP_SCALE_LIMIT: Readonly<FeedbackLimit> = Object.freeze({ min: .1, max: 1.5, step: .05 });
export const HIT_OPACITY_LIMIT: Readonly<FeedbackLimit> = Object.freeze({ min: 0, max: 1, step: .05 });
export const ENEMY_OUTLINE_SCALE_LIMIT: Readonly<FeedbackLimit> = Object.freeze({ min: 0, max: 2.5, step: .1 });

export function feedbackValue(value: number, fallback: number, limit: FeedbackLimit): number {
    const finite = Number.isFinite(value) ? value : fallback;
    const stepped = Math.round(Math.max(limit.min, Math.min(limit.max, finite)) / limit.step) * limit.step;
    return Number(stepped.toFixed(4));
}

const SETTINGS_KEY = '__runestone_battle_feedback_v1';
const host = globalThis as typeof globalThis & { [SETTINGS_KEY]?: Partial<BattleFeedbackSettings> };
const settings = (host[SETTINGS_KEY] ?? {}) as BattleFeedbackSettings;
settings.healthBars = typeof settings.healthBars === 'boolean' ? settings.healthBars : true;
settings.damageValues = typeof settings.damageValues === 'boolean' ? settings.damageValues : true;
settings.troopScale = feedbackValue(settings.troopScale, DEFAULT_BATTLE_RULES.troopScale, TROOP_SCALE_LIMIT);
settings.hitOpacity = feedbackValue(settings.hitOpacity, DEFAULT_HIT_OPACITY, HIT_OPACITY_LIMIT);
settings.enemyOutlineScale = feedbackValue(settings.enemyOutlineScale, 1, ENEMY_OUTLINE_SCALE_LIMIT);
host[SETTINGS_KEY] = settings;

/**
 * Shared visual defaults across the hero attack test and battle chunks for the
 * lifetime of the running game. Updating this object is enough for both.
 */
export const BATTLE_FEEDBACK: BattleFeedbackSettings = settings;
