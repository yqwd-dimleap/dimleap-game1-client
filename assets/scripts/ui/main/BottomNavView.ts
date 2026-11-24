import { _decorator, Button, Component, isValid } from 'cc';
import type { MainPage } from './MainShellView';

/** Owns navigation button listeners; references stay relative to this prefab. */
@_decorator.ccclass('BottomNavView')
export class BottomNavView extends Component {
    private listeners: (() => void)[] = [];
    private page?: MainPage;
    private busy = false;
    initialize(select: (page: MainPage) => void): void {
        this.dispose();
        for (const page of ['heroes', 'home', 'season'] as const) {
            const node = this.node.getChildByName(page);
            if (!node?.getComponent(Button)) throw new Error(`Missing navigation button: ${page}`);
            const click = (): void => { if (!this.busy) select(page); };
            node.on(Button.EventType.CLICK, click);
            this.listeners.push(() => { if (isValid(node, true)) node.off(Button.EventType.CLICK, click); });
        }
    }
    selected(page: MainPage): void { this.page = page; this.refresh(); }
    // Disabled sprites are the authored selected-page appearance. Busy only gates routing.
    navigationBusy(busy: boolean): void { this.busy = busy; }
    private refresh(): void {
        if (!isValid(this.node, true)) return;
        for (const name of ['heroes', 'home', 'season']) {
            const button = this.node.getChildByName(name)?.getComponent(Button);
            if (button) button.interactable = name !== this.page;
        }
    }
    dispose(): void { this.listeners?.splice(0).forEach(off => off()); }
    onDestroy(): void { this.dispose(); }
}
