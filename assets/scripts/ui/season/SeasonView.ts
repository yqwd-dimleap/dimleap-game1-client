import { ViewNodes } from '../binding/ViewNodes';
import { Button, Label, Node, ScrollView, Sprite, SpriteFrame, UITransform, isValid, Vec3 } from 'cc';
import type { SeasonRankEntry, SeasonState } from '../../model/season/SeasonState';
import { RankLevelView } from './RankLevelView';
import type { RankLevelAssets } from './RankLevelView';
import { rankAvatarId } from './RankItemView';

/** Authored season surface over the controller-owned virtual ranking list. */
export class SeasonView {
    private static readonly MIN_SCROLL_HEIGHT = 640;
    private static readonly SELF_RANK_GAP = 12;
    readonly scroll: ScrollView;
    private ui: ViewNodes;
    private seasonButton?: Button;
    private seasonClick?: () => void;
    private scrollNode: Node;
    private scrollTransform: UITransform;
    private scrollMaskTransform: UITransform;
    private selfRankTransform: UITransform;
    constructor(readonly node: Node) {
        this.ui = new ViewNodes(node);
        const scrollNode = node.getChildByName('RankScroll');
        const scroll = scrollNode?.getComponent(ScrollView);
        const scrollTransform = scrollNode?.getComponent(UITransform);
        const scrollMaskTransform = scrollNode?.getChildByName('View')?.getComponent(UITransform);
        const selfRankTransform = node.getChildByName('bg_frame_2')?.getComponent(UITransform);
        if (!scrollNode || !scroll || !scrollTransform || !scrollMaskTransform || !selfRankTransform)
            throw new Error('SeasonView requires RankScroll, View and bg_frame_2');
        this.scrollNode = scrollNode;
        this.scroll = scroll;
        this.scrollTransform = scrollTransform;
        this.scrollMaskTransform = scrollMaskTransform;
        this.selfRankTransform = selfRankTransform;
        this.layout();
    }

    /** Extend only the ranking viewport down to the authored 285-high self-rank card. */
    layout(): void {
        if (!isValid(this.node, true) || !isValid(this.scrollNode, true)) return;
        const rootTransform = this.node.getComponent(UITransform);
        if (!rootTransform) return;
        const scrollBox = this.scrollTransform.getBoundingBoxToWorld();
        const selfRankBox = this.selfRankTransform.getBoundingBoxToWorld();
        const top = rootTransform.convertToNodeSpaceAR(
            new Vec3(scrollBox.x + scrollBox.width * 0.5, scrollBox.y + scrollBox.height, 0));
        const selfRankTop = rootTransform.convertToNodeSpaceAR(
            new Vec3(selfRankBox.x + selfRankBox.width * 0.5, selfRankBox.y + selfRankBox.height, 0));
        const height = Math.max(SeasonView.MIN_SCROLL_HEIGHT,
            top.y - selfRankTop.y - SeasonView.SELF_RANK_GAP);
        if (Math.abs(this.scrollTransform.height - height) < 0.5) return;

        this.scrollTransform.setContentSize(this.scrollTransform.width, height);
        this.scrollMaskTransform.setContentSize(this.scrollMaskTransform.width, height);
        this.scrollNode.setPosition(this.scrollNode.position.x, top.y - height * 0.5, this.scrollNode.position.z);
    }
    bindSeasonRewards(open: () => void): void {
        const button = this.node.getChildByName('btn_season')?.getComponent(Button);
        if (!button) throw new Error('SeasonView requires btn_season');
        if (this.seasonButton && this.seasonClick) this.seasonButton.node.off(Button.EventType.CLICK, this.seasonClick);
        this.seasonButton = button;
        this.seasonClick = open;
        button.node.on(Button.EventType.CLICK, open);
    }
    status(message: string): void {
        if (!message) return;
        const status = this.node.getChildByPath('Status')?.getComponent(Label);
        if (status) status.string = message;
        else console.debug(`[SeasonView] ${message}`);
    }
    summary(season: SeasonState, own?: SeasonRankEntry): void {
        this.ui.at('bg_frame_2/myRanking', Label).string = String(own?.rank ?? season.ownRank ?? '未上榜');
    }
    renderSelf(entry: SeasonRankEntry | undefined, avatars: readonly SpriteFrame[], rankLevelAssets: RankLevelAssets): void {
        const nickname = this.ui.at('bg_frame_2/my_nickname', Label);
        const avatarNode = this.ui.path('bg_frame_2/avatar');
        const rankLevelNode = this.ui.path('bg_frame_2/RankLevel');
        nickname.string = entry?.nickname ?? '未上榜';
        avatarNode.active = !!entry;
        rankLevelNode.active = !!entry;
        if (!entry) return;
        const avatar = avatars[rankAvatarId(entry) - 1];
        if (avatar) this.ui.at('bg_frame_2/avatar', Sprite).spriteFrame = avatar;
        const rankLevel = this.ui.at('bg_frame_2/RankLevel', RankLevelView);
        rankLevel.render(entry.netStars, rankLevelAssets);
    }
    dispose(): void {
        if (this.seasonButton && isValid(this.seasonButton.node, true) && this.seasonClick)
            this.seasonButton.node.off(Button.EventType.CLICK, this.seasonClick);
        this.seasonButton = undefined;
        this.seasonClick = undefined;
    }
}
