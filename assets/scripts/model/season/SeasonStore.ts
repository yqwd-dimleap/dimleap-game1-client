import type { SeasonRankEntry, SeasonState } from './SeasonState';
import { createPrototypeSeasonRanking } from './SeasonRanking';
import type { MeritReward } from '../config/GameTables';
import { GameTables } from '../config/GameTables';

export interface SeasonSnapshot { season: SeasonState; entries: readonly SeasonRankEntry[] }
export type SeasonSource = () => Promise<SeasonSnapshot>;
export type MeritClaimSource = (id: number) => Promise<{ ok: boolean; message: string }>;
export interface MeritClaimResult { ok: boolean; message: string; reward?: MeritReward }

/** Shared across page eviction. A server adapter supplies the actual season/ranking request. */
export class SeasonStore {
    private source?: SeasonSource;
    private claimSource?: MeritClaimSource;
    private cached?: SeasonSnapshot;
    private expires = 0;
    private generation = 0;
    private pending?: Promise<SeasonSnapshot | undefined>;
    private prototype: SeasonSnapshot = {
        season: { seasonId: 'local-prototype', merit: 50, claimedMilestoneIds: [], ownRank: 37 },
        entries: createPrototypeSeasonRanking({ selfRank: 37 }),
    };
    constructor(private ttl = 30000, private now = () => Date.now()) {}
    get available(): boolean { return !!this.source; }
    configure(source: SeasonSource, claimSource?: MeritClaimSource): void {
        this.source = source;
        this.claimSource = claimSource;
        this.invalidate();
        this.cached = undefined;
    }
    prototypeSnapshot(): SeasonSnapshot { return this.clone(this.prototype); }
    setPrototypePlayer(player: { playerId: string; nickname: string; avatar: number; netStars: number }): void {
        const entries = createPrototypeSeasonRanking({
            selfRank: this.prototype.season.ownRank ?? 37,
            selfPlayerId: player.playerId,
            selfNickname: player.nickname,
            selfAvatarId: player.avatar,
            selfNetStars: player.netStars,
        });
        this.prototype = {
            season: { ...this.prototype.season, ownRank: entries.find(entry => entry.isSelf)?.rank },
            entries,
        };
        if (!this.source) { this.cached = undefined; this.expires = 0; }
    }
    setPrototypeMerit(merit: number): void {
        this.prototype = { ...this.prototype, season: { ...this.prototype.season, merit: Math.max(0, Math.floor(Number.isFinite(merit) ? merit : 0)) } };
        if (!this.source) { this.cached = undefined; this.expires = 0; }
    }
    invalidate(): void { this.generation++; this.expires = 0; this.pending = undefined; }
    load(): Promise<SeasonSnapshot | undefined> {
        if (!this.source) return Promise.resolve(undefined);
        if (this.cached && this.now() < this.expires) return Promise.resolve(this.cached);
        if (this.pending) return this.pending;
        const generation = this.generation;
        const source = this.source;
        const task = Promise.resolve().then(() => source()).then(result => {
            if (generation !== this.generation) return undefined;
            this.cached = this.clone(result); this.expires = this.now() + this.ttl; return this.cached;
        });
        this.pending = task;
        const clear = (): void => { if (this.pending === task) this.pending = undefined; };
        void task.then(clear, clear);
        return task;
    }
    async claimMilestone(id: number): Promise<MeritClaimResult> {
        const reward = GameTables.current.milestones.find(row => row.id === id);
        if (!reward) return { ok: false, message: '未知军功奖励' };
        if (this.claimSource) {
            const result = await this.claimSource(id);
            if (!result.ok) return result;
            this.invalidate();
            await this.load();
            return { ...result, reward };
        }
        const snapshot = this.source ? await this.load() : this.clone(this.prototype);
        if (!snapshot) return { ok: false, message: '赛季数据不可用' };
        const claimed = snapshot.season.claimedMilestoneIds;
        if (claimed.includes(String(id))) return { ok: false, message: '该奖励已经领取' };
        if (snapshot.season.merit < reward.requiredMerit) return { ok: false, message: '军功值尚未达到' };
        const next: SeasonSnapshot = this.clone({ ...snapshot, season: { ...snapshot.season, claimedMilestoneIds: [...claimed, String(id)] } });
        this.cached = next; this.expires = this.now() + this.ttl;
        if (!this.source) this.prototype = next;
        return { ok: true, message: '军功奖励已领取', reward };
    }
    private clone(value: SeasonSnapshot): SeasonSnapshot {
        return { season: { ...value.season, claimedMilestoneIds: [...value.season.claimedMilestoneIds] }, entries: value.entries.map(entry => ({ ...entry })) };
    }
}
