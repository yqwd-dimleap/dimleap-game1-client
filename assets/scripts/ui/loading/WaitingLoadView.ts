import { _decorator, Component, isValid, Node } from 'cc';

const { ccclass } = _decorator;

/** Full-screen page-switch cover. The spinner keeps the renderer active while a remote bundle resolves. */
@ccclass('WaitingLoadView')
export class WaitingLoadView extends Component {
    private icon?: Node;

    show(): void {
        this.resolveIcon();
        this.node.active = true;
    }

    hide(): void {
        this.node.active = false;
    }

    update(dt: number): void {
        this.resolveIcon();
        if (this.icon) this.icon.angle = (this.icon.angle + dt * 360) % 360;
    }

    private resolveIcon(): void {
        if (isValid(this.icon, true)) return;
        this.icon = this.node.getChildByName('loading_icon') ?? undefined;
    }
}
