import { _decorator, Component, Label } from 'cc';
import { ViewNodes } from '../binding/ViewNodes';

/** The shared top bar owns currency; player identity belongs to PlayerInfo. */
@_decorator.ccclass('TopNavView')
export class TopNavView extends Component {
    private bindings?: ViewNodes;
    render(coins: number): void {
        const ui = this.bindings ?? (this.bindings = new ViewNodes(this.node));
        ui.at('goldframe/coin', Label).string = String(coins);
    }
}
