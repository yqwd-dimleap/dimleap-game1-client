import { _decorator, Component, Button, Label, Sprite, SpriteFrame, isValid } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import { HeroId } from '../../../model/battle/types';
import { heroCardTier, heroStats } from '../../../model/hero/HeroProgress';
export type BattleCardFrames = Partial<Record<1 | 2 | 3, SpriteFrame>>;
@_decorator.ccclass('BattleCardView')
export class BattleCardView extends Component {
    private ui?: ViewNodes;
    private choose?: () => void;
    initialize(choose: () => void): void { this.dispose(); this.choose = choose; this.node.on(Button.EventType.CLICK, choose); }
    render(id: HeroId, level: number, icon: SpriteFrame | null, enabled: boolean, frames: BattleCardFrames): void {
        const ui = this.ui ?? (this.ui = new ViewNodes(this.node)), hero = heroStats(id, level);
        const frame = frames[heroCardTier(id)];
        if (frame) ui.at('hero_frame', Sprite).spriteFrame = frame;
        const sprite = ui.at('hero/hero_icon', Sprite); sprite.spriteFrame = icon; sprite.enabled = !!icon;
        const glyph = ui.at('hero/hero_icon/Fallback', Label); glyph.string = hero.name; glyph.node.active = !icon;
        ui.at('hero/amoutn_icon/amount', Label).string = "+" + String(hero.count);
        ui.at('hero/action_point_icon/action_point', Label).string = String(hero.cost);
        this.getComponent(Button)!.interactable = enabled;
    }
    dispose(): void { if (this.choose && isValid(this.node, true)) this.node.off(Button.EventType.CLICK, this.choose); this.choose = undefined; }
    onDestroy(): void { this.dispose(); }
}
