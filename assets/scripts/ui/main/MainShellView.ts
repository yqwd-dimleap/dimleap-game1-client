import { TopNavView } from './TopNavView';
import { _decorator, Component, isValid, Label, Node } from 'cc';
import { BottomNavView } from './BottomNavView';

export type MainPage = 'home' | 'heroes' | 'season';

/** Authored shell references only its own nodes, never feature prefabs. */
@_decorator.ccclass('MainShellView')
export class MainShellView extends Component {
    host!: Node;
    private nav?: BottomNavView;
    private top?: TopNavView;
    initialize(select: (page: MainPage) => void): void {
        this.host = this.node.getChildByName('PageHost')!;
        const nav = this.node.getChildByName('BottomNav');
        if (!this.host || !nav) throw new Error('MainShell requires PageHost and BottomNav');
        this.nav = nav.getComponent(BottomNavView) ?? undefined;
        if (!this.nav) throw new Error('BottomNav requires BottomNavView');
        this.nav.initialize(select);
        this.top = this.node.getChildByName('TopNav')?.getComponent(TopNavView) ?? undefined;
        if (!this.top) throw new Error('MainShell requires TopNav/TopNavView');
    }
    currency(coins: number): void { this.top?.render(coins); }
    status(message: string): void {
        if (!isValid(this.node, true)) return;
        const label = this.node.getChildByName('Status')?.getComponent(Label);
        if (label) { label.string = message; label.node.active = !!message; }
    }
    selected(page: MainPage): void {
        this.nav?.selected(page);
    }
    navigationBusy(busy: boolean): void { this.nav?.navigationBusy(busy); }
    dispose(): void { if (this.nav && isValid(this.nav, true)) this.nav.dispose(); this.nav = undefined; this.top = undefined; }
    onDestroy(): void { this.dispose(); }
}
