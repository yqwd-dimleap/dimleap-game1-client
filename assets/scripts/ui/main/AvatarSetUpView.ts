import { _decorator, Label, Vec3 } from 'cc';
import { UIBase } from '../UIBase';

/** Selection remains a draft until confirmation; markers follow the authored grid. */
@_decorator.ccclass('AvatarSetUpView')
export class AvatarSetUpView extends UIBase {
    private selected = 1;
    private highlightOffset = new Vec3();
    private selectOffset = new Vec3();
    initialize(avatar: number, close: () => void, confirm: (avatar: number) => Promise<boolean>): void {
        this.bindUI();
        const first = this.ui.path('bg/avatar_node/btn_avatar_1').position;
        Vec3.subtract(this.highlightOffset, this.ui.path('bg/icon_highlight').position, first);
        Vec3.subtract(this.selectOffset, this.ui.path('bg/icon_select').position, first);
        for (let id = 1; id <= 8; id++) this.click(`bg/avatar_node/btn_avatar_${id}`, () => this.select(id));
        this.click('bg/btn_close', close);
        let busy = false;
        this.click('bg/btn_ok', () => {
            if (busy) return;
            busy = true;
            this.ui.at('bg/btn_ok/Label', Label).string = '保存中…';
            void confirm(this.selected).then(ok => {
                busy = false;
                if (!ok) this.saveFailed();
            }).catch(() => {
                busy = false;
                this.saveFailed();
            });
        });
        this.select(avatar);
    }
    private select(avatar: number): void {
        this.selected = avatar;
        const position = this.ui.path(`bg/avatar_node/btn_avatar_${avatar}`).position;
        this.ui.path('bg/icon_highlight').setPosition(Vec3.add(new Vec3(), position, this.highlightOffset));
        this.ui.path('bg/icon_select').setPosition(Vec3.add(new Vec3(), position, this.selectOffset));
        this.ui.at('bg/btn_ok/Label', Label).string = '确定更换';
    }
    saveFailed(): void { this.ui.at('bg/btn_ok/Label', Label).string = '保存失败，请重试'; }
}
