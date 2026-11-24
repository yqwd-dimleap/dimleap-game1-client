import { _decorator, Component, instantiate, isValid, Label, Node, UITransform } from 'cc';
import { GameTables, HERO_TABLE_IDS } from '../../model/config/GameTables';
import type { RankRewardPresentation } from './RankingRewardTypes';
import type { HeroId } from '../../model/battle/types';
import { RankingRewardGoldView } from './RankingRewardGoldView';
import { RankingRewardHeroView } from './RankingRewardHeroView';

@_decorator.ccclass('RankingRewardItemView')
export class RankingRewardItemView extends Component {
    private rewardHost?: Node;

    render(reward: RankRewardPresentation): void {
        const root = this.node.getChildByName('bg');
        if (!root) throw new Error('RankingRewardItem requires bg');
        const icons = [1, 2, 3].map(index => root.getChildByName(`ranking_icon_${index}`));
        const tier = reward.minRank === 1 ? 1 : reward.minRank <= 3 ? 2 : 3;
        icons.forEach((icon, index) => { if (icon) icon.active = index + 1 === tier; });
        const label = root.getChildByName('ranking_num')?.getComponent(Label);
        if (label) {
            label.string = reward.maxRank === -1 ? `${reward.minRank}+`
                : reward.minRank === reward.maxRank ? String(reward.minRank)
                    : `${reward.minRank}-${reward.maxRank}`;
            const transform = label.getComponent(UITransform);
            if (transform) transform.setContentSize(88, 52);
        }

        const host = this.rewardHost ??= this.createHost(root);
        for (const child of [...host.children]) { child.removeFromParent(); child.destroy(); }
        const positions = [-40, 80, 200];
        reward.items.forEach((item, index) => {
            const row = GameTables.current.items[item.id];
            if (!row) return;
            const gold = row.item_type === 'currency';
            const card = instantiate(gold ? reward.assets.gold : reward.assets.hero);
            host.addChild(card);
            card.setPosition(positions[index] ?? 200, 0, 0);
            if (gold) {
                card.getComponent(RankingRewardGoldView)?.render(item.amount);
                return;
            }
            const heroId = (Object.keys(HERO_TABLE_IDS) as HeroId[])
                .find(id => GameTables.current.hero(id).fragment_item_id === item.id);
            card.getComponent(RankingRewardHeroView)?.render(item.amount, heroId ? reward.assets.heroIcons.get(heroId) ?? null : null);
        });
    }

    private createHost(root: Node): Node {
        const host = new Node('RewardItems');
        host.layer = root.layer;
        host.addComponent(UITransform);
        root.addChild(host);
        host.setSiblingIndex(root.children.length - 1);
        return host;
    }

    onDestroy(): void {
        if (this.rewardHost && isValid(this.rewardHost, true)) this.rewardHost.destroy();
        this.rewardHost = undefined;
    }
}
