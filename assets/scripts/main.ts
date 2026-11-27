import { _decorator, Component, director, Director, game, isValid, Node, PhysicsSystem2D } from 'cc';
import { SceneFlow } from './game/SceneFlow';
import { LoadingPanel } from './ui/loading/LoadingPanel';
import { GameApp } from './game/GameApp';
import { StartupTrace } from './core/StartupTrace';
import { HOME_READY_EVENT, StartupFlow } from './game/StartupFlow';
import { ToastService } from './ui/common/ToastService';
import { DEBUG } from 'cc/env';
const { ccclass } = _decorator;
@ccclass('BootController')
export class BootController extends Component {
    private loading!: LoadingPanel;
    private flow?: StartupFlow;
    private busy = false;
    private globalUI?: Node;
    private homeReady?: Promise<boolean>;
    private resolveHomeReady?: (ready: boolean) => void;
    start(): void {
        this.loading = this.getComponent(LoadingPanel)!;
        PhysicsSystem2D.instance.enable = false;
        game.frameRate = 30;
        (game as any).on(HOME_READY_EVENT, this.onHomeReady, this);
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
        this.prepareHomeReadyGate();
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
                    report({ progress: 0.05, message: '加载大厅界面' });
                    await SceneFlow.instance.prepareHome();
                    report({ progress: 0.7, message: '进入大厅' });
                    await SceneFlow.instance.enter('home', state => report({
                        progress: Math.min(state.progress, .94),
                        message: state.message,
                    }));
                },
            });
            await this.flow.run(state => { if (this.isValid) this.loading.setProgress(state); });
            if (!app.tutorial.needsTutorial()) {
                this.loading.setProgress({ progress: .98, message: '显示大厅界面' });
                const ready = await this.waitForHomeReady(20);
                if (!ready) throw new Error('大厅首页未能完成初始化');
                await new Promise<void>(resolve => director.once(Director.EVENT_AFTER_DRAW, resolve));
            }
            if (!this.isValid) return;
            this.loading.setProgress({ progress: 1, message: '加载完成' });
            this.loading.hide();
            this.node.destroy();
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
        this.node.setParent(root, false);
        this.node.setPosition(0, 0, 0);
        this.node.setSiblingIndex(root.children.length - 1);
        this.setLayer(this.node, root.layer);
        if (DEBUG) (globalThis as any).__runeToast = (message: string) => ToastService.show(message);
    }
    private prepareHomeReadyGate(): void {
        this.resolveHomeReady?.(false);
        this.homeReady = new Promise(resolve => { this.resolveHomeReady = resolve; });
    }
    private onHomeReady(ready: boolean): void {
        const resolve = this.resolveHomeReady;
        this.resolveHomeReady = undefined;
        resolve?.(ready);
    }
    private waitForHomeReady(seconds: number): Promise<boolean> {
        const ready = this.homeReady;
        if (!ready) return Promise.resolve(false);
        return new Promise<boolean>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error(`大厅首页加载超时（${seconds}s）`));
            }, seconds * 1000);
            ready.then(value => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }, error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    private setLayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) this.setLayer(child, layer);
    }
    onDestroy(): void {
        director.off(Director.EVENT_AFTER_DRAW, this.afterFirstDraw, this);
        (game as any).off(HOME_READY_EVENT, this.onHomeReady, this);
        this.resolveHomeReady?.(false);
        this.resolveHomeReady = undefined;
    }
}
