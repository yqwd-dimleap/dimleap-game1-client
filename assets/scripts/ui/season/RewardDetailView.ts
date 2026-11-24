import { _decorator, Component, instantiate, isValid, Label, Node, Prefab, Sprite, SpriteFrame } from 'cc';
import type { MeritReward } from '../../model/config/GameTables';
import type { HeroId } from '../../model/battle/types';
import { GameTables, HERO_TABLE_IDS } from '../../model/config/GameTables';
import { HERO_ICON_PATHS } from '../../model/hero/HeroPortraits';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';
import { visibleRewardItems } from '../../model/season/MeritRewards';
import { GoldRewardCardView } from './GoldRewardCardView';
import { HeroRewardCardView } from './HeroRewardCardView';

export type RewardPresentation = 'detail' | 'reward';

interface GridOptions {
    scale: number;
    columns: number;
    columnGap: number;
    rowGap: number;
    centerY: number;
}

function heroIdForFragment(itemId: number): HeroId | undefined {
    return (Object.keys(HERO_TABLE_IDS) as HeroId[])
        .find(id => GameTables.current.hero(id).fragment_item_id === itemId);
}

function destroyChildren(host: Node): void {
    for (const child of [...host.children]) child.destroy();
}

function layoutCards(cards: readonly Node[], options: GridOptions): void {
    const rows = Math.ceil(cards.length / options.columns);
    for (let index = 0; index < cards.length; index++) {
        const row = Math.floor(index / options.columns);
        const column = index % options.columns;
        const columnsInRow = Math.min(options.columns, cards.length - row * options.columns);
        cards[index].setScale(options.scale, options.scale, 1);
        cards[index].setPosition(
            (column - (columnsInRow - 1) / 2) * options.columnGap,
            options.centerY + ((rows - 1) / 2 - row) * options.rowGap,
            0,
        );
    }
}

@_decorator.ccclass('RewardDetailView')
export class RewardDetailView extends Component {
    private host?: Node;
    private resources?: ResourceScope;
    private disposed = false;

    async initialize(reward: MeritReward, resources: ResourceScope, goldPrefab: Prefab, heroPrefab: Prefab,
        presentation: RewardPresentation = 'detail'): Promise<void> {
        this.resources = resources;
        this.uiTitle().string = `军功 ${reward.requiredMerit} 奖励`;
        this.host = this.node.getChildByName('RewardHost') ?? new Node('RewardHost');
        const background = this.node.getChildByName('bg_2');
        if (!background) throw new Error('RewardDetail requires bg_2');
        this.host.layer = background.layer;
        if (!this.host.parent) background.addChild(this.host);
        destroyChildren(this.host);

        const items = visibleRewardItems(reward);
        const cards: Node[] = [];
        const iconLoads: Promise<void>[] = [];
        for (const item of items) {
            const row = GameTables.current.items[item.id];
            if (!row) continue;
            const gold = row.item_type === 'currency' || item.id === 1;
            const card = instantiate(gold ? goldPrefab : heroPrefab);
            this.host.addChild(card);
            cards.push(card);

            if (gold) {
                card.getComponent(GoldRewardCardView)?.render(item.amount);
                continue;
            }

            const heroId = heroIdForFragment(item.id);
            const name = row.name.replace(/碎片$/, '');
            const heroCard = card.getComponent(HeroRewardCardView);
            heroCard?.render(name, item.amount, null);
            const path = heroId ? HERO_ICON_PATHS[heroId] : undefined;
            if (!path) continue;
            iconLoads.push(resources.load(BUNDLES.heroes, path, SpriteFrame)
                .then(icon => {
                    if (!this.disposed && isValid(card, true)) heroCard?.render(name, item.amount, icon);
                })
                .catch(() => { /* The authored name fallback remains usable. */ }));
        }

        const rewardPresentation = presentation === 'reward';
        const backgroundSprite = background.getComponent(Sprite);
        if (backgroundSprite) backgroundSprite.enabled = !rewardPresentation;
        const title = background.getChildByName('title');
        if (title) title.active = !rewardPresentation;
        layoutCards(cards, rewardPresentation
            ? { scale: 1, columns: 3, columnGap: 185, rowGap: 245, centerY: -35 }
            : { scale: .4, columns: 3, columnGap: 82, rowGap: 92, centerY: -28 });
        this.host.setPosition(0, 0, 0);
        // Cards and amounts are visible before portrait textures finish loading.
        void Promise.all(iconLoads);
    }

    private uiTitle(): Label {
        const title = this.node.getChildByPath('bg_2/title')?.getComponent(Label);
        if (!title) throw new Error('RewardDetail requires bg_2/title');
        return title;
    }

    onDestroy(): void {
        this.disposed = true;
        if (this.host && isValid(this.host, true)) destroyChildren(this.host);
        this.host = undefined;
        this.resources = undefined;
    }
}
