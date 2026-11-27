import { _decorator, Component, isValid, Label, Node } from 'cc';
import { BottomNavView } from './BottomNavView';
import { WaitingLoadView } from '../loading/WaitingLoadView';

export type MainPage = 'home' | 'heroes' | 'season';

/** Authored shell references only its own nodes, never feature prefabs. */
@_decorator.ccclass('MainShellView')
export class MainShellView extends Component {
    host!: Node;
    private nav?: BottomNavView;
    private waitingView?: WaitingLoadView;
    initialize(select: (page: MainPage) => void): void {
        this.host = this.node.getChildByName('PageHost')!;
        const nav = this.node.getChildByName('BottomNav');
        const waiting = this.node.getChildByName('WaitingLoad')?.getComponent(WaitingLoadView);
        if (!this.host || !nav) throw new Error('MainShell requires PageHost and BottomNav');
        if (!waiting) throw new Error('MainShell requires WaitingLoad/WaitingLoadView');
        this.nav = nav.getComponent(BottomNavView) ?? undefined;
        if (!this.nav) throw new Error('BottomNav requires BottomNavView');
        this.waitingView = waiting;
        this.waitingView.hide();
        this.nav.initialize(select);
    }
    status(message: string): void {
        if (!isValid(this.node, true)) return;
        const label = this.node.getChildByName('Status')?.getComponent(Label);
        if (label) { label.string = message; label.node.active = !!message; }
    }
    selected(page: MainPage): void {
        this.nav?.selected(page);
    }
    setWaiting(visible: boolean): void {
        if (!isValid(this.node, true)) return;
        if (visible) this.waitingView?.node.setSiblingIndex(this.node.children.length - 1);
        if (visible) this.waitingView?.show();
        else this.waitingView?.hide();
    }
    navigationBusy(busy: boolean): void { this.nav?.navigationBusy(busy); }
    dispose(): void {
        if (this.nav && isValid(this.nav, true)) this.nav.dispose();
        this.nav = undefined;
        this.waitingView = undefined;
    }
    onDestroy(): void { this.dispose(); }
}
