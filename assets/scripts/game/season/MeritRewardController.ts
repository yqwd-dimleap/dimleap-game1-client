import { instantiate, isValid, Node, Prefab, UITransform } from 'cc';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';
import type { MeritReward } from '../../model/config/GameTables';
import type { ModalPresenter } from '../../ui/common/ModalHost';
import { GetRewardView } from '../../ui/season/GetRewardView';
import { RewardDetailView } from '../../ui/season/RewardDetailView';
import { GameApp } from '../GameApp';

interface RewardAssets {
    detail: Prefab;
    reward?: Prefab;
    gold: Prefab;
    hero: Prefab;
}

interface RewardEntry {
    scope: ResourceScope;
    node?: Node;
    closed: boolean;
}

type RewardKind = 'detail' | 'reward';

/** Owns the remote reward modal lifetime and the temporary local claim response. */
export class MeritRewardController {
    private readonly entries = new Map<RewardKind, RewardEntry>();
    private readonly claiming = new Set<number>();
    private disposed = false;

    constructor(private app: GameApp, private modals: ModalPresenter,
        private report: (message: string) => void, private changed: () => void) {}

    detail(reward: MeritReward, anchor?: Node): void {
        void this.open('detail', reward, anchor);
    }

    claim(reward: MeritReward): void {
        void this.claimAndOpen(reward);
    }

    private async claimAndOpen(reward: MeritReward): Promise<void> {
        if (this.disposed || this.claiming.has(reward.id)) return;
        this.claiming.add(reward.id);
        try {
            // This is the current local prototype response. Replace this call with the
            // server claim request; the UI flow already waits for its accepted result.
            const result = await this.app.seasons.claimMilestone(reward.id);
            if (this.disposed) return;
            if (!result.ok) {
                this.report(result.message);
                return;
            }
            this.changed();
            await this.open('reward', reward);
        } catch (error) {
            if (!this.disposed) this.report(`奖励领取失败，可稍后重试：${String(error)}`);
        } finally {
            this.claiming.delete(reward.id);
        }
    }

    private async open(kind: RewardKind, reward: MeritReward, anchor?: Node): Promise<void> {
        if (this.disposed) return;
        const previous = this.entries.get(kind);
        if (previous?.node) this.modals.close(previous.node);

        const entry: RewardEntry = { scope: this.app.res.createScope(`merit-reward:${kind}`), closed: false };
        this.entries.set(kind, entry);
        try {
            const assets = await this.loadAssets(entry.scope, kind);
            if (this.disposed || entry.closed || this.entries.get(kind) !== entry) {
                this.release(kind, entry);
                return;
            }
            const prefab = kind === 'detail' ? assets.detail : assets.reward;
            if (!prefab) throw new Error('GetReward prefab is unavailable');
            const node = entry.node = instantiate(prefab);
            const bounds = node.getChildByName(kind === 'detail' ? 'bg_2' : 'Background');
            if (!bounds) throw new Error(`${kind} reward prefab has no bounds node`);
            const validAnchor = anchor && isValid(anchor, true) ? anchor : undefined;
            const markerHeight = validAnchor?.getComponent(UITransform)?.height ?? 0;
            const boundsHeight = bounds.getComponent(UITransform)?.height ?? 0;
            this.modals.open(node, {
                bounds,
                anchor: kind === 'detail' ? validAnchor : undefined,
                anchorOffset: kind === 'detail'
                    ? { x: 0, y: (markerHeight + boundsHeight) * .5 + 24, z: 0 }
                    : undefined,
                closed: () => this.release(kind, entry),
            });

            if (kind === 'detail') {
                const view = node.getComponent(RewardDetailView);
                if (!view) throw new Error('RewardDetail prefab requires RewardDetailView');
                await view.initialize(reward, entry.scope, assets.gold, assets.hero, 'detail');
            } else {
                const view = node.getComponent(GetRewardView);
                if (!view) throw new Error('GetReward prefab requires GetRewardView');
                await view.initialize(reward, entry.scope, assets.detail, assets.gold, assets.hero,
                    () => { if (isValid(node, true)) this.modals.close(node); });
            }
        } catch (error) {
            if (entry.node && isValid(entry.node, true)) this.modals.close(entry.node);
            this.release(kind, entry);
            if (!this.disposed) this.report(`奖励界面加载失败，可再次操作重试：${String(error)}`);
        }
    }

    private async loadAssets(scope: ResourceScope, kind: RewardKind): Promise<RewardAssets> {
        const [detail, reward, gold, hero] = await Promise.all([
            scope.load(BUNDLES.seasonContent, 'ui/prefabs/reward/RewardDetail', Prefab),
            kind === 'reward'
                ? scope.load(BUNDLES.seasonContent, 'ui/prefabs/reward/GetReward', Prefab)
                : Promise.resolve(undefined),
            scope.load(BUNDLES.seasonContent, 'ui/prefabs/reward/GoldRewardCard', Prefab),
            scope.load(BUNDLES.seasonContent, 'ui/prefabs/reward/HeroRewardCard', Prefab),
        ]);
        return { detail, reward, gold, hero };
    }

    private release(kind: RewardKind, entry: RewardEntry): void {
        if (entry.closed) return;
        entry.closed = true;
        if (this.entries.get(kind) === entry) this.entries.delete(kind);
        if (entry.node && isValid(entry.node, true)) {
            entry.node.removeFromParent();
            entry.node.destroy();
        }
        entry.scope.dispose();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const [kind, entry] of [...this.entries]) {
            if (entry.node) this.modals.close(entry.node);
            else this.release(kind, entry);
        }
    }
}
