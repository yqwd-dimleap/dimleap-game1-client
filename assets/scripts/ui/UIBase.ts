import { Button, Component, Node } from 'cc';
import { ViewNodes } from './binding/ViewNodes';
/** A view owns its cached references and listeners. Inspector reference dragging is unnecessary. */
export class UIBase extends Component {
    protected ui!: ViewNodes;
    private subscriptions: (() => void)[] = [];
    protected bindUI(): void { this.ui = new ViewNodes(this.node); }
    protected click(key: string, action: () => void): void {
        const node = this.ui.path(key);
        if (!node.getComponent(Button)) throw new Error(`Button missing: ${key}`);
        node.on(Button.EventType.CLICK, action, this);
        this.subscriptions.push(() => { if (node.isValid) node.off(Button.EventType.CLICK, action, this); });
    }
    protected own(dispose: () => void): void { this.subscriptions.push(dispose); }
    onDestroy(): void { for (const dispose of this.subscriptions.splice(0)) dispose(); }
}
