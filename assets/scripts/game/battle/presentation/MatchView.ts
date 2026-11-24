import { _decorator, Component, Button, Label, Node, isValid, sp, SpriteFrame, Vec3 } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import { BattleMatch, createMatchOpponent, MATCH_TIMING } from '../../../model/battle/BattleMatch';
import { PlayerBadgeView } from './PlayerBadgeView';
@_decorator.ccclass('MatchView')
export class MatchView extends Component {
    private back?: () => void;
    private backNode?: Node;
    private ui?: ViewNodes;
    private search?: { match: BattleMatch; avatars: SpriteFrame[]; badge: PlayerBadgeView; position: Vec3; scale: Vec3; elapsed: number; candidate: number };
    private get nodes(): ViewNodes { return this.ui ?? (this.ui = new ViewNodes(this.node)); }
    initialize(match: BattleMatch, avatars: SpriteFrame[], back?: () => void): void {
        this.stopSearch(); this.unbindBack(); this.back = back; this.backNode = this.nodes.path('ErrorBack'); this.backNode.active = false;
        if (back) this.backNode.on(Button.EventType.CLICK, back);
        this.nodes.at('BluePlayer', PlayerBadgeView).render(match.blue, avatars[match.blue.avatar - 1]);
        const badge = this.nodes.at('RedPlayer', PlayerBadgeView);
        this.search = { match, avatars, badge, position: badge.node.position.clone(), scale: badge.node.scale.clone(), elapsed: 0, candidate: -1 };
        this.update(0);
        this.progress(0);
    }
    update(dt: number): void {
        const state = this.search;
        if (!state) return;
        state.elapsed += dt;
        const cycle = state.elapsed / MATCH_TIMING.candidate, candidate = Math.floor(cycle);
        if (candidate !== state.candidate) {
            state.candidate = candidate;
            const preview = createMatchOpponent();
            // Cycle all portraits without adjacent repeats; never overwrite the final match identity.
            preview.avatar = 1 + (state.match.red.avatar + candidate) % state.avatars.length;
            state.badge.render(preview, state.avatars[preview.avatar - 1]);
        }
        const hop = Math.sin((cycle - candidate) * Math.PI);
        state.badge.node.setPosition(state.position.x, state.position.y + hop * 12, state.position.z);
        const scale = 1 - hop * 0.035;
        state.badge.node.setScale(state.scale.x * scale, state.scale.y * scale, state.scale.z);
    }
    lockOpponent(): void {
        const state = this.search;
        if (!state) return;
        this.stopSearch();
        state.badge.render(state.match.red, state.avatars[state.match.red.avatar - 1]);
    }
    private stopSearch(): void {
        const state = this.search; this.search = undefined;
        if (state && isValid(state.badge.node, true)) {
            state.badge.node.setPosition(state.position); state.badge.node.setScale(state.scale);
        }
    }
    animate(data: sp.SkeletonData): void {
        const skeleton = this.nodes.at('match_ani', sp.Skeleton);
        skeleton.skeletonData = data; skeleton.setAnimation(0, 'pipeizhong', true);
    }
    progress(value: number): void { this.nodes.at('Status', Label).string = `正在匹配对手… ${Math.floor(Math.min(1, value) * 100)}%`; }
    fail(error: unknown): void { this.lockOpponent(); this.nodes.at('Status', Label).string = `加载失败，请返回重试：${String(error)}`; this.nodes.path('ErrorBack').active = !!this.back; }
    private unbindBack(): void {
        if (this.back && isValid(this.backNode, true)) this.backNode!.off(Button.EventType.CLICK, this.back);
        this.back = undefined; this.backNode = undefined;
    }
    onDisable(): void { this.stopSearch(); }
    onDestroy(): void { this.stopSearch(); this.unbindBack(); }
}
