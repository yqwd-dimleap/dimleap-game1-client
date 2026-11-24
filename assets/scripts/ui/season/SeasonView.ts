import { ViewNodes } from '../binding/ViewNodes';
import { Button, Label, Node, ScrollView, Sprite, SpriteFrame, isValid } from 'cc';
import type { SeasonRankEntry, SeasonState } from '../../model/season/SeasonState';
import { RankLevelView } from './RankLevelView';
import type { RankLevelAssets } from './RankLevelView';
import { rankAvatarId } from './RankItemView';

/** Authored season surface over the controller-owned virtual ranking list. */
export class SeasonView {
    readonly scroll: ScrollView;
    private ui: ViewNodes;
    private seasonButton?: Button;
    private seasonClick?: () => void;
    constructor(readonly node: Node) {
        this.ui = new ViewNodes(node);
        const scroll = node.getChildByName('RankScroll')?.getComponent(ScrollView);
        if (!scroll) throw new Error('SeasonView requires RankScroll');
        this.scroll = scroll;
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
