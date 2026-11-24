import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ViewNodes } from '../binding/ViewNodes';

@_decorator.ccclass('HeroRewardCardView')
export class HeroRewardCardView extends Component {
    private bindings?: ViewNodes;
    render(name: string, amount: number, icon: SpriteFrame | null): void {
        const ui = this.bindings ??= new ViewNodes(this.node);
        const portrait = ui.at('hero/hero_icon', Sprite); portrait.spriteFrame = icon; portrait.enabled = !!icon;
        const fallback = ui.at('hero/hero_icon/Fallback', Label);
        fallback.string = name;
        fallback.node.active = !icon;
        ui.at('hero/name_bg/name', Label).string = Array.from(name).join('\n');
        ui.at('hero/amount', Label).string = `x${amount}`;
    }
}
