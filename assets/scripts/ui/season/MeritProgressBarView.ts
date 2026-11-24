import { _decorator, Component, instantiate, Label, Node, ScrollView, Sprite, UITransform, Vec2 } from 'cc';
import type { MeritReward } from '../../model/config/GameTables';
import {
    meritLaneWidth,
    meritMarkerX,
    meritProgress,
    meritTrackFillRange,
    meritTrackWidth,
    MeritProgressModel,
    MERIT_SEGMENT_WIDTH,
    rewardState,
} from '../../model/season/MeritRewards';
import { MeritRewardView } from './MeritRewardView';

export interface MeritProgressActions {
    claim?: (reward: MeritReward) => void;
    detail?: (reward: MeritReward, anchor: Node) => void;
}

@_decorator.ccclass('MeritProgressBarView')
export class MeritProgressBarView extends Component {
    static readonly SEGMENT_WIDTH = MERIT_SEGMENT_WIDTH;
    static readonly TOTAL_WIDTH = meritTrackWidth(27);
    private milestones: readonly MeritReward[] = [];
    private actions: MeritProgressActions = {};
    private bar?: Sprite;
    private model?: MeritProgressModel;
    private markRoot?: Node;
    private markTemplate?: Node;
    private scroll?: ScrollView;
    private scrollViewport?: UITransform;
    private scrollScheduled = false;
    private markers: { reward: MeritReward; view: MeritRewardView }[] = [];

    initialize(milestones: readonly MeritReward[], actions: MeritProgressActions = {}): void {
        this.milestones = milestones;
        this.actions = actions;
        const bg = this.node.getChildByName('jindutiao_bg');
        const bar = this.node.getChildByName('jindutiao');
        const marks = this.node.getChildByName('mark_node');
        const rootTransform = this.node.getComponent(UITransform);
        const bgTransform = bg?.getComponent(UITransform);
        const barTransform = bar?.getComponent(UITransform);
        const markTransform = marks?.getComponent(UITransform);
        this.bar = bar?.getComponent(Sprite) ?? undefined;
        if (!bg || !bar || !bgTransform || !barTransform || !markTransform || !rootTransform || !this.bar || !marks)
            throw new Error('MeritProgressBar prefab requires UITransform/Sprite lanes and mark_node');

        const width = meritTrackWidth(milestones.length);
        const height = Math.max(rootTransform.height, bgTransform.height, barTransform.height, markTransform.height);
        rootTransform.setContentSize(width, height);
        bgTransform.setAnchorPoint(0, bgTransform.anchorY);
        bgTransform.setContentSize(width, bgTransform.height);
        barTransform.setAnchorPoint(0, barTransform.anchorY);
        barTransform.setContentSize(width, barTransform.height);
        bg.setPosition(-width * .5, bg.position.y, bg.position.z);
        bar.setPosition(-width * .5, bar.position.y, bar.position.z);
        markTransform.setContentSize(width, markTransform.height);

        // The authored ScrollView content is the visual viewport container. Its
        // scroll offset remains owned by ScrollView; only the content extent and
        // the bar's local alignment are updated here.
        if (this.node.parent?.name === 'content') {
            const contentTransform = this.node.parent.getComponent(UITransform);
            if (contentTransform) {
                contentTransform.setContentSize(width, Math.max(contentTransform.height, height));
                this.node.setPosition(
                    width * (rootTransform.anchorX - contentTransform.anchorX),
                    this.node.position.y,
                    this.node.position.z,
                );
            }
            let ancestor = this.node.parent.parent;
            while (ancestor && !ancestor.getComponent(ScrollView)) ancestor = ancestor.parent;
            this.scroll = ancestor?.getComponent(ScrollView) ?? undefined;
            this.scrollViewport = ancestor?.getChildByName('view')?.getComponent(UITransform) ?? undefined;
        }

        this.bar.type = Sprite.Type.FILLED;
        this.bar.fillType = Sprite.FillType.HORIZONTAL;
        this.bar.fillStart = 0;
        this.bar.fillRange = 0;
        this.markRoot = marks;
        this.markTemplate = marks.getChildByName('MarkReward') ?? undefined;
        if (!this.markTemplate) throw new Error('MeritProgressBar/mark_node requires a MarkReward template');
        this.rebuildMarkers();
    }

    private rebuildMarkers(): void {
        if (!this.markRoot || !this.markTemplate) return;
        for (const child of [...this.markRoot.children]) if (child !== this.markTemplate) child.destroy();
        this.markers = [];
        this.markTemplate.active = false;
        this.milestones.forEach((reward, index) => {
            const node = instantiate(this.markTemplate!);
            node.name = `MarkReward_${reward.id}`;
            node.active = true;
            node.setPosition(meritMarkerX(index, this.milestones.length), 0, 0);
            const label = node.getChildByName('mark_number')?.getComponent(Label);
            if (label) label.string = String(reward.requiredMerit);
            const viewNode = node.getChildByName('MeritReward');
            const view = viewNode?.getComponent(MeritRewardView);
            if (!view) throw new Error('MarkReward requires MeritReward/MeritRewardView');
            view.initialize(
                reward,
                rewardState(reward, 0, []),
                () => this.actions.claim?.(reward),
                anchor => this.actions.detail?.(reward, anchor),
            );
            this.markRoot!.addChild(node);
            this.markers.push({ reward, view });
        });
    }

    render(merit: number, claimed: readonly string[] = []): MeritProgressModel {
        this.model = meritProgress(merit, this.milestones);
        if (this.bar) this.bar.fillRange = meritTrackFillRange(this.model, this.milestones.length);
        for (const marker of this.markers)
            marker.view.render(rewardState(marker.reward, this.model.merit, claimed));
        this.scheduleScrollToProgress();
        return this.model;
    }

    private scheduleScrollToProgress(): void {
        if (!this.scroll || !this.model || this.scrollScheduled) return;
        // ScrollView measures its content extents after this component's resize in
        // the current frame. Apply the offset on the next tick so max scroll is ready.
        this.scrollScheduled = true;
        this.scheduleOnce(() => {
            this.scrollScheduled = false;
            if (!this.scroll || !this.model) return;
            const width = meritTrackWidth(this.milestones.length);
            const viewport = this.scrollViewport?.width ?? 0;
            const progressX = meritLaneWidth(this.milestones.length) * this.model.totalProgress;
            // Keep the current marker near the right side, but never hide the
            // start of the first 100-unit segment at low merit values.
            const offset = Math.max(0, Math.min(Math.max(0, width - viewport), progressX - viewport * .75));
            this.scroll.scrollToOffset(new Vec2(offset, 0), 0);
        });
    }

    get progress(): MeritProgressModel | undefined { return this.model; }
    get markerCount(): number { return this.markers.length; }

    onDestroy(): void {
        this.markers = [];
        this.markRoot = undefined;
        this.markTemplate = undefined;
        this.scroll = undefined;
        this.scrollViewport = undefined;
        this.scrollScheduled = false;
        this.actions = {};
    }
}
