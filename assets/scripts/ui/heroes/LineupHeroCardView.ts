import { HeroId } from '../../model/config/PrototypeConfig';
import { ViewNodes } from '../binding/ViewNodes';
import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';

@_decorator.ccclass('LineupHeroCardView')
export class LineupHeroCardView extends Component {
    private bindings?: ViewNodes;
    private get ui(): ViewNodes { return this.bindings ?? (this.bindings = new ViewNodes(this.node)); }
    render(_id: HeroId, level: number, icon: SpriteFrame | null): void {
        const portrait = this.ui.at('hero_icon', Sprite); portrait.spriteFrame = icon; portrait.enabled = !!icon;
        const fallback = this.ui.at('hero_icon/Fallback', Label); fallback.string = ''; fallback.node.active = false;
        this.ui.at('lv', Label).string = `Lv.${level}`;
    }
}
