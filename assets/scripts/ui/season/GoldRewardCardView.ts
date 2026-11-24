import { _decorator, Component, Label } from 'cc';
import { ViewNodes } from '../binding/ViewNodes';

@_decorator.ccclass('GoldRewardCardView')
export class GoldRewardCardView extends Component {
    private bindings?: ViewNodes;
    render(amount: number): void { (this.bindings ??= new ViewNodes(this.node)).at('gold_frame/amount', Label).string = `x${amount}`; }
}
