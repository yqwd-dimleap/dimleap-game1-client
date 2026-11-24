import { _decorator, Component, isValid, Sprite, SpriteFrame, sp } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import { BattleMatch, MATCH_TIMING } from '../../../model/battle/BattleMatch';
import { PlayerBadgeView } from './PlayerBadgeView';
@_decorator.ccclass('VSView')
export class VSView extends Component {
    private cancel?: () => void;
    async play(match: BattleMatch, avatars: SpriteFrame[], data: sp.SkeletonData,
        firstArt: SpriteFrame, secondArt: SpriteFrame): Promise<void> {
        const ui = new ViewNodes(this.node);
        ui.at('bg/bg1', Sprite).spriteFrame = firstArt;
        ui.at('bg/bg2', Sprite).spriteFrame = secondArt;
        ui.at('BluePlayer2', PlayerBadgeView).render(match.blue, avatars[match.blue.avatar - 1]);
        ui.at('RedPlayer2', PlayerBadgeView).render(match.red, avatars[match.red.avatar - 1]);
        const spine = ui.at('vs_ani', sp.Skeleton); spine.skeletonData = data;
        const animation = spine.findAnimation('VS');
        if (!animation || animation.duration <= 0) throw new Error('VS 动画缺失或时长无效');
        // Native 0.5s clip, followed by a 1.5s hold on its final pose.
        spine.timeScale = 1;
        await new Promise<void>((resolve, reject) => {
            const finish = (): void => { this.cancel = undefined; resolve(); };
            this.cancel = () => {
                this.unschedule(finish);
                if (isValid(spine, true)) spine.setCompleteListener(() => {});
                this.cancel = undefined; reject(new Error('VS view disposed'));
            };
            spine.setCompleteListener(entry => {
                if (entry.animation?.name !== 'VS') return;
                spine.setCompleteListener(() => {});
                this.scheduleOnce(finish, MATCH_TIMING.vsHold);
            });
            spine.setAnimation(0, 'VS', false);
        });
    }
    onDisable(): void { this.cancel?.(); }
    onDestroy(): void { this.cancel?.(); this.cancel = undefined; }
}
