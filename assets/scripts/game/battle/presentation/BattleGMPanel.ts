import { _decorator, Button, Component, Label, Slider, isValid } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import { applyTuning, BattleTuningStore, currentTuning, DEFAULT_TUNING, groupTuning, tuningFields, TuningKey } from '../../../model/battle/BattleTuning';
@_decorator.ccclass('BattleGMPanel')
export class BattleGMPanel extends Component {
    private ui!: ViewNodes;
    private listeners: (() => void)[] = [];
    private visibility: (open: boolean) => void = () => {};
    get visible(): boolean { return !!this.ui?.path('Overlay').active; }
    initialize(store: BattleTuningStore, visibility: (open: boolean) => void, changed: () => void): void {
        this.ui = new ViewNodes(this.node); this.visibility = visibility;
        const bind = (path: string, action: () => void): void => {
            const node = this.ui.path(path); node.on(Button.EventType.CLICK, action);
            this.listeners.push(() => { if (isValid(node, true)) node.off(Button.EventType.CLICK, action); });
        };
        const status = (text: string): void => { this.ui.at('Overlay/Panel/Status', Label).string = text; };
        const change = (key: TuningKey, value: number): void => {
            const field = tuningFields('collision').find(f => f.key === key)!;
            try { applyTuning({ [key]: Number(Math.max(field.min, Math.min(field.max, value)).toFixed(2)) }); changed(); status('实时生效，点击保存可供下次使用'); }
            catch (error) { status(String(error)); }
            this.refresh();
        };
        bind('OpenGM', () => this.setVisible(true)); bind('Overlay/Panel/Close', () => this.setVisible(false));
        bind('Overlay/Panel/Save', () => status(store.save('collision') ? '弹射系数已保存' : '保存失败，当前调整仍然有效'));
        bind('Overlay/Panel/Defaults', () => { applyTuning(groupTuning('collision', DEFAULT_TUNING)); changed(); this.refresh(); status(store.save('collision') ? '已恢复默认并保存' : '已恢复默认，保存失败'); });
        for (const field of tuningFields('collision')) {
            const path = `Overlay/Panel/Scroll/view/content/${field.key}`;
            bind(path + '/Minus', () => change(field.key, currentTuning()[field.key] - field.step));
            bind(path + '/Plus', () => change(field.key, currentTuning()[field.key] + field.step));
            const slider = this.ui.at(path + '/Slider', Slider);
            const slide = (): void => change(field.key, Math.round((field.min + slider.progress * (field.max - field.min)) / field.step) * field.step);
            const sliderNode = slider.node;
            sliderNode.on('slide', slide); this.listeners.push(() => { if (isValid(sliderNode, true)) sliderNode.off('slide', slide); });
        }
        this.ui.path('Overlay').active = false; this.refresh();
    }
    setVisible(open: boolean): void {
        if (open === this.visible) return;
        this.ui.path('OpenGM').active = !open; this.ui.path('Overlay').active = open; this.visibility(open);
        if (open) { this.node.setSiblingIndex(this.node.parent!.children.length - 1); this.refresh(); }
    }
    private refresh(): void {
        const values = currentTuning();
        for (const field of tuningFields('collision')) {
            const path = `Overlay/Panel/Scroll/view/content/${field.key}`;
            this.ui.at(path + '/Value', Label).string = values[field.key].toFixed(2);
            this.ui.at(path + '/Slider', Slider).progress = (values[field.key] - field.min) / (field.max - field.min);
        }
    }
    dispose(): void { this.listeners.splice(0).forEach(off => off()); }
    onDestroy(): void { this.dispose(); }
}
