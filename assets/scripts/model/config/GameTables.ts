import { rangedAttack } from '../battle/CombatTiming';
import type { HeroId } from '../battle/types';

export const GAME_TABLE_NAMES = ['hero_config', 'hero_level_config', 'item_config', 'ai_difficulty_config', 'rank_config', 'season_merit_reward', 'season_ranking_reward'] as const;
export type GameTableName = typeof GAME_TABLE_NAMES[number];
export type TableDocuments = Record<GameTableName, unknown>;
export interface HeroRow { name: string; hp: number; attack: number; move_speed_px_s: number; attack_rate_s: number; attack_wait_s: number; attack_range_px: number; initial_count: number; action_point_cost: number; fragment_item_id: number; initially_unlocked: number; unlock_fragments: number; tier: number; tier_name: string; attack_tier: 1 | 2 }
export interface LevelRow { hp_multiplier: number; attack_multiplier: number; next_level_gold: number; next_level_fragments: number; can_upgrade: number }
export interface ItemRow { name: string; tier: number; tier_name: string; item_type: string }
export interface AIRow { name: string; enemy_hero_level: number; aim_error_deg: number; power_error_ratio: number; bonus_zone_weight: number; displace_enemy_weight: number }
export interface RankRow { name: string; division_start: number; min_stars: number; max_stars: number; stars_per_division: number; is_repeating: number; repeat_start: number; name_template: string; ai_difficulty_id: number }
export interface MeritReward { id: number; requiredMerit: number; items: readonly { id: number; amount: number }[] }
export interface RankingReward { id: number; name: string; minRank: number; maxRank: number; items: readonly { id: number; amount: number }[] }
/** IDs are the stable bridge between existing saved string IDs and designer-owned numeric IDs. */
export const HERO_TABLE_IDS: Record<HeroId, number> = { swordsman: 1, archer: 2, cavalry: 3, shield: 4, huopaoche: 5, gongnuche: 6,
    guanyu: 7, zhangfei: 8, simayi: 9, zhugeliang: 10, liubei: 11, caocao: 12, huangzhong: 13, sunquan: 14,
    zhaoyun: 15, lvbu: 16, zhouyu: 17, xiaoqiao: 18, dianwei: 19 };
const HERO_BY_TABLE_ID = Object.entries(HERO_TABLE_IDS).reduce<Record<string, HeroId>>((byId, [hero, id]) => {
    byId[String(id)] = hero as HeroId;
    return byId;
}, {});
type Rows<T> = Readonly<Record<string, Readonly<T>>>;
function table<T>(name: GameTableName, value: unknown, positive: string[], integers: string[], texts: string[], flags: string[] = [],
    nonnegative: string[] = []): Rows<T> {
    if (!value || Array.isArray(value) || typeof value !== 'object' || !Object.keys(value).length) throw new Error(`${name}: empty or invalid table`);
    const result: Record<string, Readonly<T>> = {};
    for (const [id, row] of Object.entries(value)) {
        if (!/^[1-9]\d*$/.test(id) || !row || Array.isArray(row) || typeof row !== 'object') throw new Error(`${name}/${id}: invalid record`);
        for (const field of [...positive, ...nonnegative, ...integers]) {
            const n = (row as any)[field];
            if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (positive.includes(field) && n <= 0) || (integers.includes(field) && !Number.isSafeInteger(n)))
                throw new Error(`${name}/${id}/${field}: invalid number`);
        }
        for (const field of texts) if (typeof (row as any)[field] !== 'string' || !(row as any)[field]) throw new Error(`${name}/${id}/${field}: missing text`);
        for (const field of flags) if (![0, 1].includes((row as any)[field])) throw new Error(`${name}/${id}/${field}: expected 0 or 1`);
        result[id] = Object.freeze({ ...row }) as Readonly<T>;
    }
    return Object.freeze(result);
}

/** Validates all six documents before publishing. Pure data: no Cocos/resource imports. */
export class GameTables {
    private static value?: GameTables;
    static get ready(): boolean { return !!this.value; }
    static get current(): GameTables { if (!this.value) throw new Error('Game tables have not loaded'); return this.value; }
    static install(documents: TableDocuments): GameTables { const next = new GameTables(documents); this.value = next; return next; }
    readonly heroes: Rows<HeroRow>;
    readonly levels: Rows<LevelRow>;
    readonly items: Rows<ItemRow>;
    readonly ai: Rows<AIRow>;
    readonly ranks: Rows<RankRow>;
    readonly milestones: readonly MeritReward[];
    readonly seasonRankingRewards: readonly RankingReward[];
    readonly maxHeroLevel: number;
    constructor(documents: TableDocuments) {
        this.heroes = table('hero_config', documents.hero_config, ['hp', 'attack', 'move_speed_px_s', 'attack_range_px'],
            ['initial_count', 'action_point_cost', 'fragment_item_id', 'unlock_fragments', 'tier', 'attack_tier'],
            ['name', 'tier_name'], ['initially_unlocked'], ['attack_rate_s', 'attack_wait_s']);
        this.levels = table('hero_level_config', documents.hero_level_config, ['hp_multiplier', 'attack_multiplier'], ['next_level_gold', 'next_level_fragments'], [], ['can_upgrade']);
        this.items = table('item_config', documents.item_config, [], ['tier'], ['name', 'tier_name', 'item_type']);
        this.ai = table('ai_difficulty_config', documents.ai_difficulty_config, ['enemy_hero_level'], ['enemy_hero_level'], ['name']);
        // max_stars intentionally permits -1 for the last, unbounded rank.
        this.ranks = table('rank_config', documents.rank_config, ['stars_per_division'], ['min_stars', 'division_start', 'repeat_start', 'ai_difficulty_id'], ['name', 'name_template'], ['is_repeating']);
        this.maxHeroLevel = Object.keys(this.levels).length;
        for (let i = 1; i <= this.maxHeroLevel; i++) if (!this.levels[i]) throw new Error(`hero_level_config: missing level ${i}`);
        for (const [id, key] of Object.entries(HERO_TABLE_IDS)) {
            const h = this.heroes[key];
            if (!h || !h.initial_count || !h.action_point_cost || this.items[h.fragment_item_id]?.item_type !== 'hero_fragment') throw new Error(`hero_config/${id}: missing hero/fragment item`);
        }
        for (const [id, hero] of Object.entries(this.heroes)) {
            if (hero.attack_tier !== 1 && hero.attack_tier !== 2) throw new Error(`hero_config/${id}/attack_tier: expected 1 or 2`);
            const expectedTier = rangedAttack(HERO_BY_TABLE_ID[id]) ? 2 : 1;
            if (hero.attack_tier !== expectedTier)
                throw new Error(`hero_config/${id}/attack_tier: does not match combat attack definition`);
            if (hero.attack_tier === 1 && (hero.attack_rate_s <= 0 || hero.attack_wait_s !== 0))
                throw new Error(`hero_config/${id}: melee requires attack_rate_s > 0 and attack_wait_s = 0`);
            if (hero.attack_tier === 2 && (hero.attack_wait_s <= 0 || hero.attack_rate_s !== 0))
                throw new Error(`hero_config/${id}: ranged requires attack_wait_s > 0 and attack_rate_s = 0`);
        }
        const usedFragments = Object.values(this.heroes).map(row => row.fragment_item_id);
        if (new Set(usedFragments).size !== usedFragments.length) throw new Error('hero_config: duplicate fragment item');
        for (const [id, row] of Object.entries(this.ai)) {
            if (!this.levels[row.enemy_hero_level]) throw new Error(`ai_difficulty_config/${id}: unknown enemy level`);
            for (const field of ['aim_error_deg', 'power_error_ratio', 'bonus_zone_weight', 'displace_enemy_weight'] as const)
                if (!Number.isFinite(row[field]) || row[field] < 0 || (field === 'power_error_ratio' && row[field] > 1)) throw new Error(`ai_difficulty_config/${id}/${field}: invalid number`);
        }
        let previousMax = -1;
        for (const [id, row] of this.rankEntries()) {
            if (!this.ai[row.ai_difficulty_id] || !Number.isSafeInteger(row.max_stars) || row.max_stars < -1 || row.min_stars !== previousMax + 1 || (row.max_stars !== -1 && row.max_stars < row.min_stars)) throw new Error(`rank_config/${id}: invalid rank interval/AI`);
            previousMax = row.max_stars;
        }
        if (previousMax !== -1) throw new Error('rank_config: last rank must be unbounded');
        const rewards = table<Record<string, number>>('season_merit_reward', documents.season_merit_reward, [],
            ['required_merit', ...Array.from({ length: 6 }, (_, i) => [`item_${i + 1}`, `amount_item_${i + 1}`]).reduce((a, b) => a.concat(b), [])], []);
        this.milestones = Object.freeze(Object.entries(rewards).map(([id, row]) => {
            const items: { id: number; amount: number }[] = [];
            for (let i = 1; i <= 6; i++) {
                const item = row[`item_${i}`], amount = row[`amount_item_${i}`];
                if (item <= 0) {
                    if (amount !== 0) throw new Error(`season_merit_reward/${id}: amount requires a positive item id`);
                    continue;
                }
                if (!this.items[item]) throw new Error(`season_merit_reward/${id}: unknown item ${item}`);
                if (amount <= 0) throw new Error(`season_merit_reward/${id}: item ${item} requires a positive amount`);
                items.push(Object.freeze({ id: item, amount }));
            }
            return Object.freeze({ id: Number(id), requiredMerit: row.required_merit, items: Object.freeze(items) });
        }).sort((a, b) => a.requiredMerit - b.requiredMerit || a.id - b.id));
        const rankingRows = documents.season_ranking_reward;
        if (!rankingRows || Array.isArray(rankingRows) || typeof rankingRows !== 'object' || !Object.keys(rankingRows).length)
            throw new Error('season_ranking_reward: empty or invalid table');
        let previousRank = 0;
        this.seasonRankingRewards = Object.freeze(Object.entries(rankingRows).map(([key, value]) => {
            if (!/^[1-9]\d*$/.test(key) || !value || Array.isArray(value) || typeof value !== 'object')
                throw new Error(`season_ranking_reward/${key}: invalid record`);
            const row = value as Record<string, unknown>;
            const minRank = row.min_rank, maxRank = row.max_rank;
            if (typeof row.name !== 'string' || !row.name) throw new Error(`season_ranking_reward/${key}: missing name`);
            if (!Number.isSafeInteger(minRank) || (minRank as number) <= 0 ||
                !Number.isSafeInteger(maxRank) || ((maxRank as number) !== -1 && (maxRank as number) < (minRank as number)))
                throw new Error(`season_ranking_reward/${key}: invalid rank interval`);
            if ((minRank as number) !== previousRank + 1) throw new Error(`season_ranking_reward/${key}: rank intervals must be contiguous`);
            previousRank = maxRank as number;
            const items: { id: number; amount: number }[] = [];
            for (let index = 1; index <= 3; index++) {
                const itemId = row[`item_${index}`], amount = row[`amount_item_${index}`];
                if (!Number.isSafeInteger(itemId) || !Number.isSafeInteger(amount) || (itemId as number) < 0 || (amount as number) < 0)
                    throw new Error(`season_ranking_reward/${key}: invalid item ${index}`);
                if ((itemId as number) === 0) {
                    if ((amount as number) !== 0) throw new Error(`season_ranking_reward/${key}: amount requires a positive item id`);
                    continue;
                }
                if (!this.items[itemId as number]) throw new Error(`season_ranking_reward/${key}: unknown item ${itemId}`);
                if ((amount as number) <= 0) throw new Error(`season_ranking_reward/${key}: item ${itemId} requires a positive amount`);
                items.push(Object.freeze({ id: itemId as number, amount: amount as number }));
            }
            if (!items.length) throw new Error(`season_ranking_reward/${key}: no reward items`);
            return Object.freeze({
                id: Number(key), name: row.name, minRank: minRank as number, maxRank: maxRank as number,
                items: Object.freeze(items),
            });
        }).sort((a, b) => a.minRank - b.minRank || a.id - b.id));
        if (previousRank !== -1) throw new Error('season_ranking_reward: last rank interval must be unbounded');
    }
    hero(id: HeroId): Readonly<HeroRow> { return this.heroes[HERO_TABLE_IDS[id]]; }
    level(level: number): Readonly<LevelRow> { return this.levels[Math.max(1, Math.min(this.maxHeroLevel, Number.isFinite(level) ? Math.floor(level) : 1))]; }
    canUpgrade(level: number): boolean { return !!this.levels[level]?.can_upgrade && !!this.levels[level + 1]; }
    private rankEntries(): [string, Readonly<RankRow>][] { return Object.entries(this.ranks).sort((a, b) => a[1].min_stars - b[1].min_stars); }
    rank(stars: number): { id: number; name: string; row: Readonly<RankRow>; ai: Readonly<AIRow> } {
        const value = Math.max(0, Number.isFinite(stars) ? Math.floor(stars) : 0);
        const [id, row] = this.rankEntries().find(([, r]) => value >= r.min_stars && (r.max_stars === -1 || value <= r.max_stars))!;
        const n = row.repeat_start + Math.floor((value - row.min_stars) / row.stars_per_division);
        return { id: Number(id), name: row.name_template.replace('{name}', row.name).replace('{n}', String(n)), row, ai: this.ai[row.ai_difficulty_id] };
    }
    rewardText(reward: MeritReward): string { return reward.items.map(item => `${this.items[item.id].name} ×${item.amount}`).join('、'); }
}
