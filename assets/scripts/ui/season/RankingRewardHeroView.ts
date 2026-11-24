import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';

@_decorator.ccclass('RankingRewardHeroView')
export class RankingRewardHeroView extends Component {
    render(amount: number, icon: SpriteFrame | null): void {
        const portrait = this.node.getChildByPath('bg/hero_icon')?.getComponent(Sprite);
        if (portrait) {
            portrait.spriteFrame = icon;
            portrait.enabled = !!icon;
        }
        const label = this.node.getChildByPath('bg/suipian_amount')?.getComponent(Label);
        if (label) label.string = `x${amount}`;
    }
}
