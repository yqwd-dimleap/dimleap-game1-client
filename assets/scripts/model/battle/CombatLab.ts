import { BattleConfig, createBattleConfig } from './BattleConfig';
import { DEPLOYABLE_HERO_IDS, HeroId, Team } from '../config/PrototypeConfig';
import { heroStats } from '../hero/HeroProgress';
import { CombatModel, UnitState } from './CombatModel';
import { CombatBounds, UNIT_SPACING } from './CombatCollision';

export const LAB_COUNTS = [1, 10, 100, 1000] as const;
export interface LabSettings { count: number; batch: boolean; cached: boolean; grouped: boolean }
export const DEFAULT_LAB: LabSettings = { count: 1, batch: true, cached: false, grouped: false };

/** Every troop is real, at normal size on the same board. Dense allied formations may overlap. */
export function createLabCombat(count: number, config: BattleConfig = createBattleConfig()): { model: CombatModel; total: number } {
    if (!(LAB_COUNTS as readonly number[]).includes(count)) throw new Error(`Invalid lab count: ${count}`);
    const rules = config.rules;
    const total = count * DEPLOYABLE_HERO_IDS.length * 2;
    const bounds: CombatBounds = { x: rules.width / 2 - 24, y: rules.height / 2 - 24 };
    if (rules.centerX || rules.centerY) Object.assign(bounds, { centerX: rules.centerX, centerY: rules.centerY });
    const perTeam = total / 2;
    const columns = Math.min(perTeam, Math.max(2, Math.floor(bounds.x * 1.65 / UNIT_SPACING)));
    const rows = Math.max(1, Math.floor((bounds.y - 100) / UNIT_SPACING) + 1);
    const slots = columns * rows;
    const units: UnitState[] = [];
    for (const team of [0, 1] as Team[]) for (let i = 0; i < perTeam; i++) {
        const hero: HeroId = DEPLOYABLE_HERO_IDS[i % DEPLOYABLE_HERO_IDS.length], stats = heroStats(hero, 1);
        const slot = i % slots, row = Math.floor(slot / columns), col = slot % columns;
        // Repeat the formation with small deterministic offsets, instead of shrinking the army.
        const layer = Math.floor(i / slots), angle = layer * 2.399963229728653;
        const jitter = layer === 0 ? 0 : 10;
        units.push({ id: units.length + 1, team, hero, level: 1, hp: stats.hp, maxHp: stats.hp, cooldown: i % 3 * .06,
            x: rules.centerX + (col - (columns - 1) / 2) * UNIT_SPACING + Math.cos(angle) * jitter,
            y: rules.centerY + (team === 0 ? -1 : 1) * Math.min(bounds.y, 100 + row * UNIT_SPACING + Math.sin(angle) * jitter),
            action: 'walk', facingX: team === 0 ? 1 : -1, facingY: 0, attackSerial: 0, attackUntil: 0 });
    }
    return { model: new CombatModel([], [], { units, bounds, config }), total };
}
