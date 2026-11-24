import { _decorator, Component, Label } from 'cc';

@_decorator.ccclass('RankingRewardGoldView')
export class RankingRewardGoldView extends Component {
    render(amount: number): void {
        const label = this.node.getChildByPath('bg/suipian_amount')?.getComponent(Label);
        if (label) label.string = `x${amount}`;
    }
}
