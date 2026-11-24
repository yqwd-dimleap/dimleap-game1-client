import { _decorator, Component, instantiate, isValid, Node, Prefab, SpriteFrame } from 'cc';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';
import { SeasonView } from '../../ui/season/SeasonView';
import { VirtualList } from '../../ui/common/virtual-list/VirtualList';
import type { SeasonRankEntry, SeasonState } from '../../model/season/SeasonState';
import { SeasonStore } from '../../model/season/SeasonStore';
import type { ModalPresenter } from '../../ui/common/ModalHost';
import { RankItemView } from '../../ui/season/RankItemView';
import type { RankItemAssets } from '../../ui/season/RankItemView';
import { loadPlayerAvatars } from '../../ui/common/PlayerUIAssets';
import { topSeasonRanking } from '../../model/season/SeasonRanking';
import type { RankLevelAssets } from '../../ui/season/RankLevelView';
import { GameTables, HERO_TABLE_IDS } from '../../model/config/GameTables';
import type { HeroId } from '../../model/battle/types';
import { HERO_ICON_PATHS } from '../../model/hero/HeroPortraits';
import { SeasonRewardPopupView } from '../../ui/season/SeasonRewardPopupView';
import type { SeasonRewardPopupAssets } from '../../ui/season/SeasonRewardPopupView';

interface LoadedSeasonRewardAssets extends SeasonRewardPopupAssets {
    popup: Prefab;
}

/** Owns page lifetime; the application store owns requests/cache across page eviction. */
@_decorator.ccclass('SeasonController')
export class SeasonController extends Component {
    private generation = 0;
    private disposed = false;
    private view!: SeasonView;
    private list?: VirtualList;
    private store!: SeasonStore;
    private stars = 0;
    private modals?: ModalPresenter;
    private rankItemAssets?: RankItemAssets;
    private rankLevelAssets?: RankLevelAssets;
    private current?: SeasonState;
    private resources?: ResourceScope;
    private rewardAssets?: LoadedSeasonRewardAssets;
    private rewardPopup?: Node;
    private rewardRequest = 0;
    private rewardIconLoad?: Promise<void>;

    async initialize(resources: ResourceScope, store: SeasonStore, stars = 0, modals?: ModalPresenter): Promise<void> {
        const [row, avatars, top, other, self, badges, titleBackgrounds] = await Promise.all([
            resources.load(BUNDLES.seasonContent, 'ui/prefabs/season/RankItem', Prefab, undefined, 'critical'),
            loadPlayerAvatars(resources, 'normal'),
            Promise.all([1, 2, 3].map(rank =>
                resources.load(BUNDLES.seasonContent, `ui/textures/rank/ranking_${rank}_item/spriteFrame`, SpriteFrame, undefined, 'normal'))),
            resources.load(BUNDLES.seasonContent, 'ui/textures/rank/ranking_other_item/spriteFrame', SpriteFrame, undefined, 'normal'),
            resources.load(BUNDLES.seasonContent, 'ui/textures/rank/ranking_my_item/spriteFrame', SpriteFrame, undefined, 'normal'),
            Promise.all(Array.from({ length: 11 }, (_, index) =>
                resources.load(BUNDLES.ui, `textures/level/level_${index + 1}/spriteFrame`, SpriteFrame, undefined, 'normal'))),
            Promise.all(Array.from({ length: 11 }, (_, index) =>
                resources.load(BUNDLES.ui, `textures/level/title_bg_${index + 1}/spriteFrame`, SpriteFrame, undefined, 'normal'))),
        ]);
        if (!isValid(this, true) || this.disposed) throw new Error('Season page was destroyed while loading');
        this.resources = resources; this.store = store; this.stars = stars; this.modals = modals;
        this.rankLevelAssets = { badges, titleBackgrounds };
        this.rankItemAssets = { avatars, top, other, self, rankLevel: this.rankLevelAssets };
        this.view = new SeasonView(this.node); this.list = new VirtualList(this.view.scroll, row, 112);
        this.view.bindSeasonRewards(() => { void this.openSeasonRewards(); });
        this.setEntries([]);
    }

    show(): void { void this.refresh(); }
    hide(): void {
        this.generation++; this.rewardRequest++;
        if (this.rewardPopup && isValid(this.rewardPopup, true)) this.modals?.close(this.rewardPopup);
    }

    private async refresh(): Promise<void> {
        const generation = ++this.generation;
        if (this.store.available) this.view.status('正在获取赛季和排行榜…');
        try {
            const result = this.store.available ? await this.store.load() : this.store.prototypeSnapshot();
            if (this.disposed || generation !== this.generation || !isValid(this.view.node, true) || !result) return;
            this.current = result.season;
            const entries = topSeasonRanking(result.entries);
            const own = entries.find(entry => entry.isSelf === true) ??
                entries.find(entry => entry.rank === result.season.ownRank) ??
                (result.season.ownRank ? {
                    playerId: 'local-player',
                    nickname: '我的排名',
                    rank: result.season.ownRank,
                    netStars: this.stars,
                    isSelf: true,
                } : undefined);
            this.view.summary(result.season, own);
            if (this.rankLevelAssets) this.view.renderSelf(own, this.rankItemAssets?.avatars ?? [], this.rankLevelAssets);
            this.setEntries(entries, result.season.ownRank);
        } catch (error) {
            if (!this.disposed && generation === this.generation && isValid(this.view.node, true))
                this.view.status(`榜单获取失败，重新打开赛季页可重试：${String(error)}`);
        }
    }

    private async openSeasonRewards(): Promise<void> {
        if (this.disposed || !this.resources) return;
        if (!this.modals) {
            this.view.status('奖励说明暂时无法打开');
            return;
        }
        const modals = this.modals;
        if (this.rewardPopup && isValid(this.rewardPopup, true)) return;
        const request = ++this.rewardRequest;
        if (!this.rewardAssets) this.view.status('正在加载赛季奖励…');
        try {
            const assets = this.rewardAssets ??= await this.loadSeasonRewardAssets();
            if (this.disposed || request !== this.rewardRequest) return;
            const popup = instantiate(assets.popup);
            popup.active = false;
            this.node.addChild(popup);
            const view = popup.getComponent(SeasonRewardPopupView);
            if (!view) throw new Error('SeasonRewardPopup requires SeasonRewardPopupView');
            const close = (): void => modals.close(popup);
            view.initialize(close);
            view.render(assets);
            this.rewardPopup = popup;
            modals.open(popup, {
                bounds: popup.getChildByName('bg') ?? undefined,
                closed: () => {
                    view.dispose();
                    if (isValid(popup, true)) popup.destroy();
                    if (this.rewardPopup === popup) this.rewardPopup = undefined;
                },
            });
            this.view.status('');
            const iconLoad = this.rewardIconLoad ??= this.loadRewardHeroIcons(assets);
            void iconLoad.then(() => {
                if (!this.disposed && isValid(popup, true)) view.render(assets);
            }).catch(error => {
                this.rewardIconLoad = undefined;
                console.warn('[SeasonReward] optional hero portraits failed:', error);
            });
        } catch (error) {
            if (!this.disposed && request === this.rewardRequest)
                this.view.status(`赛季奖励加载失败：${String(error)}`);
        }
    }

    private async loadSeasonRewardAssets(): Promise<LoadedSeasonRewardAssets> {
        if (!this.resources) throw new Error('Season resources are unavailable');
        const resources = this.resources;
        const [popup, item, gold, hero] = await Promise.all([
            resources.load(BUNDLES.seasonContent, 'ui/prefabs/season/SeasonRewardPopup', Prefab, undefined, 'normal'),
            resources.load(BUNDLES.seasonContent, 'ui/prefabs/season/RankingRewardItem', Prefab, undefined, 'normal'),
            resources.load(BUNDLES.seasonContent, 'ui/prefabs/season/RankingRewardGold', Prefab, undefined, 'normal'),
            resources.load(BUNDLES.seasonContent, 'ui/prefabs/season/RankingRewardHero', Prefab, undefined, 'normal'),
        ]);
        return { popup, item, gold, hero, heroIcons: new Map<HeroId, SpriteFrame>() };
    }

    private async loadRewardHeroIcons(assets: LoadedSeasonRewardAssets): Promise<void> {
        if (!this.resources || assets.heroIcons.size) return;
        const resources = this.resources;
        const fragmentIds = new Set<number>();
        for (const reward of GameTables.current.seasonRankingRewards)
            for (const entry of reward.items) fragmentIds.add(entry.id);
        await Promise.all((Object.keys(HERO_TABLE_IDS) as HeroId[]).map(async id => {
            const row = GameTables.current.hero(id);
            const path = HERO_ICON_PATHS[id];
            if (!fragmentIds.has(row.fragment_item_id) || !path) return;
            assets.heroIcons.set(id, await resources.load(BUNDLES.heroes, path, SpriteFrame, undefined, 'background'));
        }));
    }

    setEntries(entries: readonly SeasonRankEntry[], ownRank?: number): void {
        if (this.disposed) return;
        this.list?.setItems(topSeasonRanking(entries), (node, entry: SeasonRankEntry) => {
            const item = node.getComponent(RankItemView);
            if (!item || !this.rankItemAssets) return;
            item.initialize(this.rankItemAssets);
            item.render(entry, entry.isSelf === true || entry.rank === ownRank);
        });
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.generation++; this.rewardRequest++;
        if (this.rewardPopup && isValid(this.rewardPopup, true)) this.modals?.close(this.rewardPopup);
        this.rewardPopup = undefined; this.rewardAssets = undefined; this.rewardIconLoad = undefined;
        this.list?.destroy(); this.list = undefined; this.view?.dispose();
        this.current = undefined; this.resources = undefined; this.rankItemAssets = undefined; this.rankLevelAssets = undefined;
    }
    onDestroy(): void { this.dispose(); }
}
