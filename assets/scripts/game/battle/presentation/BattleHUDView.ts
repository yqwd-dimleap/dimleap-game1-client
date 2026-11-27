import { _decorator, Button, Component, Label, Node, isValid, sp } from 'cc';
import { GM_VISIBLE } from '../../../core/Gm';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import type { BattleMatch } from '../../../model/battle/BattleMatch';
import type { Team } from '../../../model/battle/types';
type TurnSpineSkin = 'buzu' | 'duishou' | 'wode';
const BANNER_HOLD_SECONDS = .5;
@_decorator.ccclass('BattleHUDView')
export class BattleHUDView extends Component {
    private ui?: ViewNodes;
    private turnKey = '';
    private roundTurnBanner?: sp.Skeleton;
    private turnBanner?: sp.Skeleton;
    private turnSpineSkin: TurnSpineSkin | '' = '';
    private sequenceRequest = 0;
    private turnRequest = 0;
    private introRunning = false;
    private cannotTurnShown = false;
    private pendingTurn?: { team: Team; deploying: boolean };
    private forceWinner?: (winner: Team) => void;
    private redWinNode?: Node;
    private blueWinNode?: Node;
    private readonly chooseRedWin = (): void => this.forceWinner?.(1);
    private readonly chooseBlueWin = (): void => this.forceWinner?.(0);
    private onPause?: () => void;
    private pauseNode?: Node;
    get introReady(): boolean { return !this.introRunning; }
    private get nodes(): ViewNodes { return this.ui ?? (this.ui = new ViewNodes(this.node)); }
    initialize(match: BattleMatch, onPause: () => void, forceWinner?: (winner: Team) => void, allowPause = true): void {
        this.dispose(); this.onPause = onPause;
        this.forceWinner = forceWinner;
        this.pauseNode = this.node.getChildByName('btn_pause') ?? this.node.getChildByName('Button') ?? undefined;
        if (!this.pauseNode?.getComponent(Button)) throw new Error('BattleHUD requires btn_pause or Button');
        this.pauseNode.active = allowPause;
        if (allowPause) this.pauseNode.on(Button.EventType.CLICK, onPause);
        this.roundTurnBanner = this.nodes.at('round_1_ani', sp.Skeleton);
        this.turnBanner = this.nodes.at('round_2_ani', sp.Skeleton);
        this.roundTurnBanner.node.active = false;
        this.turnBanner.node.active = false;
        this.hideLegacyBanners();
        this.nodes.at('battle_info/BluePlayerName', Label).string = match.blue.nickname;
        this.nodes.at('battle_info/RedPlayerName', Label).string = match.red.nickname;
        this.redWinNode = this.nodes.path('btn_red_win'); this.blueWinNode = this.nodes.path('btn_blue_win');
        // 强制胜负只是 GM 工具，总开关关闭时整颗节点隐藏，避免误触。
        this.redWinNode.active = GM_VISIBLE; this.blueWinNode.active = GM_VISIBLE;
        if (GM_VISIBLE) {
            this.redWinNode.on(Button.EventType.CLICK, this.chooseRedWin);
            this.blueWinNode.on(Button.EventType.CLICK, this.chooseBlueWin);
        }
        this.setSeriesLives([2, 2]);
    }
    showRound(round: number, team: Team, deploying = true): void {
        const request = ++this.sequenceRequest;
        this.turnRequest++;
        this.turnKey = ''; this.pendingTurn = { team, deploying };
        this.hideTurnSpine(); this.hideCannotTurn();
        this.introRunning = true;
        this.playRoundTurnSpine(round, () => {
            if (request !== this.sequenceRequest || !isValid(this, true)) return;
            this.scheduleOnce(() => {
                if (request !== this.sequenceRequest || !isValid(this, true)) return;
                this.hideRoundTurnSpine(() => {
                    if (request !== this.sequenceRequest || !isValid(this, true)) return;
                    const pending = this.pendingTurn;
                    this.pendingTurn = undefined;
                    if (pending) this.presentTurn(pending.team, pending.deploying, request);
                    else this.finishRoundIntro(request);
                });
            }, BANNER_HOLD_SECONDS);
        });
    }
    turn(team: Team, deploying: boolean): void {
        if (this.cannotTurnShown) return;
        if (this.pendingTurn) { this.pendingTurn = { team, deploying }; return; }
        this.presentTurn(team, deploying);
    }
    private presentTurn(team: Team, deploying: boolean, sequence = 0): void {
        const key = `${team}:${deploying}`; if (this.turnKey === key) return; this.turnKey = key;
        this.hideCannotTurn();
        if (deploying) {
            this.playTurnSpine(team === 0 ? 'wode' : 'duishou', sequence);
        } else {
            this.hideTurnSpine();
            this.finishRoundIntro(sequence);
        }
    }
    showCannotTurn(team: Team): void {
        // 行动点不足只提示玩家本人；红方仍按 cannot-turn 状态跳过并继续回合切换。
        if (team !== 0) return;
        const request = ++this.sequenceRequest;
        this.introRunning = true;
        this.pendingTurn = undefined; this.turnKey = `${team}:cannot-turn`;
        this.hideRoundTurnSpine();
        this.cannotTurnShown = true;
        this.playTurnSpine('buzu', request);
    }
    hideCannotTurn(): void {
        const wasShown = this.cannotTurnShown;
        this.cannotTurnShown = false;
        if (wasShown) {
            this.hideTurnSpine();
            this.introRunning = false;
        }
    }
    hideRoundTurn(immediate = false): void {
        this.sequenceRequest++;
        this.introRunning = false;
        this.pendingTurn = undefined;
        if (immediate) this.stopSpine(this.roundTurnBanner);
        else this.hideRoundTurnSpine();
    }
    status(text: string): void {
        const label = this.node.getChildByName('Status')?.getComponent(Label);
        if (label) label.string = /失败|返回主界面/.test(text) ? text : '';
    }
    setSeriesLives(lives: readonly [number, number]): void {
        for (const team of [0, 1] as const) for (const i of [1, 2])
            this.nodes.path(`battle_info/${team === 0 ? 'Blue' : 'Red'}PlayerRound/round_${i}`).active = lives[team] >= i;
    }
    dispose(): void {
        this.sequenceRequest++; this.turnRequest++;
        this.hideRoundTurn(); this.hideCannotTurn();
        this.stopSpine(this.roundTurnBanner);
        this.stopSpine(this.turnBanner);
        this.roundTurnBanner = undefined; this.turnBanner = undefined; this.turnSpineSkin = '';
        if (this.onPause && isValid(this.pauseNode, true)) this.pauseNode!.off(Button.EventType.CLICK, this.onPause);
        if (isValid(this.redWinNode, true)) this.redWinNode!.off(Button.EventType.CLICK, this.chooseRedWin);
        if (isValid(this.blueWinNode, true)) this.blueWinNode!.off(Button.EventType.CLICK, this.chooseBlueWin);
        this.onPause = undefined; this.pauseNode = undefined;
        this.forceWinner = undefined; this.redWinNode = undefined; this.blueWinNode = undefined;
    }
    onDestroy(): void { this.dispose(); }

    private playRoundTurnSpine(round: number, onComplete: () => void): void {
        const value = Math.max(1, Math.min(3, Math.floor(round)));
        this.playSpine(this.roundTurnBanner, 'born', String(value), onComplete);
    }

    private hideRoundTurnSpine(onComplete?: () => void): void {
        this.playSpineOnce(this.roundTurnBanner, 'out', onComplete);
    }

    private playTurnSpine(skin: TurnSpineSkin, sequence = 0): void {
        const request = ++this.turnRequest;
        this.turnSpineSkin = skin;
        this.playSpine(this.turnBanner, 'born', skin, () => {
            if (request !== this.turnRequest || !isValid(this, true)) return;
            this.scheduleOnce(() => {
                if (request !== this.turnRequest || !isValid(this, true)) return;
                this.playSpineOnce(this.turnBanner, 'out', () => {
                    if (request !== this.turnRequest || !isValid(this, true)) return;
                    this.turnBanner!.node.active = false;
                    this.turnSpineSkin = '';
                    this.finishRoundIntro(sequence);
                });
            }, BANNER_HOLD_SECONDS);
        });
    }

    private hideTurnSpine(): void {
        this.turnRequest++;
        if (this.turnSpineSkin) this.playSpineOnce(this.turnBanner, 'out');
        this.turnSpineSkin = '';
    }

    private playSpine(skeleton: sp.Skeleton | undefined, clip: string, skin: string, onComplete?: () => void): void {
        if (!skeleton?.skeletonData) throw new Error(`BattleHUD Spine data missing for ${clip}`);
        const node = skeleton.node;
        node.active = true;
        skeleton.setAnimationCacheMode(sp.Skeleton.AnimationCacheMode.REALTIME);
        skeleton.paused = false; skeleton.timeScale = 1;
        skeleton.clearTracks(); skeleton.setSkin(skin); skeleton.setToSetupPose();
        if (!skeleton.findAnimation(clip)) throw new Error(`BattleHUD Spine animation missing: ${clip}`);
        this.listenForCompletion(skeleton, clip, onComplete);
        skeleton.setAnimation(0, clip, false);
    }

    private playSpineOnce(skeleton: sp.Skeleton | undefined, clip: string, onComplete?: () => void): void {
        if (!skeleton?.skeletonData || !skeleton.node.active || !skeleton.findAnimation(clip)) return;
        skeleton.paused = false; skeleton.timeScale = 1;
        skeleton.clearTracks(); skeleton.setToSetupPose();
        this.listenForCompletion(skeleton, clip, onComplete);
        skeleton.setAnimation(0, clip, false);
    }

    private listenForCompletion(skeleton: sp.Skeleton, clip: string, onComplete?: () => void): void {
        skeleton.setCompleteListener(() => {});
        if (!onComplete) return;
        skeleton.setCompleteListener(entry => {
            if (entry.animation?.name !== clip || !isValid(this, true)) return;
            skeleton.setCompleteListener(() => {});
            onComplete();
        });
    }

    private finishRoundIntro(sequence: number): void {
        if (sequence === this.sequenceRequest) this.introRunning = false;
    }

    private stopSpine(skeleton: sp.Skeleton | undefined): void {
        if (!skeleton || !isValid(skeleton, true)) return;
        skeleton.clearTracks();
        skeleton.node.active = false;
    }

    private hideLegacyBanners(): void {
        for (const name of ['round_turn_bg', 'cannot_turn', 'blue_turn', 'red_turn']) {
            const node = this.node.getChildByName(name);
            if (node) node.active = false;
        }
    }
}
