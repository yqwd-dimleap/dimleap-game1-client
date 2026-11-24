import { _decorator, EditBox, Label } from 'cc';
import { UIBase } from '../UIBase';
import { parsePlayerNickname } from '../../model/player/PlayerNickname';

@_decorator.ccclass('NickNameModifyView')
export class NickNameModifyView extends UIBase {
    initialize(nickname: string, close: () => void, confirm: (nickname: string) => Promise<boolean>): void {
        this.bindUI();
        const input = this.ui.at('bg/EditBox', EditBox), hint = this.ui.at('bg/Label', Label);
        const instruction = hint.string;
        input.maxLength = 12; input.string = nickname;
        const reset = (): void => { hint.string = instruction; };
        const inputNode = input.node;
        inputNode.on(EditBox.EventType.TEXT_CHANGED, reset);
        this.own(() => { if (inputNode.isValid) inputNode.off(EditBox.EventType.TEXT_CHANGED, reset); });
        this.click('bg/btn_close', close);
        let busy = false;
        this.click('bg/btn_ok', () => {
            if (busy) return;
            const result = parsePlayerNickname(input.string);
            if (result.error) { hint.string = result.error; return; }
            busy = true;
            hint.string = '保存中…';
            void confirm(result.nickname).then(ok => {
                busy = false;
                if (!ok) hint.string = '保存失败，请重试';
            }).catch(() => {
                busy = false;
                hint.string = '保存失败，请重试';
            });
        });
    }
}
