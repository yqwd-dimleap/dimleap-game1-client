import { _decorator, BlockInputEvents, Button, Component, isValid, Node } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';

const { ccclass } = _decorator;

/** Confirmation overlay. It blocks modal input but leaves battle simulation running. */
@ccclass('BattlePauseView')
export class BattlePauseView extends Component {
    private ui?: ViewNodes;
    private readonly bindings: Array<{ node: Node; action: () => void }> = [];
    private confirm?: () => void;
    private get nodes(): ViewNodes { return this.ui ?? (this.ui = new ViewNodes(this.node)); }

    initialize(confirm: () => void): void {
        this.dispose();
        this.ui = new ViewNodes(this.node);
        this.confirm = confirm;
        if (!this.getComponent(BlockInputEvents)) this.addComponent(BlockInputEvents);
        this.bind('bg_4/btn_cancel', () => this.hide());
        this.bind('bg_4/btn_close', () => this.hide());
        this.bind('bg_4/btn_sure', () => this.confirm?.());
        this.hide();
    }

    show(): void { this.node.active = true; }
    hide(): void { this.node.active = false; }

    dispose(): void {
        for (const { node, action } of this.bindings.splice(0)) {
            if (isValid(node, true)) node.off(Button.EventType.CLICK, action);
        }
        this.confirm = undefined;
        this.ui = undefined;
    }

    onDestroy(): void { this.dispose(); }

    private bind(path: string, action: () => void): void {
        const button = this.nodes.at(path, Button);
        button.node.on(Button.EventType.CLICK, action);
        this.bindings.push({ node: button.node, action });
    }
}
