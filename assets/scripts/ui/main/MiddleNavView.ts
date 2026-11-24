import { _decorator, Button, Label } from 'cc';
import { GameTables } from '../../model/config/GameTables';
import type { SeasonState } from '../../model/season/SeasonState';
import { MeritProgressBarView } from '../season/MeritProgressBarView';
import type { MeritProgressActions } from '../season/MeritProgressBarView';
import { UIBase } from '../UIBase';

/** The authored home battle entry owns its button; navigation stays in the controller. */
@_decorator.ccclass('MiddleNavView')
export class MiddleNavView extends UIBase {
    private battle!: Button;
    private progress?: MeritProgressBarView;
    private meritValue?: Label;
    initialize(enterBattle: () => void, openSeason?: () => void, rewardActions: MeritProgressActions = {}): void {
        this.bindUI();
        this.battle = this.ui.at('btn_battle', Button);
        this.meritValue = this.ui.at('jungong_bg/bg_frame_1/jungong_value', Label);
        this.click('btn_battle', enterBattle);
        this.progress = this.ui.at('jungong_bg/ScrollView/view/content/MeritProgressBar', MeritProgressBarView);
        this.progress.initialize(GameTables.current.milestones, {
            claim: reward => (rewardActions.claim ?? (() => openSeason?.()))(reward),
            detail: (reward, anchor) => (rewardActions.detail ?? ((_, __) => openSeason?.()))(reward, anchor),
        });
    }
    setEnabled(enabled: boolean): void { this.battle.interactable = enabled; }
    renderMerit(season: SeasonState): void {
        if (this.meritValue) this.meritValue.string = String(season.merit);
        this.progress?.render(season.merit, season.claimedMilestoneIds);
    }
}
