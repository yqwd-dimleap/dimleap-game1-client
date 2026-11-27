import { GameTables } from './GameTables';
import { MAX_ZONE_BONUS, zoneContains, zoneOverlapsCircle } from '../battle/BattleMap';
import { RULES } from '../battle/BattleRuntime';
import type { HeroId, HeroDefinition, Point, Zone } from '../battle/types';
export type { Team, HeroId, Point, ArenaEdges, RailRect, Zone, Deployment, HeroDefinition } from '../battle/types';
export { RULES, arenaEdges, configureArena, configureArenaFromRails } from '../battle/BattleRuntime';
export { DEFAULT_BATTLE_RULES } from './BattleRules';

/** Presentation metadata is code-owned; every numeric hero attribute comes from the tables. */
const PRESENTATION: Record<HeroId, { glyph: string; role: string; description: string; splash?: number }> = {
    swordsman: { glyph: '刀', role: '近战步兵', description: '均衡的近战基础兵种，行动点消耗低。' },
    archer: { glyph: '弓', role: '远程射手', description: '朝上抛射弓箭，在射程内攻击，利用前排掩护持续输出。' },
    cavalry: { glyph: '骑', role: '机动近战', description: '快速接敌，适合侧翼突进与抢占落点。' },
    shield: { glyph: '盾', role: '前排坦克', description: '坚实护甲，以较慢移速和攻击换取生命。' },
    gongnuche: { glyph: '弩', role: '远程直射', description: '按目标左右方位发射重弩，' },
    huopaoche: { glyph: '炮', role: '远程范围', description: '向上抛射炮弹，', splash: 64 },
    guanyu: { glyph: '关', role: '近战群攻', description: '青龙偃月刀横扫前方。', splash: 48 },
    zhangfei: { glyph: '张', role: '近战坦克', description: '以长矛在前排持续作战。' },
    liubei: { glyph: '刘', role: '近战快攻', description: '双股剑持续作战。' },
    lvbu: { glyph: '吕', role: '近战猛将', description: '方天画戟威力强劲。', splash: 36 },
    huangzhong: { glyph: '黄', role: '远程射手', description: '老将百步穿杨。' },
    zhugeliang: { glyph: '诸', role: '远程法师', description: '羽扇运筹，攻击聚集的敌人。', splash: 78 },
    simayi: { glyph: '司', role: '远程法师', description: '以法术攻击远处的敌人。' },
    caocao: { glyph: '曹', role: '近战英雄', description: '率军接敌，稳固前线。' },
    sunquan: { glyph: '孙', role: '远程英雄', description: '从后排持续支援战场。' },
    zhaoyun: { glyph: '赵', role: '近战英雄', description: '以长枪突击敌阵。' },
    zhouyu: { glyph: '周', role: '近战群攻', description: '近身释放火焰，攻击聚集的敌人。', splash: 64 },
    xiaoqiao: { glyph: '小', role: '远程英雄', description: '以风势牵制敌军，为队伍提供支援。' },
    dianwei: { glyph: '典', role: '近战猛将', description: '手持双戟突入前线，持续压制敌人。' },
};
export const HEROES = {} as Record<HeroId, HeroDefinition>;
for (const id of Object.keys(PRESENTATION) as HeroId[]) {
    const meta = PRESENTATION[id];
    const definition = { id, glyph: meta.glyph, role: meta.role, description: meta.description, splash: meta.splash ?? 0 } as HeroDefinition;
    // Explicit descriptors survive Creator's object-spread transform without eagerly evaluating getters during module registration.
    Object.defineProperties(definition, {
        name: { enumerable: true, get: () => GameTables.current.hero(id).name },
        cost: { enumerable: true, get: () => GameTables.current.hero(id).action_point_cost },
        count: { enumerable: true, get: () => GameTables.current.hero(id).initial_count },
        hp: { enumerable: true, get: () => GameTables.current.hero(id).hp },
        damage: { enumerable: true, get: () => GameTables.current.hero(id).attack },
        speed: { enumerable: true, get: () => GameTables.current.hero(id).move_speed_px_s },
        range: { enumerable: true, get: () => GameTables.current.hero(id).attack_range_px },
        attackRate: { enumerable: true, get: () => GameTables.current.hero(id).attack_rate_s },
        attackWait: { enumerable: true, get: () => GameTables.current.hero(id).attack_wait_s },
        attackTier: { enumerable: true, get: () => GameTables.current.hero(id).attack_tier },
    });
    HEROES[id] = definition;
}
/** Half-field is a radius of half the arena height; the diagonal covers every pair of field positions. */
export function heroRange(hero: HeroDefinition, arena: { width: number; height: number } = RULES): number {
    return hero.rangeMode === 'full-field' ? Math.hypot(arena.width, arena.height)
        : hero.rangeMode === 'half-field' ? arena.height / 2 : hero.range;
}
export const HERO_IDS = Object.keys(HEROES) as HeroId[];
/** Temporarily disabled troops retain their resources and saved progression. */
export const DEPLOYABLE_HERO_IDS: HeroId[] = [...HERO_IDS];
let unlockAllHeroesForTesting = false;
/** Runtime test override. The hero store persists it separately from progression. */
export const setHeroUnlockAllOverride = (enabled: boolean): void => { unlockAllHeroesForTesting = enabled; };
export const isHeroUnlockAllOverrideEnabled = (): boolean => unlockAllHeroesForTesting;
export const isDeployableHero = (id: HeroId): boolean => DEPLOYABLE_HERO_IDS.includes(id) &&
    (unlockAllHeroesForTesting || !GameTables.ready || !!GameTables.current.hero(id).initially_unlocked);
export const ZONES: Zone[] = [
    { id: 'left', x: -180, y: 90, radius: 82, bonus: 1 },
    { id: 'center', x: 0, y: -45, radius: 91, bonus: 3 },
    { id: 'right', x: 180, y: 90, radius: 82, bonus: 2 },
];
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export function zoneAt(p: Point, zones: readonly Zone[] = ZONES, radius = 0, minOverlap = 0): Zone | undefined {
    return zones.find(z => radius > 0 ? zoneOverlapsCircle(p, radius, z, minOverlap) : zoneContains(p, z));
}
export function bonusAt(p: Point, zones: readonly Zone[] = ZONES, radius = 0, minOverlap = 0): number {
    return Math.max(0, Math.min(MAX_ZONE_BONUS, zoneAt(p, zones, radius, minOverlap)?.bonus ?? 0));
}
