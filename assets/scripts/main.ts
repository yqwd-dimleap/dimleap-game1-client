import { _decorator, Component, director, Director, game, isValid, Node, PhysicsSystem2D } from 'cc';
import { SceneFlow } from './game/SceneFlow';
import { LoadingPanel } from './ui/loading/LoadingPanel';
import { GameApp } from './game/GameApp';
import { StartupTrace } from './core/StartupTrace';
import { StartupFlow } from './game/StartupFlow';
import { ToastService } from './ui/common/ToastService';
import { DEBUG } from 'cc/env';
const { ccclass } = _decorator;
@ccclass('BootController')
export class BootController extends Component {
    private loading!: LoadingPanel;
    private flow?: StartupFlow;
    private busy = false;
    private globalUI?: Node;
    start(): void {
        this.loading = this.getComponent(LoadingPanel)!;
        PhysicsSystem2D.instance.enable = false;
        game.frameRate = 30;
        if (DEBUG) (globalThis as any).__runeStartup = { snapshot: () => StartupTrace.snapshot() };
        director.once(Director.EVENT_AFTER_DRAW, this.afterFirstDraw, this);
    }
    private afterFirstDraw(): void {
        StartupTrace.mark('boot-first-draw');
        // Optional browser-preview cover; mini-game startup has no DOM.
        (globalThis as any).__dismissStartupCover?.();
        this.scheduleOnce(() => { void this.load(); }, 0);
    }
    private async load(): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.loading.begin('符石战场', () => { void this.load(); });
        try {
            const app = GameApp.instance;
            if (!this.flow) this.flow = new StartupFlow({
                initialize: async () => {
                    await app.initialize();
                    await this.installGlobalUI();
                },
                checkVersion: () => app.checkVersion(),
                preloadBootBundles: report => SceneFlow.instance.preloadBootBundles(report),
                prepareSession: () => app.prepareSession(),
                prepareTutorial: report => SceneFlow.instance.prepareTutorial(report),
                enterHome: async report => {
                    if (app.tutorial.needsTutorial()) {
                        report({ progress: 0.05, message: '准备新手对局' });
                        await app.startTutorialBattle();
                        await SceneFlow.instance.enter('battle', report);
                        return;
                    }
                    await SceneFlow.instance.enter('home', report);
                },
            });
            // runScene destroys this component before the startup promise finishes.
            await this.flow.run(state => { if (this.isValid) this.loading.setProgress(state); });
        }
        catch (error) {
            SceneFlow.instance.abandonPreparations();
            if (this.isValid) this.loading.fail(error);
        }
        finally { this.busy = false; }
    }
    private async installGlobalUI(): Promise<void> {
        if (this.globalUI?.isValid) return;
        const root = director.getScene()?.getChildByName('GlobalUI');
        if (!root) throw new Error('Boot scene requires GlobalUI prefab instance');
        this.globalUI = root;
        if (!director.isPersistRootNode(root)) director.addPersistRootNode(root);
        if (DEBUG) (globalThis as any).__runeToast = (message: string) => ToastService.show(message);
    }
    onDestroy(): void { director.off(Director.EVENT_AFTER_DRAW, this.afterFirstDraw, this); }
}
