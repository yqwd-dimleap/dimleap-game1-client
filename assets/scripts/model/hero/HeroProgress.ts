import { GameTables } from '../config/GameTables';
import { HeroDefinition, HeroId, HEROES, HERO_IDS, DEPLOYABLE_HERO_IDS, isDeployableHero, setHeroUnlockAllOverride, heroRange, Deployment, Zone, ZONES, bonusAt } from '../config/PrototypeConfig';

export const STARTER_LINEUP: HeroId[] = ['swordsman', 'archer', 'shield', 'cavalry'];
export const maxHeroLevel = (): number => GameTables.current.maxHeroLevel;
export interface HeroProgress { level: number; shards: number; unlocked: boolean }
export interface HeroProfile {
    schema: 1; coins: number; heroes: Record<HeroId, HeroProgress>; lineup: (HeroId | null)[];
}
export interface ProgressResult { ok: boolean; message: string }
export interface HeroMutationResult { coins: number; hero: HeroProgress }
export interface HeroRemoteActions {
    unlock(id: HeroId): Promise<HeroMutationResult>;
    upgrade(id: HeroId): Promise<HeroMutationResult>;
    saveLineup(lineup: (HeroId | null)[]): Promise<void>;
}
/** Accumulated growth at this level, shared by the detail popup and combat. */
export function heroGrowth(id: HeroId, level = 1): { hp: number; damage: number } {
    const base = HEROES[id];
    if (!base) throw new Error(`Unknown hero: ${id}`);
    const safe = Number.isFinite(level) ? Math.max(1, Math.min(GameTables.current.maxHeroLevel, Math.floor(level))) : 1;
    const row = GameTables.current.level(safe);
    const increase = (initial: number, multiplier: number): number => {
        const total = initial * multiplier;
        return Math.floor(total - initial + Number.EPSILON * Math.max(1, Math.abs(total)) * 8);
    };
    return { hp: increase(base.hp, row.hp_multiplier), damage: increase(base.damage, row.attack_multiplier) };
}
export function heroStats(id: HeroId, level = 1, arena?: { width: number; height: number }): HeroDefinition {
    const growth = heroGrowth(id, level), base = HEROES[id];
    return { ...base, range: heroRange(base, arena), hp: base.hp + growth.hp, damage: base.damage + growth.damage };
}
export function upgradeCost(level: number): { coins: number; shards: number } {
    const row = GameTables.current.level(level);
    return { coins: row.next_level_gold, shards: row.next_level_fragments };
}
export function unlockCost(id: HeroId): number { return GameTables.current.hero(id).unlock_fragments; }
export function heroCardTier(id: HeroId): 1 | 2 | 3 {
    const tier = GameTables.current.hero(id).tier;
    if (tier !== 1 && tier !== 2 && tier !== 3) throw new Error(`Unsupported hero card tier: ${id}/${tier}`);
    return tier;
}
/** Card readiness describes fragments only. Actual cloud actions still validate both currencies. */
export function heroCardState(id: HeroId, entry: HeroProgress, unlocked = entry.unlocked): {
    tier: 1 | 2 | 3; frame: 0 | 1 | 2 | 3; unlocked: boolean; max: boolean; ready: boolean; required: number; progress: number;
} {
    const tier = heroCardTier(id);
    const max = !GameTables.current.canUpgrade(entry.level);
    const required = !unlocked ? unlockCost(id) : max ? 0 : upgradeCost(entry.level).shards;
    return { tier, frame: unlocked ? tier : 0, unlocked, max, required,
        ready: unlocked ? !max && entry.shards >= required : entry.shards >= required,
        progress: required > 0 ? Math.max(0, Math.min(1, entry.shards / required)) : 1 };
}
export function deploymentTroopCount(token: Deployment, zones: readonly Zone[] = ZONES): number {
    return heroStats(token.hero, token.level).count + bonusAt(token, zones);
}
function defaults(): HeroProfile {
    const heroes = {} as Record<HeroId, HeroProgress>;
    for (const id of HERO_IDS) {
        const unlocked = isDeployableHero(id);
        heroes[id] = { level: 1, shards: 0, unlocked };
    }
    const starters = DEPLOYABLE_HERO_IDS.filter(id => heroes[id].unlocked).slice(0, 5);
    return { schema: 1, coins: 0, heroes, lineup: Array.from({ length: 5 }, (_, index) => starters[index] ?? null) };
}
function validCount(n: unknown): n is number { return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0; }
function validate(data: HeroProfile): boolean {
    return data?.schema === 1 && validCount(data.coins) && HERO_IDS.every(id => {
        const h = data.heroes?.[id];
        return h && validCount(h.level) && h.level >= 1 && h.level <= GameTables.current.maxHeroLevel &&
            validCount(h.shards) && typeof h.unlocked === 'boolean';
    }) && Array.isArray(data.lineup) && data.lineup.length === 5 &&
        data.lineup.every(id => id === null || HERO_IDS.includes(id)) &&
        new Set(data.lineup.filter(Boolean)).size === data.lineup.filter(Boolean).length;
}
/** Cloud-backed progression cache. UI reads snapshots; mutations await the server adapter. */
export class HeroProgressStore {
    private value: HeroProfile = defaults();
    private remote?: HeroRemoteActions;
    private unlockAll = false;
    private changes = new Set<() => void>();
    subscribe(changed: () => void): () => void { this.changes.add(changed); return () => { this.changes.delete(changed); }; }
    configureRemote(actions: HeroRemoteActions): void { this.remote = actions; }
    applyCloud(profile: HeroProfile): void {
        if (!validate(profile)) throw new Error('Invalid cloud hero profile');
        this.value = JSON.parse(JSON.stringify(profile)) as HeroProfile;
        this.emit();
    }
    snapshot(): HeroProfile { return JSON.parse(JSON.stringify(this.value)); }
    level(id: HeroId): number { return this.value.heroes[id]?.level ?? 1; }
    isUnlocked(id: HeroId): boolean { return !!this.value.heroes[id]?.unlocked; }
    unlockAllForTesting(): ProgressResult { return this.setUnlockAllForTesting(true); }
    restoreConfiguredUnlocks(): ProgressResult { return this.setUnlockAllForTesting(false); }
    private setUnlockAllForTesting(enabled: boolean): ProgressResult {
        this.unlockAll = enabled;
        setHeroUnlockAllOverride(enabled);
        this.emit();
        return { ok: true, message: enabled ? '已开放全部英雄（仅测试显示）' : '已恢复服务端英雄开放状态' };
    }
    private commit(next: HeroProfile, message: string): ProgressResult {
        if (!validate(next)) return { ok: false, message: '无效的英雄数据' };
        this.value = next; this.emit();
        return { ok: true, message };
    }
    private emit(): void {
        for (const changed of this.changes) {
            try { changed(); } catch (error) { console.error('[Heroes] view refresh failed', error); }
        }
    }
    async unlock(id: HeroId): Promise<ProgressResult> {
        if (!HERO_IDS.includes(id)) return { ok: false, message: '未知英雄' };
        if (this.value.heroes[id].unlocked) return { ok: true, message: '该英雄已经解锁' };
        const cost = unlockCost(id);
        if (this.value.heroes[id].shards < cost) return { ok: false, message: `需要 ${cost} 片${HEROES[id].name}碎片` };
        if (!this.remote) return { ok: false, message: '云端英雄服务尚未连接' };
        try {
            const result = await this.remote.unlock(id);
            this.value.coins = result.coins;
            this.value.heroes[id] = { ...result.hero };
            this.emit();
            return { ok: true, message: `${HEROES[id].name} 已解锁` };
        } catch (error) {
            return { ok: false, message: `解锁失败：${String(error)}` };
        }
    }
    async select(id: HeroId): Promise<ProgressResult> {
        const next = this.snapshot();
        if (!HERO_IDS.includes(id)) return { ok: false, message: '未知英雄' };
        if (!next.heroes[id].unlocked) return { ok: false, message: '该英雄尚未解锁' };
        if (next.lineup.includes(id)) return { ok: false, message: '该英雄已上场' };
        const index = next.lineup.indexOf(null);
        if (index < 0) return { ok: false, message: '阵容已满，最多上场五名英雄' };
        next.lineup[index] = id;
        if (this.remote) {
            try { await this.remote.saveLineup(next.lineup); }
            catch (error) { return { ok: false, message: `阵容保存失败：${String(error)}` }; }
        }
        return this.commit(next, `${HEROES[id].name} 已加入 ${index + 1} 号位`);
    }
    async remove(id: HeroId): Promise<ProgressResult> {
        const next = this.snapshot(), index = next.lineup.indexOf(id);
        if (index < 0) return { ok: false, message: '该英雄未上场' };
        next.lineup[index] = null;
        if (this.remote) {
            try { await this.remote.saveLineup(next.lineup); }
            catch (error) { return { ok: false, message: `阵容保存失败：${String(error)}` }; }
        }
        return this.commit(next, `${HEROES[id].name} 已下阵`);
    }
    async upgrade(id: HeroId): Promise<ProgressResult> {
        if (!HERO_IDS.includes(id)) return { ok: false, message: '未知英雄' };
        const h = this.value.heroes[id], cost = upgradeCost(h.level);
        if (!h.unlocked) return { ok: false, message: '英雄尚未解锁' };
        if (!GameTables.current.canUpgrade(h.level)) return { ok: false, message: '已达到当前最高等级' };
        if (h.shards < cost.shards || this.value.coins < cost.coins) return { ok: false, message: '英雄碎片或金币不足' };
        if (!this.remote) return { ok: false, message: '云端英雄服务尚未连接' };
        try {
            const result = await this.remote.upgrade(id);
            this.value.coins = result.coins;
            this.value.heroes[id] = { ...result.hero };
            this.emit();
            return { ok: true, message: `${HEROES[id].name} 升至 Lv.${result.hero.level}` };
        } catch (error) {
            return { ok: false, message: `升级失败：${String(error)}` };
        }
    }
}
