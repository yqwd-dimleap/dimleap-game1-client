import { DEFAULT_BATTLE_RULES, BattleRules } from '../config/BattleRules';
import { RULES } from './BattleRuntime';
import type { Zone } from './types';

export interface ArenaConfig { readonly width: number; readonly height: number; readonly centerX: number; readonly centerY: number }
export interface BattleConfig {
    readonly arena: ArenaConfig;
    readonly rules: Readonly<BattleRules>;
    readonly zones: readonly Zone[];
}
/** Copy mutable scene/GM input once. Another arena or GM must not silently change this match. */
export function createBattleConfig(zones: readonly Zone[] = [], source: Readonly<BattleRules> = RULES): BattleConfig {
    const rules = Object.freeze({ ...DEFAULT_BATTLE_RULES, ...source });
    const arena = Object.freeze({ width: rules.width, height: rules.height, centerX: rules.centerX, centerY: rules.centerY });
    const copied = zones.map(zone => {
        const polygon = zone.polygon?.map(point => Object.freeze({ ...point }));
        if (polygon) Object.freeze(polygon);
        return Object.freeze({ ...zone, polygon });
    });
    return Object.freeze({ arena, rules, zones: Object.freeze(copied) });
}
