import { _decorator, Button, Component, isValid } from 'cc';
import { ViewNodes } from '../binding/ViewNodes';

/** Authored card actions; the collection owns roster state and modal navigation. */
@_decorator.ccclass('HeroSelectView')
export class HeroSelectView extends Component {
    private bindings?: ViewNodes;
    private get ui(): ViewNodes { return this.bindings ?? (this.bindings = new ViewNodes(this.node)); }
    private listeners: (() => void)[] = [];
    initialize(info: () => void, select: () => void, remove: () => void): void {
        this.dispose();
        for (const [path, click] of [['btn_roleInfo', info], ['btn_up', select], ['btn_down', remove]] as const) {
            const node = this.ui.at(path, Button).node;
            node.on(Button.EventType.CLICK, click);
            this.listeners.push(() => { if (isValid(node, true)) node.off(Button.EventType.CLICK, click); });
        }
    }
    render(onField: boolean, space: boolean): void {
        this.ui.path('btn_up').active = !onField;
        this.ui.at('btn_up', Button).interactable = space;
        this.ui.path('btn_down').active = onField;
    }
    dispose(): void { this.listeners?.splice(0).forEach(off => off()); }
    onDestroy(): void { this.dispose(); }
}
