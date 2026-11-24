import { _decorator, isValid, Label, Sprite, SpriteFrame } from 'cc';
import { UIBase } from '../UIBase';
import type { ResourceLoader } from '../../core/ResourceScope';
import type { PlayerProfile } from '../../model/player/PlayerProfile';
import { avatarPath, PLAYER_UI_BUNDLE } from '../common/PlayerUIAssets';

@_decorator.ccclass('SetUpView')
export class SetUpView extends UIBase {
    private revision = 0;
    initialize(close: () => void, avatar: () => void, nickname: () => void): void {
        this.bindUI();
        this.click('bg/btn_close', close);
        this.click('bg/btn_avatar_frame', avatar);
        this.click('bg/btn_modify', nickname);
    }
    async renderPlayer(profile: Readonly<PlayerProfile>, resources: ResourceLoader): Promise<void> {
        const revision = ++this.revision;
        this.ui.at('bg/nickname', Label).string = profile.nickname;
        const avatar = await resources.load(PLAYER_UI_BUNDLE, avatarPath(profile.avatar), SpriteFrame);
        if (isValid(this, true) && revision === this.revision) this.ui.at('bg/avatar', Sprite).spriteFrame = avatar;
    }
    onDestroy(): void { this.revision++; super.onDestroy(); }
}
