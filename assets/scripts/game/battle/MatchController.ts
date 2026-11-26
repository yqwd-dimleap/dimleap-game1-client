import { BattleHUDView } from './presentation/BattleHUDView';
import type { AIRow } from '../../model/config/GameTables';
import { MatchView } from './presentation/MatchView';
import { VSView } from './presentation/VSView';
import { BattleSettlementView } from './presentation/BattleSettlementView';
import { RoundSettlementView } from './presentation/RoundSettlementView';
import { BattlePauseView } from './presentation/BattlePauseView';
import { createBattleMatch, matchSearchWait, MATCH_TIMING } from '../../model/battle/BattleMatch';
import type { BattleMatch } from '../../model/battle/BattleMatch';
import { HERO_ICON_PATHS } from '../../model/hero/HeroPortraits';
import { MATCH_SPINE_PATH, SETTLEMENT_ART_PATHS, SETTLEMENT_SPINE_PATH, battleMapById } from './BattleContent';
import { TEAM_COLORS } from '../../ui/theme/BattleTheme';
import { CombatRunner } from './combat/CombatRunner';
import { BattleSession } from './BattleSession';
import type { BattleMode as Mode } from './BattleSession';
import { DeploymentController } from './deployment/DeploymentController';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';
import { createBattleConfig } from '../../model/battle/BattleConfig';
import { _decorator, Component, Node, Label, Graphics, Color, Prefab, EffectAsset,
    instantiate, isValid, PhysicsSystem2D, Vec2, Vec3, UITransform, BoxCollider2D, Camera, Canvas, game, Game, Collider2D, Contact2DType, IPhysics2DContact, sys, SpriteFrame, sp } from 'cc';
import { BattleWorldView } from './presentation/BattleWorldView';
import { arenaEdges, bonusAt, configureArenaFromRails, RailRect, Deployment, DEPLOYABLE_HERO_IDS, HeroId, HEROES, HERO_IDS, Point, RULES, Team, distance } from '../../model/config/PrototypeConfig';
import { TokenBody } from './physics/TokenBody';
import { shotFromDrag, guidePath, Shot, clampedPull, canEnterArena, shotWaitLimit } from '../../model/battle/ThrowMath';
import { ThrowInput } from './deployment/ThrowInput';
import { planBotShot } from './ai/BotDeployer';
import { CombatModel, AttackEvent } from '../../model/battle/CombatModel';
import { BattleSeries, livesBeforeRound, ROUND_SETTLEMENT_DELAY } from '../../model/battle/BattleSeries';
import { UnitView } from './presentation/UnitView';
import { BattleCamera } from './camera/BattleCamera';
import { SlingshotView } from './presentation/SlingshotView';
import { GameApp } from '../GameApp';
import { SceneFlow } from '../SceneFlow';
import { loadPlayerAvatars } from '../../ui/common/PlayerUIAssets';
import { HeroCardFrameIndex, loadHeroCardFrame } from '../../ui/heroes/HeroCardFrame';
import { StartupTrace } from '../../core/StartupTrace';
import { BattleTuningStore, currentTuning } from '../../model/battle/BattleTuning';
import { BattleGMPanel } from './presentation/BattleGMPanel';
import { DeploymentBudget } from '../../model/battle/DeploymentBudget';
import { STARTER_LINEUP } from '../../model/hero/HeroProgress';
import { BattleHandPanel } from './presentation/BattleHandPanel';
import type { BattleCardFrames } from './presentation/BattleCardView';
import { BattleMapView } from './presentation/BattleMapView';
import { TroopAssets } from './presentation/TroopAssets';
import { TroopSpineView } from './presentation/TroopSpineView';
import { ArrowProjectiles } from './presentation/ArrowProjectiles';
import { AimGuideView } from './presentation/AimGuideView';
import { DeploymentEffects } from './presentation/DeploymentEffects';
import { NewbieGuideView } from './tutorial/NewbieGuideView';
import { RemoteContentPrewarm } from './tutorial/RemotePrewarm';
import { DEBUG } from 'cc/env';
import { GM_VISIBLE } from '../../core/Gm';
const { ccclass } = _decorator;
interface Effect extends AttackEvent { life: number }

@ccclass('MatchController')
export class MatchController extends Component {
    private combatRunner = new CombatRunner(() => this.clock());
    private session = new BattleSession();
    private series = new BattleSeries();
    private deploymentFlow = new DeploymentController(this.session, {
        clearAim: reset => this.clearAim(reset), cameraMoving: () => !!this.camera?.moving,
        updateIngress: () => this.updateTokenIngress(), pullLimit: () => this.pullLimit(), aim: (dx, dy) => this.aim(dx, dy),
        finishShot: () => this.finishShot(), beginCombat: () => this.beginCombat(), frame: stage => this.camera?.frame(stage),
        spawnPoint: () => this.spawnPoint(), spawnToken: (team, hero, point, live) => this.spawnToken(team, hero, point, live),
        botPlan: available => this.botPlan(available), label: (key, value) => this.label(key, value), refreshHud: () => this.refreshHud(),
        cancelInput: () => this.throwInput?.cancel(), blocked: () => this.paused || this.gmVisible,
        introReady: () => this.hud.introReady,
        launch: (token, shot) => {
            this.tutorialGuide?.hideShootGuide();
            this.sling().release(); this.camera?.frame('flight'); token.node.setParent(this.tokenRoot, true); token.launch(shot.vx, shot.vy);
        },
        reinforce: point => this.deploymentFx?.reinforce(point), prepareTurn: () => this.prepareTurn(), snapshot: () => this.getSnapshot(),
        showCannotTurn: team => this.hud.showCannotTurn(team), hideCannotTurn: () => this.hud.hideCannotTurn(),
        shotSettled: bonuses => { if (this.tutorialStage === 'shoot' && bonuses[0] > 0) this.finishTutorialGuide(); },
    });
    private static tuningStore?: BattleTuningStore;
    private resources?: ResourceScope;
    private gm?: BattleGMPanel;

    private get gmVisible(): boolean { return !!this.gm?.visible; }
    private world!: BattleWorldView;
    private hud!: BattleHUDView;
    private board!: Node;
    private mapView?: BattleMapView;
    private initialMapReady = false;

    private tokenRoot!: Node;
    private launchRoot!: Node;
    private unitRoot!: Node;
    private tokenPrefab!: Prefab;
    private unitPrefab!: Prefab;
    private aimGuide!: AimGuideView;
    private troopAssets = new TroopAssets();
    private arrows?: ArrowProjectiles;
    private deploymentFx?: DeploymentEffects;
    private throwInput?: ThrowInput;
    private camera?: BattleCamera;

    private views = new Map<number, UnitView>();
    private depthScratch: UnitView[] = [];
    private depthSortElapsed = 0;
    private static readonly DEPTH_SORT_INTERVAL = 1 / 15;
    private effectColor = new Color();
    private model: CombatModel | null = null;
    private effects: Effect[] = [];

    private enemyAI?: Readonly<AIRow>;
    private battleDifficulty?: Readonly<AIRow>;
    private levels: Partial<Record<HeroId, number>> = {};
    private hand?: BattleHandPanel;

    private serial = 0;
    private collisions = 0;
    private wallHits = 0;
    private power = 0;

    private paused = false;
    private fast = false;
    private revision = 0;
    private loaded = false;
    private leaving = false;
    private hudCamera?: Camera;
    private hudClearFlags = 7;
    private hudVisibility = 0;
    private previousCollisionMasks: number[] = [];
    private previousMaxSubSteps?: number;
    private hudElapsed = 0;
    private hadEffects = false;
    private clock(): number { return globalThis.performance?.now?.() ?? Date.now(); }
    private metricsStartedAt = 0;
    private interactiveAt?: number;
    private frameSamples = 0;
    private lastFrameMs = 0;
    private averageFrameMs = 0;
    private maxFrameMs = 0;
    private matching?: MatchView;
    private settlement?: BattleSettlementView;
    private match?: BattleMatch;
    private avatars: readonly SpriteFrame[] = [];
    private roundSettlement?: RoundSettlementView;
    private roundPresentationSerial = 0;
    private seriesFinalized = false;
    private battlePause?: BattlePauseView;
    private matchStage = 'matching';
    private tutorialGuide?: NewbieGuideView;
    private tutorialStage: 'none' | 'welcome' | 'select' | 'shoot-prompt' | 'shoot' | 'done' = 'none';
    private readonly beginNextRound = (): void => {
        if (!this.loaded || this.leaving || this.seriesFinalized || this.session.phase !== 'result') return;
        this.hand!.node.active = true;
        this.reset('battle', true);
    };

    async start(): Promise<void> {
        this.metricsStartedAt = this.clock();
        try {
            game.frameRate = 60;
            if (DEBUG && !MatchController.tuningStore) {
                MatchController.tuningStore = new BattleTuningStore(sys.localStorage);
                MatchController.tuningStore.restore();
            }
            const world = this.node.getChildByName('BattleWorld');
            const hudView = this.node.getChildByName('BattleHUD')?.getComponent(BattleHUDView);
            if (!world || !hudView) throw new Error('BattleView requires BattleWorld and BattleHUD/BattleHUDView');
            this.hud = hudView; this.world = world.getComponent(BattleWorldView)!;
            if (!this.world) throw new Error('BattleWorld requires BattleWorldView');
            this.board = this.world.board; this.tokenRoot = this.world.tokens; this.unitRoot = this.world.units;
            this.launchRoot = this.board.getChildByName('ActorLayer')!;
            if (!this.launchRoot) throw new Error('ActorLayer missing on BoardRoot');
            // Editor composition guides are replaced by the selected hero's moving base.
            for (const team of [0, 1] as const) {
                const guide = this.world.slingshot(team).node.getChildByName('board');
                if (guide) guide.active = false;
            }
            this.hud.node.active = false; this.world.camera.enabled = false;
            this.configureBoard();
            this.mapView = this.board.getComponent(BattleMapView) ?? undefined;
            if (!this.mapView) throw new Error('BattleMapView missing on BoardRoot');
            this.camera = new BattleCamera(this.world.camera);
            this.hudCamera = this.node.parent!.getComponent(Canvas)!.cameraComponent!;
            this.hudClearFlags = this.hudCamera.clearFlags; this.hudVisibility = this.hudCamera.visibility;
            this.hudCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY; this.hudCamera.visibility = 1 << 25;
            const physics = PhysicsSystem2D.instance;
            // Default tokens hit every wall; only a newly launched outside token ignores end rails.
            this.previousCollisionMasks = [1, 2, 4].map(group => physics.collisionMatrix[group]);
            physics.collisionMatrix[1] = 7; physics.collisionMatrix[2] = 1; physics.collisionMatrix[4] = 5;
            for (const collider of this.board.getComponentsInChildren(Collider2D)) collider.group = collider.group;
            physics.enable = true; physics.gravity = new Vec2(0, 0); physics.fixedTimeStep = RULES.physicsStep;
            // Catch up at most the same 0.1s that the turn clock accepts, including on slower devices.
            this.previousMaxSubSteps = physics.maxSubSteps;
            physics.maxSubSteps = Math.max(6, physics.maxSubSteps);
            const app = GameApp.instance;
            await app.initialize();
            if (!isValid(this, true) || this.leaving) return;
            const tutorialBattle = app.isTutorialBattle;
            this.matchStage = tutorialBattle ? 'vs' : 'matching';
            const resources = this.resources = SceneFlow.instance.resourcesFor('battle');
            await this.loadTutorialGuide(resources);
            if (!isValid(this, true) || this.leaving) return;
            if (tutorialBattle) {
                this.tutorialStage = 'welcome';
            }
            await app.prepareSession();
            const cloudBattle = app.battleStart;
            if (!cloudBattle) throw new Error('缺少服务端对局信息，请返回大厅重新匹配');
            const difficulty = cloudBattle.difficulty;
            if (!difficulty) throw new Error('服务端对局难度缺失');
            this.battleDifficulty = Object.freeze({
                name: difficulty.name,
                enemy_hero_level: difficulty.enemyHeroLevel,
                aim_error_deg: difficulty.aimErrorDeg,
                power_error_ratio: difficulty.powerErrorRatio,
                bonus_zone_weight: difficulty.bonusZoneWeight,
                displace_enemy_weight: difficulty.displaceEnemyWeight,
            });
            const match = app.battleMatch ?? (app.battleMatch = createBattleMatch(Math.random, Date.now(), app.profile));
            if (tutorialBattle) match.red = { nickname: '新手训练师', avatar: 1 };
            const mapDefinition = battleMapById(tutorialBattle ? 'map_1_1' : cloudBattle.map.mapId);
            const [mapPrefab, highlightEffect] = await Promise.all([
                resources.load(mapDefinition.bundle, mapDefinition.path, Prefab, undefined, 'critical'),
                resources.load(BUNDLES.battle, 'materials/buffer-highlight', EffectAsset, undefined, 'normal'),
            ]);
            if (!isValid(this, true) || this.leaving) return;
            const mapRoot = this.world.installMap(mapPrefab as Prefab);
            const mapZones = mapRoot.getChildByName('ZoneLayer');
            if (!mapZones) throw new Error(`${mapDefinition.id} requires ZoneLayer`);
            this.mapView.bind(mapDefinition.id, mapZones, highlightEffect as EffectAsset);
            // Fixed map prefabs are the visual and gameplay source of truth.
            this.mapView.randomizeZones = false;
            this.mapView.layoutSeed = 0;
            this.session.mapId = mapDefinition.id;
            // Finish the map before the first render, including while troop assets are loading.
            this.session.zones = this.mapView.layout(this.board);
            this.session.obstacles = this.mapView.obstacles;
            this.initialMapReady = true;
            // Keep the tutorial map visible while the remaining battle assets load and
            // VS plays, so the transition never falls back to the canvas clear color.
            if (tutorialBattle) {
                this.camera?.frame('overview', 0);
                this.world.camera.enabled = true;
            }
            const matchAnimation = resources.load(BUNDLES.battleUi, MATCH_SPINE_PATH, sp.SkeletonData, undefined, 'normal');
            const [matchPrefab, avatars, tutorialVsPrefab] = await Promise.all([
                tutorialBattle ? Promise.resolve(null) :
                    resources.load(BUNDLES.battleUi, 'prefabs/MatchView', Prefab, undefined, 'critical'),
                loadPlayerAvatars(resources, 'critical'),
                tutorialBattle ?
                    resources.load(BUNDLES.battleUi, 'prefabs/VSView', Prefab, undefined, 'critical') :
                    Promise.resolve(null),
            ]);
            if (!isValid(this, true) || this.leaving) return;
            this.match = match; this.avatars = avatars as SpriteFrame[];
            let matchNode: Node | null = null;
            if (matchPrefab) {
                matchNode = instantiate(matchPrefab); this.setUILayer(matchNode); this.node.addChild(matchNode);
                this.matching = matchNode.getComponent(MatchView)!;
                this.matching.initialize(match, this.avatars as SpriteFrame[], () => { void this.returnHome(); });
                // Defer battle input until both real assets and the transition animation are ready.
                void matchAnimation.then(data => { if (isValid(this.matching, true)) this.matching!.animate(data); }).catch(() => {});
            }
            let earlyVsNode: Node | null = null;
            let earlyVsPlayback: Promise<void> | null = null;
            if (tutorialBattle) {
                if (!tutorialVsPrefab) throw new Error('Tutorial requires battle_ui_bundle/prefabs/VSView');
                const animation = await matchAnimation;
                if (!isValid(this, true) || this.leaving) return;
                earlyVsNode = instantiate(tutorialVsPrefab); this.setUILayer(earlyVsNode); this.node.addChild(earlyVsNode);
                const vs = earlyVsNode.getComponent(VSView);
                if (!vs) throw new Error('VSView requires VSView component');
                earlyVsPlayback = vs.play(match, this.avatars as SpriteFrame[], animation);
                // The remaining battle resources load while the VS animation covers the transition.
                void earlyVsPlayback.catch(() => {});
                StartupTrace.mark('tutorial-vs-visible');
                console.info(`[Battle] tutorial VS visible (${Math.round(this.clock() - this.metricsStartedAt)}ms), loading battle assets in parallel`);
            }
            let gmPrefab: Prefab | null = null, pausePrefab: Prefab, handPrefab: Prefab, cardPrefab: Prefab, settlementPrefab: Prefab;
            let roundSettlementPrefab: Prefab, vsPrefab: Prefab | null, arrowPrefab: Prefab;
            let blueLine: SpriteFrame, redLine: SpriteFrame;
            let settlementData: sp.SkeletonData, victoryArt: SpriteFrame, failureArt: SpriteFrame;
            [this.tokenPrefab, this.unitPrefab, handPrefab, cardPrefab, settlementPrefab, roundSettlementPrefab, vsPrefab, arrowPrefab, blueLine, redLine,
                settlementData, victoryArt, failureArt, gmPrefab, pausePrefab] = await Promise.all([
                resources.load(BUNDLES.battle, 'prefabs/HeroToken', Prefab, undefined, 'critical'),
                resources.load(BUNDLES.battle, 'prefabs/Unit', Prefab, undefined, 'critical'),
                resources.load(BUNDLES.battleUi, 'prefabs/BattleHand', Prefab, undefined, 'normal'),
                resources.load(BUNDLES.battleUi, 'prefabs/BattleCard', Prefab, undefined, 'normal'),
                resources.load(BUNDLES.battleUi, 'prefabs/BattleSettlement', Prefab, undefined, 'normal'),
                resources.load(BUNDLES.battleUi, 'prefabs/RoundSettlement', Prefab, undefined, 'normal'),
                tutorialBattle ? Promise.resolve(null) :
                    resources.load(BUNDLES.battleUi, 'prefabs/VSView', Prefab, undefined, 'normal'),
                resources.load(BUNDLES.battle, 'prefabs/ArrowProjectile', Prefab, undefined, 'normal'),
                resources.load(BUNDLES.battleUi, 'textures/ui/blue_line/spriteFrame', SpriteFrame, undefined, 'normal'),
                resources.load(BUNDLES.battleUi, 'textures/ui/red_line/spriteFrame', SpriteFrame, undefined, 'normal'),
                resources.load(BUNDLES.battleUi, SETTLEMENT_SPINE_PATH, sp.SkeletonData, undefined, 'normal'),
                resources.load(BUNDLES.combatContent, SETTLEMENT_ART_PATHS.victory, SpriteFrame, undefined, 'normal'),
                resources.load(BUNDLES.combatContent, SETTLEMENT_ART_PATHS.failure, SpriteFrame, undefined, 'normal'),
                GM_VISIBLE ? resources.load(BUNDLES.battleUi, 'prefabs/BattleGM', Prefab, undefined, 'background') : Promise.resolve(null),
                resources.load(BUNDLES.battleUi, 'prefabs/BattlePause', Prefab, undefined, 'normal'),
            ]);
            if (!isValid(this, true) || this.leaving) return;
            this.aimGuide = new AimGuideView(this.world.aim, blueLine, redLine);
            const lineup = tutorialBattle ? STARTER_LINEUP :
                app.heroes.snapshot().lineup.filter((id): id is HeroId => !!id);
            const heroIds = Array.from(new Set<HeroId>([...lineup, ...STARTER_LINEUP]));
            const icons: Partial<Record<HeroId, SpriteFrame>> = {};
            await Promise.all([this.troopAssets.load(resources, heroIds), ...heroIds.map(async id => {
                if (HERO_ICON_PATHS[id]) icons[id] = await resources.load(BUNDLES.heroes, HERO_ICON_PATHS[id]!, SpriteFrame, undefined, 'normal');
            })]);
            const frameIndices: readonly HeroCardFrameIndex[] = [1, 2, 3];
            const loadedFrames = await Promise.all(frameIndices.map(frame => loadHeroCardFrame(resources, frame)));
            if (!isValid(this, true) || this.leaving) return;
            const cardFrames: BattleCardFrames = { 1: loadedFrames[0], 2: loadedFrames[1], 3: loadedFrames[2] };
            this.world.slingshot(0).bind(this.troopAssets.launchers[0]);
            this.world.slingshot(1).bind(this.troopAssets.launchers[1]);
            this.arrows = new ArrowProjectiles(this.world.effects, arrowPrefab, this.troopAssets);
            this.deploymentFx = new DeploymentEffects(this.world.effects, this.troopAssets);
            this.hud.initialize(match, () => this.battlePause?.show(), winner => this.forceRoundWinner(winner));
            const hud = this.hud.node;
            const handRoot = instantiate(handPrefab); this.setUILayer(handRoot); hud.addChild(handRoot);
            this.hand = handRoot.getComponent(BattleHandPanel) ?? undefined;
            if (!this.hand) throw new Error('BattleHand requires BattleHandPanel');
            this.hand.initialize(hero => this.selectHero(hero), cardPrefab, icons, cardFrames);
            const roundSettlementRoot = instantiate(roundSettlementPrefab);
            this.setUILayer(roundSettlementRoot); hud.addChild(roundSettlementRoot);
            this.roundSettlement = roundSettlementRoot.getComponent(RoundSettlementView) ?? roundSettlementRoot.addComponent(RoundSettlementView);
            this.roundSettlement.initialize();
            const settlementRoot = instantiate(settlementPrefab); this.setUILayer(settlementRoot); hud.addChild(settlementRoot); settlementRoot.active = false;
            this.settlement = settlementRoot.getComponent(BattleSettlementView) ?? undefined;
            if (!this.settlement) throw new Error('BattleSettlement requires BattleSettlementView');
            this.settlement.initialize(settlementData, victoryArt, failureArt);
            const pauseRoot = instantiate(pausePrefab); this.setUILayer(pauseRoot); hud.addChild(pauseRoot);
            this.battlePause = pauseRoot.getComponent(BattlePauseView) ?? pauseRoot.addComponent(BattlePauseView);
            this.battlePause.initialize(() => { this.battlePause?.hide(); void this.returnHome(); });
            if (!isValid(this, true) || this.leaving) return;
            this.throwInput = new ThrowInput(this.board,
                p => this.session.phase === 'ready' && this.session.pending && distance(p, this.session.pending.node.position) < 74
                    ? { x: this.session.pending.node.position.x, y: this.session.pending.node.position.y } : null,
                (dx, dy) => this.aim(dx, dy), (dx, dy) => this.release(dx, dy), () => this.clearAim(), this.camera.camera, this.node);
            game.on(Game.EVENT_HIDE, this.onHide, this); game.on(Game.EVENT_SHOW, this.onShow, this);
            if (GM_VISIBLE && gmPrefab) {
                const gmRoot = instantiate(gmPrefab); hud.addChild(gmRoot);
                this.gm = gmRoot.getComponent(BattleGMPanel) ?? undefined;
                if (!this.gm) throw new Error('BattleGM requires BattleGMPanel');
                const tuningStore = MatchController.tuningStore;
                if (!tuningStore) throw new Error('Battle tuning store unavailable');
                this.gm.initialize(tuningStore, open => {
                    this.throwInput?.cancel();
                    PhysicsSystem2D.instance.enable = !open && !this.paused && !this.leaving;
                    this.syncVisualSpeed(open);
                }, () => this.applyBattleTuning());
            }
            if (!GM_VISIBLE) {
                const debugButton = hud.getChildByName('OpenHeroBattleGM');
                if (debugButton) debugButton.active = false;
            }
            let vsNode = earlyVsNode;
            let vsPlayback = earlyVsPlayback;
            if (tutorialBattle) {
                if (!vsNode || !vsPlayback) throw new Error('Tutorial VS transition was not started');
            } else {
                const animation = await matchAnimation;
                this.matching!.progress(1);
                const searchWait = matchSearchWait(match.startedAt);
                if (searchWait > 0) await new Promise<void>(resolve => this.scheduleOnce(resolve, searchWait));
                if (!isValid(this, true) || this.leaving) return;
                this.matching!.lockOpponent();
                await new Promise<void>(resolve => this.scheduleOnce(resolve, MATCH_TIMING.lock));
                if (!isValid(this, true) || this.leaving) return;
                if (!vsPrefab) throw new Error('Battle requires battle_ui_bundle/prefabs/VSView');
                vsNode = instantiate(vsPrefab); this.setUILayer(vsNode); this.node.addChild(vsNode);
                this.matchStage = 'vs';
                const vs = vsNode.getComponent(VSView);
                if (!vs) throw new Error('VSView requires VSView component');
                vsPlayback = vs.play(match, avatars as SpriteFrame[], animation);
            }
            if (matchNode) matchNode.active = false;
            await vsPlayback;
            if (!isValid(this, true) || this.leaving) return;
            vsNode.destroy(); matchNode?.destroy(); this.matching = undefined;
            this.matchStage = 'battle'; this.hud.node.active = true; this.world.camera.enabled = true;
            this.loaded = true;
            this.series.setWinsRequired(2);
            this.reset('battle');
            if (tutorialBattle) {
                this.hud.hideRoundTurn();
                if (this.tutorialStage === 'welcome') this.tutorialGuide?.showWelcome();
                else if (this.tutorialStage === 'select') this.tutorialGuide?.showSelectHero();
            }
            this.interactiveAt = this.clock();
            StartupTrace.mark('battle-interactive');
            if (tutorialBattle) {
                console.info(`[Battle] tutorial interactive (${Math.round(this.clock() - this.metricsStartedAt)}ms), starting silent content prewarm`);
                RemoteContentPrewarm.start(app);
            }
            // An explicit inspection surface for automated acceptance; it invokes the same gameplay paths.
            if (DEBUG) {
                (globalThis as any).__runePrototype = {
                    snapshot: () => this.getSnapshot(), metrics: () => this.getMetrics(), reset: (mode: Mode) => this.reset(mode),
                    aim: (dx: number, dy: number) => this.aim(dx, dy), clearAim: () => this.clearAim(),
                    shoot: (dx: number, dy: number) => this.release(dx, dy),
                    select: (hero: HeroId) => this.selectHero(hero),
                    forceWin: (team: Team) => this.forceRoundWinner(team),
                    returnHome: () => { void this.returnHome(); },
                };
                console.info('[Battle] ready: Box2D, 750×1334', JSON.stringify(this.getMetrics()));
            }
        } catch (error) {
            if (!isValid(this, true) || this.leaving) return;
            this.troopAssets.destroy();
            console.error('[Prototype] startup failed', error);
            this.matching?.fail(error);
            if (this.hud) { this.hud.initialize(GameApp.instance.battleMatch ?? createBattleMatch(), () => { void this.returnHome(); }); this.hud.node.active = true; this.label('status', `启动失败：${String(error)}`); }
        }
    }

    private async loadTutorialGuide(resources: ResourceScope): Promise<void> {
        const app = GameApp.instance;
        if (!app.isTutorialBattle || this.tutorialGuide) return;
        const [guidePrefab, maskPrefab, fingerGuidePrefab, fingerData] = await Promise.all([
            resources.load(BUNDLES.tutorial, 'prefabs/guide/NewbieGuide', Prefab, undefined, 'critical'),
            resources.load(BUNDLES.tutorial, 'prefabs/guide/MaskLayer', Prefab, undefined, 'critical'),
            resources.load(BUNDLES.tutorial, 'prefabs/guide/FingerGuide', Prefab, undefined, 'critical'),
            resources.load(BUNDLES.tutorial, 'animations/finger/nu_lanaaa', sp.SkeletonData, undefined, 'critical'),
        ]);
        if (!isValid(this, true) || this.leaving) return;
        const mask = instantiate(maskPrefab);
        this.setUILayer(mask);
        this.node.addChild(mask);
        const selectionGuide = instantiate(fingerGuidePrefab);
        this.setUILayer(selectionGuide);
        this.node.addChild(selectionGuide);
        const guide = instantiate(guidePrefab);
        this.setUILayer(guide);
        this.node.addChild(guide);
        const view = guide.addComponent(NewbieGuideView);
        view.initialize(mask, selectionGuide, fingerData, () => {
            if (this.tutorialStage !== 'welcome' || !isValid(this, true)) return;
            this.tutorialStage = 'select';
            this.tutorialGuide?.hideGuide();
            if (this.loaded) this.tutorialGuide?.showSelectHero();
        });
        this.tutorialGuide = view;
    }

    private beginTutorialShoot(): void {
        if (this.tutorialStage !== 'select' || !this.tutorialGuide) return;
        this.tutorialStage = 'shoot-prompt';
        this.tutorialGuide.hideSelectionGuide();
        this.mapView?.setTutorialPulse(true);
        this.scheduleOnce(() => this.mapView?.setTutorialPulse(false), 1);
        this.tutorialGuide.showShootPrompt(() => {
            if (this.tutorialStage !== 'shoot-prompt' || !isValid(this, true)) return;
            this.tutorialStage = 'shoot';
            this.tutorialGuide?.showShootGuide(this.sling().node.worldPosition);
        });
    }

    private finishTutorialGuide(): void {
        if (this.tutorialStage === 'done' || this.tutorialStage === 'none') return;
        this.tutorialStage = 'done';
        this.tutorialGuide?.hideGuide();
    }

    private label(key: string, text: string): void {
        // Status/guide remain semantic state for diagnostics; the authored HUD owns presentation.
        if (key === 'status') this.hud.status(text);
    }

    reset(mode: Mode = this.session.mode, preserveSeries = false): void {
        if (!this.loaded || this.leaving || mode !== 'battle') return;
        this.unschedule(this.beginNextRound);
        this.roundPresentationSerial++;
        const tutorialBattle = GameApp.instance.isTutorialBattle;
        if (!preserveSeries) {
            this.series.reset(tutorialBattle ? 0 : Math.random() < .5 ? 0 : 1);
            this.seriesFinalized = false;
        }
        const startingTeam = this.series.startingTeam;
        this.revision++; this.throwInput?.cancel(); this.camera?.frame('overview', 0);
        for (const token of this.session.tokens) { token.body.enabled = false; token.getComponent(Collider2D)!.enabled = false; token.node.destroy(); }
        this.session.tokens = []; this.session.pending = null;
        for (const view of this.views.values()) view.node.destroy();
        this.arrows?.clear();
        this.deploymentFx?.clear();
        this.combatRunner.simulationMs = 0; this.combatRunner.droppedSeconds = 0;
        PhysicsSystem2D.instance.enable = !this.paused && !this.gmVisible;
        this.views.clear(); this.model = null; this.effects = []; this.hadEffects = false; this.hudElapsed = 0;
        this.mapView?.clearHighlights();
        this.world.effectsGraphics.clear(); if (this.settlement) this.settlement.node.active = false;
        if (this.roundSettlement && isValid(this.roundSettlement, true)) this.roundSettlement.hide();
        const profile = GameApp.instance.heroes.snapshot();
        if (!this.battleDifficulty) {
            this.failRoundTransition(new Error('对局难度配置未初始化'));
            return;
        }
        this.enemyAI = this.battleDifficulty;
        this.levels = {};
        for (const id of HERO_IDS) this.levels[id] = tutorialBattle ? 1 : profile.heroes[id].level;
        const lineup = tutorialBattle ? STARTER_LINEUP : profile.lineup;
        this.session.budget = new DeploymentBudget(lineup, STARTER_LINEUP);
        this.session.mode = mode; this.session.turn = startingTeam; this.session.phase = 'overview'; this.session.timer = 0;
        this.session.quiet = 0; this.combatRunner.accumulator = 0; this.serial = 0; this.collisions = 0; this.wallHits = 0;
        this.session.latestOutcome = ''; this.session.lastShot = null; this.session.selected = null; this.session.lastBotPlan = null;
        // Reuse the first prepared map; random layouts must not roll again after async loading.
        if (this.mapView && !this.initialMapReady) this.session.zones = this.mapView.layout(this.board);
        this.initialMapReady = false;
        this.hud.setSeriesLives(this.series.lives);
        this.hud.showRound(this.series.currentRound, startingTeam);
        this.refreshHud();
        this.syncVisualSpeed();
    }

    private spawnToken(team: Team, hero: HeroId, point: Point, live: boolean): TokenBody {
        const node = instantiate(this.tokenPrefab);
        // Configure before activation: a waiting pouch token must never create then remove
        // Box2D fixtures in the same frame while broadphase pairs still reference them.
        node.active = false;
        this.setWorldLayer(node);
        node.name = `Token_${++this.serial}_${team}_${hero}`;
        node.setPosition(point.x, point.y); (live ? this.tokenRoot : this.launchRoot).addChild(node);
        const token = node.getComponent(TokenBody)!;
        token.zones = this.session.zones;
        token.level = team === 0 ? this.levels[hero] ?? 1 : this.enemyAI?.enemy_hero_level ?? 1;
        token.configure(this.serial, team, hero, live, this.troopAssets);
        if (!live) token.setMountAngle(team === 0 ? 0 : 180);
        token.getComponent(Collider2D)!.on(Contact2DType.BEGIN_CONTACT, this.onContact, this);
        token.getComponent(Collider2D)!.on(Contact2DType.PRE_SOLVE, this.onPreSolve, this);
        node.active = true;
        this.session.tokens.push(token); return token;
    }

    private setUILayer(node: Node): void {
        node.layer = 1 << 25; node.children.forEach(child => this.setUILayer(child));
    }
    private setWorldLayer(node: Node): void {
        node.layer = this.board.layer; for (const child of node.children) this.setWorldLayer(child);
    }
    private configureBoard(): void {
        const rails = {} as Record<'left' | 'right' | 'top' | 'bottom', RailRect>;
        for (const [key, name] of [['left', 'RailLeft'], ['right', 'RailRight'], ['top', 'RailTop'], ['bottom', 'RailBottom']] as const) {
            const node = this.board.getChildByName(name);
            const collider = node?.getComponent(BoxCollider2D);
            if (!node || !collider) throw new Error(`Arena wall missing: ${name}`);
            if (!node.activeInHierarchy || !collider.enabledInHierarchy || Math.abs(node.angle % 360) > .001 || node.scale.x <= 0 || node.scale.y <= 0)
                throw new Error(`Arena wall must be active and axis aligned: ${name}`);
            rails[key] = { x: node.position.x + collider.offset.x * node.scale.x,
                y: node.position.y + collider.offset.y * node.scale.y,
                width: collider.size.width * node.scale.x, height: collider.size.height * node.scale.y };
            if (collider.restitution !== RULES.wallRestitution) {
                collider.restitution = RULES.wallRestitution; collider.apply();
            }
        }
        configureArenaFromRails(rails);
    }
    private applyBattleTuning(physicsChanged = true): void {
        // Includes inactive card slots and pooled lab units, without restarting their animations.
        for (const visual of this.world.node.getComponentsInChildren(TroopSpineView)) visual.applyDisplayScale();
        this.model?.setArrowFlightMultiplier(currentTuning().arrowFlightMultiplier);
        if (!physicsChanged) return;
        // The GM modal pauses physics before changing fixtures and cached contact materials.
        for (const token of this.session.tokens) if (token.isValid) token.applyTuning();
        for (const collider of this.board.getComponentsInChildren(BoxCollider2D)) {
            if (collider.restitution === RULES.wallRestitution) continue;
            collider.restitution = RULES.wallRestitution; collider.apply();
        }
        if (this.session.phase === 'settling') this.session.shotDeadline = this.session.timer + shotWaitLimit(this.movingSpeedEnvelope());
        if (this.session.mode === 'battle' && this.session.turn === 1 && this.session.pending && (this.session.phase === 'ai' || this.session.phase === 'framing')) {
            this.session.lastBotPlan = this.botPlan([this.session.pending.hero]);
            this.session.timer = 0;
        }
    }
    private botPlan(available: HeroId[]): Shot & { hero: HeroId } {
        const sling = this.sling(), transform = this.board.getComponent(UITransform)!;
        try {
            return planBotShot(this.spawnPoint(), this.deployment(), available, this.session.turn, this.session.zones, {
                maxDrag: this.pullLimit(), constrain: pull => this.constrainedPull(pull.x, pull.y),
                origin: pull => {
                    if (!sling.spineDriven) { const p = this.spawnPoint(); return { x: p.x - pull.x, y: p.y - pull.y }; }
                    sling.aimPull(pull, this.pullLimit());
                    return transform.convertToNodeSpaceAR(sling.mountedWorldPosition(this.tokenMountHeight));
                },
            }, this.enemyAI, Math.random, this.session.obstacles);
        } finally { sling.reset(); }
    }
    private get tokenMountHeight(): number {
        return this.troopAssets.tokenBaseMountHeight(this.session.turn) * TokenBody.boardScale;
    }
    private spawnPoint(): Point {
        return this.board.getComponent(UITransform)!.convertToNodeSpaceAR(this.sling().mountedWorldPosition(this.tokenMountHeight, true));
    }
    private sling(): SlingshotView { return this.world.slingshot(this.session.turn); }
    private pullLimit(): number { return Math.min(RULES.maxDrag, this.sling().getComponent(UITransform)!.height); }
    private constrainedPull(dx: number, dy: number): Point {
        return clampedPull(dx, dy, this.session.turn, this.pullLimit(), this.sling().getComponent(UITransform)!.width / 2);
    }
    private pullToken(dx: number, dy: number): Point {
        const pull = this.constrainedPull(dx, dy);
        if (!this.session.pending) return pull;
        if (this.sling().spineDriven) {
            const world = this.sling().aimPull(pull, this.pullLimit());
            const transform = this.board.getComponent(UITransform)!;
            const socket = transform.convertToNodeSpaceAR(world);
            const point = transform.convertToNodeSpaceAR(this.sling().mountedWorldPosition(this.tokenMountHeight));
            this.session.pending.node.setPosition(point.x, point.y);
            this.session.pending.setMountAngle(Math.atan2(socket.x - point.x, point.y - socket.y) * 180 / Math.PI);
            return pull;
        }
        const anchor = this.spawnPoint();
        this.session.pending.node.setPosition(anchor.x - pull.x, anchor.y - pull.y);
        const world = this.board.getComponent(UITransform)!.convertToWorldSpaceAR(new Vec3(anchor.x - pull.x, anchor.y - pull.y - this.tokenMountHeight * (this.session.turn === 0 ? 1 : -1)));
        this.sling().pull(this.sling().getComponent(UITransform)!.convertToNodeSpaceAR(world));
        return pull;
    }

    private prepareTurn(): void { return this.deploymentFlow.prepareTurn(); }

    private availableCards(): HeroId[] { return this.deploymentFlow.availableCards(); }
    private selectHero(hero: HeroId): void {
        const selecting = this.session.phase === 'selecting';
        this.deploymentFlow.selectHero(hero);
        if (selecting && this.session.phase === 'framing') this.beginTutorialShoot();
    }
    private aim(dx: number, dy: number): void {
        if (!this.session.pending || (this.session.phase !== 'ready' && this.session.phase !== 'ai')) return;
        this.clearAim(false);
        const pull = this.pullToken(dx, dy);
        const shot = shotFromDrag(pull.x, pull.y, this.session.turn, this.pullLimit());
        if (!shot) { this.label('guide', '向己方后方拉开；左右拖拽受角度限制，短拉松开取消'); return; }
        if (!canEnterArena(this.session.pending.node.position, shot)) {
            this.label('guide', '力度不足以进入抢区，请继续拉弓；也可在碰撞 GM 调整速度或阻尼'); return;
        }
        this.power = shot.power;
        // Predict the actual collision centre. The presenter alone extends the wall contact surface.
        const path = guidePath(this.session.pending.node.position, shot, RULES.tokenRadius, 2.2, this.session.obstacles);
        this.aimGuide.show(path, this.session.turn);
        this.drawPower();
        this.label('guide', `力度 ${Math.round(shot.power * 100)}% · 轨迹带包含障碍物与边墙反弹`);
    }
    private clearAim(resetPouch = true): void {
        if (!this.world) return;
        if (resetPouch && this.session.pending) {
            const p = this.spawnPoint(); this.session.pending.node.setPosition(p.x, p.y);
            this.session.pending.setMountAngle(this.session.turn === 0 ? 0 : 180);
        }
        if (resetPouch) this.sling().reset();
        this.aimGuide?.clear(); this.power = 0; this.drawPower();
    }
    private drawPower(): void {
        // The authored HUD has no separate power bar; aim length already conveys pull strength.
    }

    private release(dx: number, dy: number): void {
        if (this.session.phase !== 'ready' || !this.session.pending || this.paused || this.gmVisible) return;
        const pull = this.pullToken(dx, dy);
        const shot = shotFromDrag(pull.x, pull.y, this.session.turn, this.pullLimit());
        if (shot && !canEnterArena(this.session.pending.node.position, shot)) {
            this.clearAim(); this.label('guide', '力度不足以入场，已取消；当前卡牌保留，请继续拉弓'); return;
        }
        this.clearAim(!shot);
        if (!shot) { this.label('guide', '已取消 · 按住 Token，向后拖拽发射'); return; }
        this.fire(shot);
    }
    private fire(shot: Shot): void { return this.deploymentFlow.fire(shot); }

    private onContact(self: Collider2D, other: Collider2D, contact: IPhysics2DContact | null): void {
        const mine = self.getComponent(TokenBody), theirs = other.getComponent(TokenBody);
        // A token pair emits twice; count it once using stable match IDs.
        if (!mine || (theirs && mine.id >= theirs.id)) return;
        if (theirs) this.collisions++;
        else this.wallHits++;
        if (this.session.phase !== 'settling' || !this.deploymentFx) return;
        const point = contact?.getWorldManifold().points[0];
        if (!point) return;
        const root = this.world.effects.getComponent(UITransform)!;
        const local = root.convertToNodeSpaceAR(new Vec3(point.x, point.y, 0));
        this.deploymentFx.collision(local);
    }
    private onPreSolve(_self: Collider2D, other: Collider2D, contact: IPhysics2DContact | null): void {
        // Override Box2D's max(materialA, materialB): each GM slider owns its collision type.
        contact?.setRestitution(other.getComponent(TokenBody) ? RULES.restitution : RULES.wallRestitution);
    }
    private deployment(): Deployment[] { return this.session.tokens.filter(t => t.launched && t.enteredArena).map(t => t.snapshot()); }

    private updateTokenIngress(): void {
        // Only switch collision filtering after the entire body enters; its render parent is already final.
        for (const token of this.session.tokens) token.updateIngress();
    }

    update(rawDt: number): void {
        if (!this.loaded) return;
        if (this.paused || this.gmVisible) return;
        this.sampleFrame(rawDt);
        const dt = Math.min(rawDt, 0.1);
        if (this.session.phase === 'result') {
            this.drawEffects(dt);
            return;
        }
        this.deploymentFx?.step(dt);
        this.sling().stepRecoil?.(dt);
        this.camera?.update(dt);
        const deploying = this.deploymentFlow.update(dt);
        const deploymentHighlights = deploying && this.session.phase !== 'combat' &&
            this.session.phase !== 'finishing';
        if (deploymentHighlights) this.mapView?.updateHighlights(this.session.tokens, dt);
        else this.mapView?.clearHighlights();
        if (!deploying && this.session.phase === 'combat') {
            const finishing = this.combatRunner.advance(this.model!, dt, this.fast, false, (events, elapsed) => {
                this.arrows?.impact(events, elapsed);
                for (const event of events) if (event.phase === 'impact') this.effects.push({ ...event, life: .18 });
            });
            if (finishing) { this.session.phase = 'finishing'; this.session.timer = 0; }
            this.syncCombatViews(this.model!.elapsed, dt);
        } else if (this.session.phase === 'finishing') {
            const finished = this.combatRunner.finish(dt, this.fast, this.troopAssets.deathDuration);
            this.session.timer = this.combatRunner.finishingTime;
            this.syncCombatViews(this.model!.elapsed + this.session.timer, dt);
            if (finished) this.finishCombat();
        }
        this.drawEffects(dt);
        this.hudElapsed += dt;
        if (this.hudElapsed >= 0.1) {
            this.hudElapsed = 0;
            if (this.model) this.refreshCombatHud();
            else this.refreshScore();
        }
    }

    private syncCombatViews(elapsed: number, dt: number): void {
        const speed = this.fast ? 2 : 1, model = this.model!;
        for (const unit of model.units) this.views.get(unit.id)!.sync(unit, speed, elapsed);
        this.arrows?.sync(model.projectiles, model.elapsed, speed);
        this.depthSortElapsed += dt;
        if (this.depthSortElapsed < MatchController.DEPTH_SORT_INTERVAL) return;
        this.depthSortElapsed = 0;
        UnitView.sortByDepth(this.views.values(), false, this.depthScratch);
    }

    private movingSpeedEnvelope(): number { return this.deploymentFlow.movingSpeedEnvelope(); }

    private finishShot(): void { return this.deploymentFlow.finishShot(); }

    private beginCombat(): void {
        this.clearAim(); this.mapView?.clearHighlights(); this.camera?.frame('combat');
        const data = this.deployment(); this.model = new CombatModel(data, this.session.zones, {
            config: createBattleConfig(this.session.zones),
            obstacles: this.session.obstacles,
        });
        this.combatRunner.reset(this.model.configuration.rules);
        for (const token of this.session.tokens) token.beginCombat();
        for (const unit of this.model.units) {
            const node = instantiate(this.unitPrefab); this.setWorldLayer(node); this.unitRoot.addChild(node);
            const view = node.getComponent(UnitView)!; view.configure(unit, this.troopAssets); this.views.set(unit.id, view);
        }
        this.depthSortElapsed = 0;
        UnitView.sortByDepth(this.views.values(), false, this.depthScratch);
        this.session.phase = 'combat'; this.combatRunner.accumulator = 0;
        this.syncVisualSpeed();
        this.label('status', '自动战斗 · 落点决定站位，增益增加兵数');
        this.label('guide', '近战接敌 / 弓兵抛射');
        this.refreshHud();
    }

    private refreshCombatHud(): void {
        if (!this.model) return;
        const summary = this.model.summary();
        this.hud.status(`自动战斗  ${summary.count[0]} : ${summary.count[1]}  ·  ${Math.max(0, Math.ceil(this.model.configuration.rules.combatSeconds - this.model.elapsed))}s`);
    }
    private finishCombat(): void {
        this.resolveRound(this.model!.winner!);
    }

    private forceRoundWinner(winner: Team): void {
        if (!this.loaded || this.leaving || this.session.phase === 'result') return;
        this.resolveRound(winner);
    }

    private resolveRound(roundWinner: Team | 'draw'): void {
        if (this.session.phase === 'result' || this.leaving) return;
        this.session.phase = 'result'; this.hand!.node.active = false;
        this.gm?.setVisible(false); if (this.gm) this.gm.node.active = false;
        this.throwInput?.cancel(); PhysicsSystem2D.instance.enable = false;
        const resolution = this.series.record(roundWinner);
        const summary = this.model?.summary() ?? { count: [0, 0], hp: [0, 0] };
        this.hud.turn(this.session.turn, false);
        this.hud.setSeriesLives(livesBeforeRound(this.series.lives, roundWinner, this.series.maxLives));
        this.hud.hideRoundTurn(true);
        // Lock movable battle elements, but leave actor animation tracks untouched.
        for (const token of this.session.tokens) token.setPlaybackScale(0);
        this.arrows?.setSpeed(0);
        this.deploymentFx?.setSpeed(0);
        this.label('status', '本局结束 · 即将进入局数结算');
        const presentation = ++this.roundPresentationSerial;
        this.scheduleOnce(() => {
            if (presentation !== this.roundPresentationSerial || !isValid(this, true) ||
                this.leaving || this.session.phase !== 'result') return;
            this.playRoundSettlement(roundWinner, resolution, summary);
        }, ROUND_SETTLEMENT_DELAY);
        if (DEBUG) {
            console.info('[Battle] round', JSON.stringify({ resolution, currentRound: this.series.currentRound,
                settlementDelay: ROUND_SETTLEMENT_DELAY }));
        }
    }

    private playRoundSettlement(roundWinner: Team | 'draw',
        resolution: ReturnType<BattleSeries['record']>,
        summary: { count: number[]; hp: number[] }): void {
        const match = this.match;
        if (!match || !this.roundSettlement) throw new Error('RoundSettlement is not initialized');
        if (DEBUG) console.info('[Battle] round-settlement-open', JSON.stringify({
            round: resolution.round, winner: roundWinner, delay: ROUND_SETTLEMENT_DELAY,
        }));
        void this.runRoundPresentation(roundWinner, resolution, summary);
    }

    private async runRoundPresentation(roundWinner: Team | 'draw',
        resolution: ReturnType<BattleSeries['record']>,
        summary: { count: number[]; hp: number[] }): Promise<void> {
        try {
            await this.roundSettlement!.play(roundWinner, this.match!, this.avatars, this.series.lives, this.series.maxLives);
        } catch (error) {
            console.error('[Battle] RoundSettlement failed', error);
            if (!isValid(this, true) || this.leaving) return;
            this.roundSettlement?.hide();
        }
        try {
            await this.completeRoundPresentation(resolution, summary);
        } catch (error) {
            this.failRoundTransition(error);
        }
    }

    private failRoundTransition(error: unknown): void {
        console.error('[Battle] round transition failed', error);
        if (!isValid(this, true) || this.leaving) return;
        this.paused = true;
        this.throwInput?.cancel();
        PhysicsSystem2D.instance.enable = false;
        this.syncVisualSpeed(true);
        this.hud.status('对局数据异常，正在返回大厅');
        this.scheduleOnce(() => {
            if (isValid(this, true) && !this.leaving) void this.returnHome();
        }, 1.2);
    }

    private async completeRoundPresentation(resolution: ReturnType<BattleSeries['record']>,
        summary: { count: number[]; hp: number[] }): Promise<void> {
        if (!isValid(this, true) || this.leaving || this.session.phase !== 'result') return;
        if (this.seriesFinalized) return;
        if (!resolution.seriesComplete) {
            this.beginNextRound();
            return;
        }
        this.seriesFinalized = true;
        const winner = resolution.seriesWinner!;
        const app = GameApp.instance;
        const reward = await app.finishMatch(winner);
        if (!isValid(this, true) || this.leaving) return;
        if (app.isTutorialBattle) {
            app.completeTutorial();
            this.tutorialStage = 'done';
            this.tutorialGuide?.hideGuide();
        }
        const detail = `系列赛 ${resolution.score[0]} : ${resolution.score[1]}\n剩余兵量 ${summary.count[0]} : ${summary.count[1]}\n${reward.ok
            ? `金币 +${reward.coins} · 星数 ${reward.starsDelta >= 0 ? '+' : ''}${reward.starsDelta} · 军功 +${reward.merit}`
            : reward.message}`;
        this.settlement!.show(winner, detail, app.profile, this.resources!, () => { void this.returnHome(); });
        void SceneFlow.instance.prepareHome().catch(error => {
            console.warn('[Battle] home preload deferred:', error);
        });
        if (app.isTutorialBattle && winner === 0 && this.tutorialGuide) {
            await this.tutorialGuide.showVictory();
            if (!isValid(this, true) || this.leaving) return;
            this.tutorialGuide.hideGuide();
        }
        if (DEBUG) {
            console.info('[Battle] result', JSON.stringify(this.getSnapshot()));
            console.info('[Battle] metrics', JSON.stringify(this.getMetrics()));
        }
    }

    private sampleFrame(rawDt: number): void {
        const frameMs = rawDt * 1000;
        if (!(frameMs > 0) || frameMs > 1000) return;
        this.lastFrameMs = frameMs;
        this.frameSamples++;
        this.averageFrameMs = this.averageFrameMs > 0 ? this.averageFrameMs * .95 + frameMs * .05 : frameMs;
        this.maxFrameMs = Math.max(this.maxFrameMs, frameMs);
    }

    getMetrics(): object {
        const now = this.clock();
        return {
            ready: this.loaded,
            loadMs: this.interactiveAt === undefined ? now - this.metricsStartedAt : this.interactiveAt - this.metricsStartedAt,
            frame: { lastMs: this.lastFrameMs, averageMs: this.averageFrameMs, maxMs: this.maxFrameMs, samples: this.frameSamples },
            simulation: { averageMs: this.combatRunner.simulationMs, droppedSeconds: this.combatRunner.droppedSeconds },
            units: this.model?.units.length ?? 0,
            views: this.views.size,
            projectiles: this.model?.projectiles.length ?? 0,
            effects: this.effects.length,
            map: {
                id: this.session.mapId,
                zones: this.session.zones.map(zone => ({ id: zone.id, bonus: zone.bonus })),
                obstacles: this.session.obstacles.length,
                obstacleColliders: this.world.mountedMap?.getComponentsInChildren(Collider2D).length ?? 0,
            },
            resources: GameApp.instance.res?.metrics() ?? null,
        };
    }

    private drawEffects(dt: number): void {
        if (this.effects.length === 0 && !this.hadEffects) return;
        const g = this.world.effectsGraphics; g.clear();
        for (const effect of this.effects) {
            effect.life -= dt;
            if (effect.life <= 0) continue;
            const color = this.effectColor.fromHEX(TEAM_COLORS[effect.team]);
            color.a = Math.round(effect.life / 0.18 * 220);
            g.strokeColor = color; g.lineWidth = effect.splash > 0 ? 3 : 2;
            g.circle(effect.to.x, effect.to.y + 20, 5 + (1 - effect.life / .18) * 9); g.stroke();
            if (effect.splash > 0) { g.circle(effect.to.x, effect.to.y, effect.splash * (1 - effect.life / 0.24)); g.stroke(); }
        }
        this.effects = this.effects.filter(e => e.life > 0);
        this.hadEffects = this.effects.length > 0;
    }

    private refreshScore(): void {}

    private refreshHud(): void {
        const deploying = ['overview', 'selecting', 'framing', 'ready', 'settling', 'ai'].includes(this.session.phase);
        this.hud.turn(this.session.turn, deploying);
        this.hand?.refresh(this.session.hand, this.levels, this.session.budget.remaining[0],
            this.session.turn === 0 && this.session.phase === 'selecting', deploying);
    }

    getSnapshot(): object {
        return { matchStage: this.matchStage, hand: this.session.hand, revision: this.revision, mode: this.session.mode, phase: this.session.phase, turn: this.session.turn, selected: this.session.selected,
            series: { round: this.series.currentRound, startingTeam: this.series.startingTeam, score: this.series.score, lives: this.series.lives, complete: this.series.complete, winner: this.series.winner },
            used: this.session.budget.used.map(h => h.slice()), actionPoints: this.session.budget.remaining.slice(), lineup: this.session.budget.lineups, pending: this.session.pending?.snapshot() ?? null,
            tokens: this.deployment().map(t => ({ ...t, bonus: bonusAt(t, this.session.zones) })), collisions: this.collisions,
            wallHits: this.wallHits, arena: { width: RULES.width, height: RULES.height, ...arenaEdges() }, camera: this.camera?.snapshot(), worldScale: this.board.scale, lastShot: this.session.lastShot, outcome: this.session.latestOutcome,
            map: { id: this.session.mapId, seed: this.mapView?.seed ?? null, zones: this.session.zones,
                highlightedZones: [...(this.mapView?.highlightedZoneIds ?? [])],
                obstacles: this.session.obstacles },
            tuning: currentTuning(), gmOpen: this.gmVisible, shotDeadline: this.session.shotDeadline,
            combat: this.model ? { projectiles: this.model.projectiles.length, units: this.model.units, elapsed: this.model.elapsed, winner: this.model.winner, ...this.model.summary() } : null };
    }

    private async returnHome(): Promise<void> {
        if (this.leaving) return;
        this.leaving = true; this.paused = true; this.throwInput?.cancel(); 
        PhysicsSystem2D.instance.enable = false;
        this.hud.status('返回主界面…');
        try {
            await SceneFlow.instance.prepareHome().catch(error => {
                console.warn('[Battle] home preload failed; using scene loading fallback:', error);
            });
            await SceneFlow.instance.enter('home', () => {});
            GameApp.instance.abandonBattle();
        }
        catch (error) {
            if (!this.isValid) return;
            this.leaving = false; this.paused = false;
            PhysicsSystem2D.instance.enable = !this.gmVisible;
            this.hud.status(`返回失败，可重试：${String(error)}`); this.syncVisualSpeed();
        }
    }

    private syncVisualSpeed(forcePause = false): void {
        const speed = forcePause || this.paused || this.gmVisible || this.session.phase === 'result' || this.session.phase === 'building' ? 0 : (this.session.phase === 'combat' || this.session.phase === 'finishing') && this.fast ? 2 : 1;
        for (const visual of this.world.node.getComponentsInChildren(TroopSpineView)) visual.setPlaybackScale(speed);
        for (const token of this.session.tokens) token.setPlaybackScale(speed);
        this.arrows?.setSpeed(speed);
        this.deploymentFx?.setSpeed(speed);
    }

    private onHide(): void {
        this.paused = true; this.throwInput?.cancel(); PhysicsSystem2D.instance.enable = false; this.syncVisualSpeed();
    }
    private onShow(): void { if (this.leaving) return; this.paused = false; this.combatRunner.accumulator = 0; PhysicsSystem2D.instance.enable = !this.gmVisible; this.syncVisualSpeed(); }
    onDestroy(): void {
        this.unschedule(this.beginNextRound);
        PhysicsSystem2D.instance.enable = false;
        if (this.previousMaxSubSteps !== undefined) PhysicsSystem2D.instance.maxSubSteps = this.previousMaxSubSteps;
        this.throwInput?.destroy();
        for (const view of [this.gm, this.hand, this.battlePause]) if (view && isValid(view, true)) view.dispose();
        this.arrows?.clear();
        this.deploymentFx?.destroy();
        this.troopAssets.destroy();
        const tutorialGuide = this.tutorialGuide;
        this.tutorialGuide = undefined;
        if (tutorialGuide && isValid(tutorialGuide, true)) tutorialGuide.dispose();
        this.resources?.dispose();
        if (this.hudCamera?.isValid) { this.hudCamera.clearFlags = this.hudClearFlags; this.hudCamera.visibility = this.hudVisibility; }
        [1, 2, 4].forEach((group, i) => {
            if (this.previousCollisionMasks.length) PhysicsSystem2D.instance.collisionMatrix[group] = this.previousCollisionMasks[i];
        });
        game.off(Game.EVENT_HIDE, this.onHide, this); game.off(Game.EVENT_SHOW, this.onShow, this);
        for (const token of this.session.tokens) if (token.isValid) {
            token.getComponent(Collider2D)?.off(Contact2DType.BEGIN_CONTACT, this.onContact, this);
            token.getComponent(Collider2D)?.off(Contact2DType.PRE_SOLVE, this.onPreSolve, this);
        }
        delete (globalThis as any).__runePrototype;
    }
}
