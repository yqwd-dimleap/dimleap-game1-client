import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import type { MatchIdentity } from '../../../model/battle/BattleMatch';
@_decorator.ccclass('PlayerBadgeView')
export class PlayerBadgeView extends Component {
    private ui?: ViewNodes;
    render(player: MatchIdentity, avatar: SpriteFrame): void {
        const ui = this.ui ?? (this.ui = new ViewNodes(this.node));
        ui.at('name', Label).string = player.nickname;
        ui.at('avatar_sprite', Sprite).spriteFrame = avatar;
    }
}
