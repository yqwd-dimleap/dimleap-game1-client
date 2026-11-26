import type { BattleMatch } from '../model/battle/BattleMatch';
import { GameTables, GAME_TABLE_NAMES, TableDocuments } from '../model/config/GameTables';
import { HeroProfile, HeroProgressStore, STARTER_LINEUP } from '../model/hero/HeroProgress';
import { JsonAsset, resources, sys } from 'cc';
import { AppConfig, parseConfig, resolveApiBaseUrl } from '../core/Config';
import { EventBus } from '../core/EventBus';
import { Res } from '../core/Res';
import { PlayerSave, Save } from '../core/Save';
import { Api } from '../net/Api';
import { CloudClient } from '../net/CloudClient';
import type {
    CloudBattleResult, CloudBattleStart, CloudBootstrap, CloudHeroMutation, CloudLeaderboard, CloudMeritClaim,
} from '../net/CloudTypes';
import { createPlatform } from '../sdk/PlatformFactory';
import { MemoryGuard } from '../sdk/MemoryGuard';
import { bindCoinWallet } from '../ui/main/PlayerGoldView';
import { StartupTrace } from '../core/StartupTrace';
import { assertCompatibleVersion, CLIENT_VERSION } from '../model/config/BuildInfo';
import { SeasonStore } from '../model/season/SeasonStore';
import { PlayerProfile, validatePlayerProfile } from '../model/player/PlayerProfile';
import { HERO_IDS, HeroId } from '../model/config/PrototypeConfig';
import { TutorialStateStore } from '../core/TutorialState';
import { DEBUG } from 'cc/env';

export interface AppEvents {
    'match:finished': { winner: 0 | 1 };
    'settings:changed': PlayerSave;
    'profile:changed': Readonly<PlayerProfile>;
}
export interface FinishMatchResult {
    ok: boolean;
    message: string;
    coins: number;
    starsDelta: number;
    merit: number;
}

const LEGACY_KEYS = [
    'runestone.player.v1',
    'runestone.heroes.v1',
    'runestone.heroes.unlock-all.v1',
    'runestone.guest.v1.web',
    'runestone.guest.v1.wx',
    'runestone.guest.v1.tt',
];

/** Application-level cloud cache and transport coordinator. Gameplay remains client-owned. */
export class GameApp {
    static readonly instance = new GameApp();
    readonly platform = createPlatform();
    readonly events = new EventBus<AppEvents>();
    readonly save = new Save(sys.localStorage);
    readonly tutorial = new TutorialStateStore(sys.localStorage);
    readonly heroes = new HeroProgressStore();
    readonly seasons = new SeasonStore();
    player: PlayerSave = { schema: 1, sound: true, matches: 0 };
    profile!: Readonly<PlayerProfile>;
    battleMatch?: BattleMatch;
    battleStart?: CloudBattleStart;
    config!: AppConfig;
    res!: Res;
    api!: Api;
    cloud!: CloudClient;
    private claimedMilestoneIds: string[] = [];
    private currentSeasonId = '';
    private sessionReady = false;
    private tutorialBattle = false;
    private pending?: Promise<void>;
    private initialized = false;

    initialize(): Promise<void> {
        if (this.initialized) return Promise.resolve();
        if (this.pending) return this.pending;
        this.pending = (async () => {
            MemoryGuard.install();
            this.cleanupLegacyStorage();
            const local = this.save.read();
            this.player = { ...this.player, sound: local.sound };
            const asset = await new Promise<JsonAsset>((resolve, reject) => resources.load('config/app', JsonAsset,
                (error, value) => error ? reject(error) : resolve(value)));
            this.config = parseConfig(asset.json);
            this.res = new Res(this.config, this.platform.kind);
            this.api = new Api(this.platform, resolveApiBaseUrl(this.config));
            this.cloud = new CloudClient(this.api, this.platform);
            const rows = await Promise.all(GAME_TABLE_NAMES.map(async name => {
                const json = await new Promise<JsonAsset>((resolve, reject) => {
                    resources.load(`config/game/${name}`, JsonAsset,
                        (error, value) => error ? reject(error) : resolve(value));
                });
                return [name, json.json] as const;
            }));
            const documents = {} as TableDocuments;
            for (const [name, value] of rows) documents[name] = value;
            GameTables.install(documents);
            this.heroes.configureRemote({
                unlock: id => this.mutateHero('/heroes/unlock', id),
                upgrade: id => this.mutateHero('/heroes/upgrade', id),
                saveLineup: async lineup => {
                    const state = await this.cloud.request<CloudBootstrap>('/player/lineup', {
                        method: 'PUT', body: { lineup },
                    });
                    this.applyBootstrap(state);
                },
            });
            this.seasons.configure(async () => {
                const ranking = await this.cloud.request<CloudLeaderboard>('/leaderboard');
                return {
                    season: {
                        seasonId: this.currentSeasonId,
                        merit: this.player.merit ?? 0,
                        claimedMilestoneIds: [...this.claimedMilestoneIds],
                        ownRank: ranking.ownRank ?? undefined,
                    },
                    entries: ranking.entries.map(entry => ({
                        playerId: entry.playerId,
                        nickname: entry.nickname,
                        rank: entry.rank,
                        netStars: entry.netStars,
                        avatarId: entry.avatarId,
                        isSelf: entry.isSelf,
                    })),
                };
            }, async id => {
                const result = await this.cloud.request<CloudMeritClaim>('/season/rewards/claim', {
                    method: 'POST',
                    body: { rewardId: id },
                });
                await this.refreshBootstrap();
                return { ok: result.claimed, message: result.claimed ? '军功奖励已领取' : '奖励不可领取' };
            });
            bindCoinWallet({
                coins: () => this.heroes.snapshot().coins,
                subscribe: listener => this.heroes.subscribe(listener),
            });
            this.initialized = true;
            if (DEBUG) {
                (globalThis as any).__runeMemory = { snapshot: () => MemoryGuard.snapshot() };
                (globalThis as any).__runeCloud = {
                    snapshot: () => ({
                        profile: this.profile,
                        player: this.player,
                        heroes: this.heroes.snapshot(),
                        battle: this.battleStart,
                        tutorial: {
                            completed: !this.tutorial.needsTutorial(),
                            battle: this.tutorialBattle,
                        },
                        configVersion: this.configVersion,
                    }),
                    resetTutorial: () => this.tutorial.reset(),
                };
                this.installDebugBridge();
            }
            StartupTrace.mark('tables-ready');
            StartupTrace.mark('config-ready');
        })().catch(error => { this.pending = undefined; throw error; });
        return this.pending;
    }

    async checkVersion(): Promise<void> {
        assertCompatibleVersion(CLIENT_VERSION, this.config);
        StartupTrace.mark('version-ready');
    }

    async prepareSession(): Promise<void> {
        if (this.sessionReady && this.profile) return;
        await this.refreshBootstrap();
        this.sessionReady = true;
        StartupTrace.mark('session-ready');
    }

    async refreshBootstrap(): Promise<void> {
        const state = await this.cloud.bootstrap();
        this.applyBootstrap(state);
    }

    async updateProfile(patch: { nickname?: string; avatarId?: number }): Promise<boolean> {
        try {
            const state = await this.cloud.request<CloudBootstrap>('/player/profile', {
                method: 'PATCH', body: patch,
            });
            this.applyBootstrap(state);
            return true;
        } catch (error) {
            console.warn('[Cloud] profile update failed', error);
            return false;
        }
    }

    async startBattle(): Promise<CloudBattleStart> {
        if (this.battleStart) return this.battleStart;
        try {
            this.battleStart = await this.cloud.request<CloudBattleStart>('/battles/start', {
                method: 'POST',
                body: { configVersion: this.configVersion },
            });
            this.syncDebugState();
            return this.battleStart;
        } catch (error) {
            throw new Error(`匹配服务暂不可用：${String(error)}`);
        }
    }

    get isTutorialBattle(): boolean { return this.tutorialBattle; }

    async startTutorialBattle(): Promise<CloudBattleStart> {
        this.tutorialBattle = true;
        const battle = await this.startBattle();
        this.battleStart = { ...battle, map: { ...battle.map, mapId: 'map_1_1' } };
        return this.battleStart;
    }

    completeTutorial(): boolean {
        return this.tutorial.complete();
    }

    abandonBattle(): void {
        this.tutorialBattle = false;
        this.battleStart = undefined;
        this.battleMatch = undefined;
        this.syncDebugState();
    }

    async finishMatch(winner: 0 | 1): Promise<FinishMatchResult> {
        const battle = this.battleStart;
        if (!battle) return { ok: false, message: '缺少服务端对局票据', coins: 0, starsDelta: 0, merit: 0 };
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const result = await this.cloud.request<CloudBattleResult>('/battles/finish', {
                    method: 'POST',
                    body: { ticket: battle.ticket, result: winner === 0 ? 'win' : 'loss' },
                });
                this.player = {
                    ...this.player,
                    matches: result.player.matches,
                    netStars: result.player.netStars,
                    merit: result.player.merit,
                };
                this.profile = this.buildProfile();
                this.heroes.applyCloud({
                    ...this.heroes.snapshot(),
                    coins: result.player.coins,
                });
                this.save.write(this.player);
                this.seasons.invalidate();
                this.events.emit('match:finished', { winner });
                this.events.emit('profile:changed', this.profile);
                this.battleStart = undefined;
                this.battleMatch = undefined;
                this.syncDebugState();
                return {
                    ok: true,
                    message: result.duplicate ? '奖励已确认' : '结算成功',
                    coins: result.reward.coins,
                    starsDelta: result.reward.starsDelta,
                    merit: result.reward.merit,
                };
            } catch (error) {
                lastError = error;
                if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
            }
        }
        console.error('[Cloud] battle settlement failed after retries', lastError);
        return { ok: false, message: `结算失败，请重试：${String(lastError)}`, coins: 0, starsDelta: 0, merit: 0 };
    }

    setSound(sound: boolean): boolean {
        this.player = { ...this.player, sound };
        this.events.emit('settings:changed', this.player);
        return this.save.write(this.player);
    }

    get configVersion(): string { return this.configStateVersion; }
    private configStateVersion = '';

    private async mutateHero(path: string, id: HeroId): Promise<{ coins: number; hero: { level: number; shards: number; unlocked: boolean } }> {
        const result = await this.cloud.request<CloudHeroMutation>(path, { method: 'POST', body: { heroKey: id } });
        return { coins: result.coins, hero: result.hero };
    }

    private applyBootstrap(state: CloudBootstrap): void {
        const { player, heroes, season } = state;
        validatePlayerProfile({
            playerId: player.playerId,
            nickname: player.nickname,
            avatar: player.avatarId,
            netStars: player.netStars,
        });
        this.configStateVersion = state.configVersion;
        this.currentSeasonId = season.seasonId;
        this.claimedMilestoneIds = [...season.claimedMilestoneIds];
        this.player = {
            schema: 1,
            sound: this.player.sound,
            matches: player.matches,
            netStars: player.netStars,
            merit: player.merit,
            identity: {
                playerId: player.playerId,
                nickname: player.nickname,
                avatar: player.avatarId,
            },
        };
        this.profile = this.buildProfile();
        const cloudProfile: HeroProfile = {
            schema: 1,
            coins: player.coins,
            heroes: {} as HeroProfile['heroes'],
            lineup: this.validateLineup(player.lineup, heroes),
        };
        for (const id of HERO_IDS) {
            const entry = heroes[id];
            if (!entry) throw new Error(`云端英雄数据缺少 ${id}`);
            cloudProfile.heroes[id] = {
                level: entry.level,
                shards: entry.shards,
                unlocked: entry.unlocked,
            };
        }
        this.heroes.applyCloud(cloudProfile);
        this.seasons.invalidate();
        this.save.write(this.player);
        this.events.emit('profile:changed', this.profile);
        this.syncDebugState();
    }

    private validateLineup(lineup: readonly (string | null)[], heroes: CloudBootstrap['heroes']): (HeroId | null)[] {
        const valid = Array.from({ length: 5 }, (_, index) => {
            const id = lineup[index];
            return id && HERO_IDS.includes(id as HeroId) && heroes[id]?.unlocked ? id as HeroId : null;
        });
        return valid.some(Boolean) ? valid : [...STARTER_LINEUP, null];
    }

    private buildProfile(): Readonly<PlayerProfile> {
        const identity = this.player.identity;
        if (!identity) throw new Error('云端玩家身份缺失');
        const profile = { playerId: identity.playerId, nickname: identity.nickname, avatar: identity.avatar,
            netStars: this.player.netStars ?? 0 };
        validatePlayerProfile(profile);
        return Object.freeze(profile);
    }

    private cleanupLegacyStorage(): void {
        for (const key of LEGACY_KEYS) {
            try { sys.localStorage.removeItem(key); } catch { /* best effort */ }
        }
    }

    private syncDebugState(): void {
        if (!DEBUG || typeof document === 'undefined') return;
        const heroes = this.heroes.snapshot().heroes;
        document.documentElement.dataset.runeState = JSON.stringify({
            player: this.player,
            huopaoche: heroes.huopaoche,
            unlockedHeroes: HERO_IDS.filter(id => heroes[id].unlocked),
            configVersion: this.configStateVersion,
            claimedMilestoneIds: this.claimedMilestoneIds,
            battle: this.battleStart ? {
                battleId: this.battleStart.battleId,
                difficulty: this.battleStart.difficulty,
                map: this.battleStart.map,
            } : null,
        });
    }

    private installDebugBridge(): void {
        if (!DEBUG || typeof document === 'undefined') return;
        if (!globalThis.location?.search.includes('cloudDebug=1')) return;
        const bind = (id: string, action: () => void): void => {
            let button = document.getElementById(id) as HTMLButtonElement | null;
            if (!button) {
                button = document.createElement('button');
                button.id = id;
                button.type = 'button';
                button.textContent = id.replace('rune-debug-', '');
                button.tabIndex = -1;
                Object.assign(button.style, {
                    position: 'fixed', left: '12px', top: `${64 + document.querySelectorAll('button[id^="rune-debug-"]').length * 30}px`,
                    width: '130px', height: '24px', opacity: '0.92', zIndex: '2147483647',
                });
                document.body.appendChild(button);
            }
            button.onclick = action;
        };
        bind('rune-debug-finish-win', () => { void this.finishMatch(0); });
        bind('rune-debug-finish-loss', () => { void this.finishMatch(1); });
        bind('rune-debug-refresh-cloud', () => { void this.refreshBootstrap(); });
        bind('rune-debug-claim-merit-1', () => { void this.seasons.claimMilestone(1); });
        bind('rune-debug-tutorial-select', () => {
            (globalThis as any).__runePrototype?.select('swordsman');
        });
        bind('rune-debug-tutorial-shoot', () => {
            (globalThis as any).__runePrototype?.shoot(0, 90);
        });
        bind('rune-debug-tutorial-win', () => {
            (globalThis as any).__runePrototype?.forceWin(0);
        });
        bind('rune-debug-return-home', () => {
            (globalThis as any).__runePrototype?.returnHome();
        });
        bind('rune-debug-tutorial-reset', () => {
            this.tutorial.reset();
        });
    }
}
