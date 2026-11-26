import { _decorator, Component, instantiate, Prefab, ProgressBar, Sprite, Label, SpriteFrame } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import { HEROES, HeroId, RULES } from '../../../model/config/PrototypeConfig';
import { BattleCardFrames, BattleCardView } from './BattleCardView';
@_decorator.ccclass('BattleHandPanel')
export class BattleHandPanel extends Component {
    private ui!: ViewNodes;
    private cards: BattleCardView[] = [];
    private hand: HeroId[] = [];
    private icons!: Partial<Record<HeroId, SpriteFrame>>;
    private frames: BattleCardFrames = {};
    initialize(choose: (hero: HeroId) => void, prefab: Prefab, icons: Partial<Record<HeroId, SpriteFrame>>,
        frames: BattleCardFrames): void {
        this.ui = new ViewNodes(this.node); this.icons = icons; this.frames = frames;
        for (let i = 0; i < 3; i++) {
            const node = instantiate(prefab);
            const setLayer = (child: import('cc').Node): void => { child.layer = this.node.layer; child.children.forEach(setLayer); }; setLayer(node);
            this.ui.path('cards_info/Cards').addChild(node);
            node.setPosition((i - 1) * 230, 0); node.name = `Card${i + 1}`;
            const view = node.getComponent(BattleCardView);
            if (!view) throw new Error('BattleCard requires BattleCardView');
            view.initialize(() => { const id = this.hand[i]; if (id) choose(id); }); this.cards.push(view);
        }
    }
    refresh(hand: readonly HeroId[], levels: Partial<Record<HeroId, number>>, points: number, selecting: boolean, show: boolean): void {
        this.hand = [...hand]; this.node.active = show;
        this.ui.path('cards_info/Cards').active = selecting;
        this.ui.at('cards_info', Sprite).enabled = selecting;
        this.ui.at('cards_info/LeftActionPoint', Label).string = `${points}/${RULES.actionPoints}`;
        this.ui.at('cards_info/ActionPoint', ProgressBar).progress = points / RULES.actionPoints;
        this.cards.forEach((view, i) => {
            const id = this.hand[i]; view.node.active = !!id;
            if (id) view.render(id, levels[id] ?? 1, this.icons[id] ?? null,
                selecting && HEROES[id].cost <= points, this.frames);
        });
    }
    dispose(): void { this.cards.forEach(card => card.dispose()); }
    onDestroy(): void { this.dispose(); }
}
