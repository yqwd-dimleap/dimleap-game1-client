import { _decorator, Button, Component, instantiate, isValid, Label, Prefab, ScrollView, UITransform } from 'cc';
import { GameTables } from '../../model/config/GameTables';
import { RankingRewardItemView } from './RankingRewardItemView';
import type { RankingRewardAssets } from './RankingRewardTypes';

export interface SeasonRewardPopupAssets extends RankingRewardAssets {
    item: Prefab;
}

/** Server-independent season rank reward preview driven by season_ranking_reward. */
@_decorator.ccclass('SeasonRewardPopupView')
export class SeasonRewardPopupView extends Component {
    private close?: () => void;
    private rewardsRendered = false;

    initialize(close: () => void): void {
        this.dispose();
        this.close = close;
        const button = this.node.getChildByPath('bg/btn_close')?.getComponent(Button);
        if (!button) throw new Error('SeasonRewardPopup requires bg/btn_close');
        button.node.on(Button.EventType.CLICK, close);
    }

    render(assets: SeasonRewardPopupAssets): void {
        const background = this.node.getChildByName('bg');
        if (!background) throw new Error('SeasonRewardPopup requires bg');
        this.setText('bg/bg_frame_1/title', '奖励');
        this.setText('bg/bg_frame_2/title', '排名');

        const scroll = background.getChildByName('ScrollView')?.getComponent(ScrollView);
        if (!scroll?.content) throw new Error('SeasonRewardPopup requires bg/ScrollView with content');
        const host = scroll.content;
        for (const child of [...host.children]) { child.removeFromParent(); child.destroy(); }

        const rewards = GameTables.current.seasonRankingRewards;
        const spacing = 110;
        const view = scroll.node.getComponent(UITransform);
        const content = host.getComponent(UITransform);
        if (!view || !content) throw new Error('SeasonRewardPopup requires valid ScrollView transforms');
        content.setContentSize(view.width, Math.max(view.height, rewards.length * spacing));
        host.setPosition(0, view.height / 2, 0);
        rewards.forEach((reward, index) => {
            const row = instantiate(assets.item);
            host!.addChild(row);
            row.setPosition(0, -spacing / 2 - index * spacing, 0);
            const item = row.getComponent(RankingRewardItemView);
            if (!item) throw new Error('RankingRewardItem requires RankingRewardItemView');
            item.render({ ...reward, assets });
        });
        if (!this.rewardsRendered) scroll.scrollToTop(0);
        this.rewardsRendered = true;
    }

    private setText(path: string, value: string): void {
        const label = this.node.getChildByPath(path)?.getComponent(Label);
        if (label) label.string = value;
    }

    dispose(): void {
        const button = isValid(this.node, true) ? this.node.getChildByPath('bg/btn_close')?.getComponent(Button) : null;
        if (button && this.close) button.node.off(Button.EventType.CLICK, this.close);
        this.close = undefined;
    }

    onDestroy(): void {
        this.dispose();
    }
}
