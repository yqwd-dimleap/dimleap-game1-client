import { _decorator, Button, Component, EventTouch, isValid, Node, UITransform } from 'cc';
import type { MeritReward } from '../../model/config/GameTables';
import { MeritRewardState } from '../../model/season/MeritRewards';

@_decorator.ccclass('MeritRewardView')
export class MeritRewardView extends Component {
    private reward?: MeritReward;
    private claim?: () => void;
    private detail?: (anchor: Node) => void;
    private timer?: ReturnType<typeof setTimeout>;
    private longPress = false;
    private touchX = 0;
    private touchY = 0;
    private touchNodes: Node[] = [];
    private readonly onTouchStart = (event: EventTouch): void => {
        this.longPress = false;
        if (this.timer !== undefined) return;
        const point = event.getUILocation();
        this.touchX = point.x;
        this.touchY = point.y;
        this.timer = setTimeout(() => { this.longPress = true; this.detail?.(this.node); }, 420);
    };
    private readonly onTouchMove = (event: EventTouch): void => {
        const point = event.getUILocation();
        const dx = point.x - this.touchX, dy = point.y - this.touchY;
        if (dx * dx + dy * dy > 144) this.clearTimer();
    };
    private readonly end = (): void => { this.clearTimer(); };
    private readonly click = (): void => { if (!this.longPress) this.claim?.(); };

    initialize(reward: MeritReward, state: MeritRewardState, claim: () => void, detail: (anchor: Node) => void): void {
        this.dispose(); this.reward = reward; this.claim = claim; this.detail = detail;
        // Buttons may consume or stop propagation on their child visuals. Listen on
        // every UITransform node in all three states so long-press works regardless
        // of claim state or which nested sprite received the pointer.
        this.touchNodes = [];
        const collect = (node: Node): void => {
            if (node.getComponent(UITransform)) this.touchNodes.push(node);
            node.children.forEach(collect);
        };
        collect(this.node);
        for (const node of this.touchNodes) {
            node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
            node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
            node.on(Node.EventType.TOUCH_END, this.end, this);
            node.on(Node.EventType.TOUCH_CANCEL, this.end, this);
        }
        const claimButton = this.node.getChildByPath('btn_highlight/btn_can_claim')?.getComponent(Button);
        claimButton?.node.on(Button.EventType.CLICK, this.click, this);
        this.render(state);
    }

    render(state: MeritRewardState): void {
        const highlight = this.node.getChildByName('btn_highlight');
        const claimed = this.node.getChildByName('btn_ already_claim') ?? this.node.getChildByName('btn_already_claim');
        const locked = this.node.getChildByName('btn_ lock_claim') ?? this.node.getChildByName('btn_lock_claim');
        if (highlight) highlight.active = state === 'highlight';
        if (claimed) claimed.active = state === 'already_claim';
        if (locked) locked.active = state === 'lock_claim';
        const button = highlight?.getChildByPath('btn_can_claim')?.getComponent(Button);
        if (button) button.interactable = state === 'highlight';
    }

    get milestone(): MeritReward | undefined { return this.reward; }
    private clearTimer(): void { if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; } }
    dispose(): void {
        this.clearTimer();
        if (!isValid(this.node, true)) return;
        for (const node of this.touchNodes) {
            if (!isValid(node, true)) continue;
            node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
            node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
            node.off(Node.EventType.TOUCH_END, this.end, this);
            node.off(Node.EventType.TOUCH_CANCEL, this.end, this);
        }
        this.touchNodes = [];
        this.node.getChildByPath('btn_highlight/btn_can_claim')?.getComponent(Button)?.node.off(Button.EventType.CLICK, this.click, this);
        this.claim = undefined; this.detail = undefined; this.reward = undefined;
    }
    onDestroy(): void { this.dispose(); }
}
