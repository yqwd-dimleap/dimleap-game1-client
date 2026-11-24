import { _decorator, Component, Node } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';

const { ccclass } = _decorator;

/** Displays the authored 回合一/二/三 banner at the start of each round. */
@ccclass('RoundTurnItemView')
export class RoundTurnItemView extends Component {
    private ui?: ViewNodes;
    private get nodes(): ViewNodes { return this.ui ?? (this.ui = new ViewNodes(this.node)); }

    show(round: number): void {
        const value = Math.max(1, Math.min(3, Math.floor(round)));
        this.node.active = true;
        const prefix = this.node.name === 'round_turn_bg' ? '' : 'round_turn_bg/';
        for (const index of [1, 2, 3]) {
            const node = this.nodes.path(`${prefix}round_turn_${index}`);
            if (!node) throw new Error(`RoundTurnItem requires round_turn_${index}`);
            node.active = index === value;
        }
    }

    hide(): void { this.node.active = false; }

    onDestroy(): void { this.ui = undefined; }
}
