import { _decorator, Button, game, instantiate, isValid, Node, Prefab, SpriteFrame, sp, PhysicsSystem2D } from 'cc';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';
import { createBattleMatch } from '../../model/battle/BattleMatch';
import { MatchView } from '../battle/presentation/MatchView';
import { MATCH_SPINE_PATH } from '../battle/BattleContent';
import { StartupTrace } from '../../core/StartupTrace';
import { UIBase } from '../../ui/UIBase';
import type { MainPage } from '../../ui/main/MainShellView';
import { GameApp } from '../GameApp';
import { SceneFlow } from '../SceneFlow';
import { loadPlayerAvatars } from '../../ui/common/PlayerUIAssets';
import { MiddleNavView } from '../../ui/main/MiddleNavView';
import { PlayerInfoView } from '../../ui/main/PlayerInfoView';
import type { ModalPresenter } from '../../ui/common/ModalHost';
import { PlayerSettingsController } from './PlayerSettingsController';
import { MeritRewardController } from '../season/MeritRewardController';
import { ToastService } from '../../ui/common/ToastService';
const { ccclass } = _decorator;

/** The current authored home page owns only its battle entry. BottomNav owns page navigation. */
@ccclass('HomeController')
export class HomeController extends UIBase {
    private middle?: MiddleNavView;
    private battleButton?: Button;
    private readonly onBattleButtonClick = (): void => { void this.enterBattle(); };
    private busy = false;
    private matching?: Node;
    private matchResources?: ResourceScope;
    private profileOff?: () => void;
    private disposed = false;
    private meritGeneration = 0;
    private settings?: PlayerSettingsController;
    private rewards?: MeritRewardController;
    private playerInfo?: PlayerInfoView;
    navigate?: (page: MainPage) => Promise<void>;
    mountOverlay?: (node: Node) => void;
    navigationBusy?: (busy: boolean) => void;
    report?: (message: string) => void;
    async initialize(resources: ResourceScope, modals: ModalPresenter): Promise<void> {
        game.frameRate = 30; PhysicsSystem2D.instance.enable = false;
        const player = this.node.getChildByName('PlayerInfo')?.getComponent(PlayerInfoView);
        if (!player) throw new Error('HomeView requires PlayerInfo/PlayerInfoView');
        const app = GameApp.instance;
        this.playerInfo = player;
        this.settings = new PlayerSettingsController(app, modals, message => this.report?.(message));
        this.rewards = new MeritRewardController(app, modals, message => this.report?.(message),
            () => this.refreshMiddleMerit());
        player.initialize(() => this.settings?.open());
        this.profileOff = app.events.on('profile:changed', profile => {
            void player.renderPlayer(profile, resources).catch(error => {
                if (isValid(this, true)) this.report?.(`玩家信息加载失败：${String(error)}`);
            });
        });
        await player.renderPlayer(app.profile, resources);
        if (!isValid(this, true)) return;
        const legacyMiddle = this.node.getChildByName('MiddleNav');
        this.middle = legacyMiddle?.getComponent(MiddleNavView) ?? undefined;
        const battleNode = this.node.getChildByName('btn_battle') ?? legacyMiddle?.getChildByName('btn_battle');
        if (this.middle) {
            this.middle.initialize(() => { void this.enterBattle(); }, () => { void this.navigate?.('season'); }, {
                claim: reward => this.rewards?.claim(reward),
                detail: (reward, anchor) => this.rewards?.detail(reward, anchor),
            });
            this.middle.setEnabled(true);
            this.refreshMiddleMerit();
        } else {
            this.battleButton = battleNode?.getComponent(Button) ?? undefined;
            if (!this.battleButton) throw new Error('HomeView requires btn_battle/Button or MiddleNav/MiddleNavView');
            this.battleButton.node.on(Button.EventType.CLICK, this.onBattleButtonClick, this);
            this.battleButton.interactable = true;
        }
        StartupTrace.mark('home-interactive');
    }
    show(): void { this.refreshMiddleMerit(); }
    private refreshMiddleMerit(): void {
        if (!this.middle || this.disposed) return;
        const generation = ++this.meritGeneration;
        const seasons = GameApp.instance.seasons;
        this.middle.renderMerit(seasons.prototypeSnapshot().season);
        if (!seasons.available) return;
        void seasons.load().then(snapshot => {
            if (snapshot && !this.disposed && generation === this.meritGeneration && isValid(this, true))
                this.middle?.renderMerit(snapshot.season);
        }).catch(error => console.warn('[MiddleNav] season merit refresh failed:', error));
    }
    private async enterBattle(): Promise<void> {
        if (this.busy) return;
        if (!GameApp.instance.heroes.snapshot().lineup.some(Boolean)) {
            ToastService.show('至少选择一个英雄上阵');
            return;
        }
        this.busy = true;
        if (this.middle) this.middle.setEnabled(false);
        if (this.battleButton) this.battleButton.interactable = false;
        this.navigationBusy?.(true);
        try {
            this.report?.('');
            const app = GameApp.instance, scope = this.matchResources = app.res.createScope('matching:home');
            await app.startBattle();
            const [prefab, avatars] = await Promise.all([
                scope.load(BUNDLES.battleUi, 'prefabs/MatchView', Prefab),
                loadPlayerAvatars(scope),
            ]);
            if (!isValid(this, true)) return;
            const match = app.battleMatch = createBattleMatch(Math.random, Date.now(), app.profile);
            this.matching = instantiate(prefab as Prefab);
            if (!this.mountOverlay) throw new Error('Home overlay host missing');
            this.mountOverlay(this.matching);
            const view = this.matching.getComponent(MatchView)!; view.initialize(match, avatars as SpriteFrame[]);
            void scope.load(BUNDLES.battleUi, MATCH_SPINE_PATH, sp.SkeletonData).then(data => {
                if (isValid(view, true)) view.animate(data);
            }).catch(error => { if (isValid(view, true)) view.fail(error); });
            await SceneFlow.instance.enter('battle', state => { if (isValid(view, true)) view.progress(state.progress); });
        } catch (error) {
            GameApp.instance.abandonBattle();
            this.disposeMatching();
            if (!isValid(this, true)) return;
            this.busy = false;
            if (this.middle) this.middle.setEnabled(true);
            if (this.battleButton) this.battleButton.interactable = true;
            this.navigationBusy?.(false);
            console.error('[Home] battle load failed', error);
            this.report?.(`战斗加载失败，可再次点击开始战斗重试：${String(error)}`);
        }
    }
    private disposeMatching(): void {
        if (this.matching && isValid(this.matching, true)) this.matching.destroy();
        this.matching = undefined; this.matchResources?.dispose(); this.matchResources = undefined;
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.meritGeneration++;
        this.profileOff?.(); this.profileOff = undefined;
        if (this.battleButton && isValid(this.battleButton.node, true)) {
            this.battleButton.node.off(Button.EventType.CLICK, this.onBattleButtonClick, this);
        }
        this.battleButton = undefined;
        const playerInfo = this.playerInfo; this.playerInfo = undefined;
        if (playerInfo && isValid(playerInfo, true)) playerInfo.dispose();
        const settings = this.settings; this.settings = undefined;
        settings?.dispose();
        const rewards = this.rewards; this.rewards = undefined;
        rewards?.dispose();
        this.disposeMatching();
    }
    onDestroy(): void { this.dispose(); super.onDestroy(); }
}
