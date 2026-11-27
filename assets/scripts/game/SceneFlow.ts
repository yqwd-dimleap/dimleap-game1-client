import { ResourceScope } from '../core/ResourceScope';
import { BUNDLES } from '../core/Bundles';
import { assetManager, director, Prefab, SceneAsset, sp } from 'cc';
import { GameApp } from './GameApp';
import { battleContentReferences, battleMapById } from './battle/BattleContent';
export type Route = 'home' | 'battle';
import { STARTER_LINEUP } from '../model/hero/HeroProgress';
import type { LoadingState } from '../core/LoadingState';
import { DEBUG } from 'cc/env';
export type { LoadingState } from '../core/LoadingState';
const ROUTES = {
    home: { bundle: 'main', scene: 'main', prefabs: [] as string[] },
    battle: { bundle: BUNDLES.battleRuntime, scene: 'battle', prefabs: ['prefabs/HeroToken', 'prefabs/Unit'] },
};
export class SceneFlow {
    static readonly instance = new SceneFlow();
    private busy = false;
    private active?: { route: Route; scope: ResourceScope };
    private bootPreparation?: Promise<void>;
    private bootBundlesReady = false;
    private homePreparation?: Promise<void>;
    private preparedHome?: { scene: SceneAsset; scope: ResourceScope };
    private tutorialPreparation?: Promise<void>;
    private preparedTutorial?: { scope: ResourceScope };
    /** The route owns preload and runtime references until its scene is destroyed. */
    resourcesFor(route: Route): ResourceScope {
        return this.active?.route === route ? this.active.scope : GameApp.instance.res.createScope(`scene:${route}:direct`);
    }
    preloadBootBundles(report: (state: LoadingState) => void): Promise<void> {
        if (this.bootBundlesReady) return Promise.resolve();
        if (this.bootPreparation) return this.bootPreparation;
        const task = (async () => {
            const app = GameApp.instance;
            await app.initialize();
            // Home only requires the shared UI package. Battle runtime, including
            // onboarding resources, is loaded by the battle flow.
            const bundles = [BUNDLES.ui];
            let ready = 0;
            const started = Date.now();
            report({ progress: 0, message: '预加载启动资源' });
            console.info(`[Boot] preload begin (${bundles.length}): ${bundles.join(', ')}`);
            await Promise.all(bundles.map(async name => {
                const bundleStarted = Date.now();
                try {
                    const bundle = await app.res.bundle(name);
                    ready++;
                    const cost = Date.now() - bundleStarted;
                    console.info(`[Boot] preload success: ${name} (${cost}ms, ${ready}/${bundles.length}) base=${bundle.base}`);
                    report({ progress: ready / bundles.length, message: `预加载启动资源 ${name}` });
                } catch (error) {
                    console.error(`[Boot] preload failed: ${name}`, error);
                    throw error;
                }
            }));
            this.bootBundlesReady = true;
            console.info(`[Boot] preload complete: ${bundles.join(', ')} (${Date.now() - started}ms)`);
        })();
        this.bootPreparation = task;
        const clear = (): void => { if (this.bootPreparation === task) this.bootPreparation = undefined; };
        void task.then(clear, clear);
        return task;
    }
    prepareHome(): Promise<void> {
        if (this.preparedHome) return Promise.resolve();
        if (this.homePreparation) return this.homePreparation;
        const task = (async () => {
            const app = GameApp.instance;
            await app.initialize();
            const scope = app.res.createScope('prepare:home');
            try {
                await app.res.bundle(BUNDLES.ui);
                const bundle = assetManager.getBundle('main');
                if (!bundle) throw new Error('主资源包尚未就绪');
                const [scene] = await Promise.all([
                    app.res.loadScene('main', 'main'),
                    scope.load(BUNDLES.ui, 'prefabs/main/MainShell', Prefab, undefined, 'background'),
                    scope.load(BUNDLES.ui, 'prefabs/home/HomeView', Prefab, undefined, 'background'),
                    scope.load(BUNDLES.ui, 'prefabs/common/ModalLayer', Prefab, undefined, 'background'),
                ]);
                scope.retain(scene);
                this.preparedHome = { scene, scope };
            } catch (error) {
                scope.dispose();
                throw error;
            }
        })();
        this.homePreparation = task;
        const clear = (): void => { if (this.homePreparation === task) this.homePreparation = undefined; };
        void task.then(clear, clear);
        return task;
    }
    prepareTutorial(report: (state: LoadingState) => void): Promise<void> {
        const app = GameApp.instance;
        if (!app.tutorial.needsTutorial()) return Promise.resolve();
        if (this.preparedTutorial) return Promise.resolve();
        if (this.tutorialPreparation) return this.tutorialPreparation;
        const task = (async () => {
            await app.initialize();
            const scope = app.res.createScope('prepare:tutorial');
            const started = Date.now();
            try {
                report({ progress: 0.05, message: '加载战斗与新手引导分包' });
                await app.res.bundle(BUNDLES.battleRuntime);
                report({ progress: 0.25, message: '解析战斗与新手引导资源' });
                const loads = [
                    scope.load(BUNDLES.battleRuntime, 'prefabs/tutorial/guide/NewbieGuide', Prefab, undefined, 'critical'),
                    scope.load(BUNDLES.battleRuntime, 'prefabs/tutorial/guide/MaskLayer', Prefab, undefined, 'critical'),
                    scope.load(BUNDLES.battleRuntime, 'prefabs/tutorial/guide/FingerGuide', Prefab, undefined, 'critical'),
                    scope.load(BUNDLES.battleRuntime, 'animations/tutorial/finger/nu_lanaaa', sp.SkeletonData, undefined, 'critical'),
                    scope.load(BUNDLES.battleRuntime, 'prefabs/tutorial/map/map_1_1', Prefab, undefined, 'critical'),
                ];
                let loaded = 0;
                await Promise.all(loads.map(load => load.then(() => {
                    loaded++;
                    report({ progress: 0.25 + 0.75 * loaded / loads.length, message: '加载新手引导资源' });
                })));
                this.preparedTutorial = { scope };
                console.info(`[Boot] tutorial resources ready (${Date.now() - started}ms)`);
            } catch (error) {
                console.error('[Boot] tutorial resource preload failed', error);
                scope.dispose();
                throw error;
            }
        })();
        this.tutorialPreparation = task;
        const clear = (): void => { if (this.tutorialPreparation === task) this.tutorialPreparation = undefined; };
        void task.then(clear, clear);
        return task;
    }
    abandonPreparations(): void {
        this.preparedTutorial?.scope.dispose();
        this.preparedTutorial = undefined;
    }
    async enter(route: Route, report: (state: LoadingState) => void): Promise<void> {
        if (this.busy) throw new Error('场景正在切换，请稍候');
        this.busy = true;
        let incoming: ResourceScope | undefined;
        let previous = this.active;
        let launched = false;
        let highest = 0;
        const progress = (fraction: number, message: string): void => {
            highest = Math.max(highest, Math.min(1, fraction)); report({ progress: highest, message });
        };
        try {
            progress(0, '读取本地分包配置');
            const app = GameApp.instance; await app.initialize();
            const target = ROUTES[route];
            if (route === 'home' && this.homePreparation) {
                try { await this.homePreparation; }
                catch (error) { console.warn('[SceneFlow] home preparation failed; using fallback', error); }
            }
            const preparedHome = route === 'home' ? this.preparedHome : undefined;
            if (preparedHome) this.preparedHome = undefined;
            const preparedTutorial = route === 'battle' && app.isTutorialBattle ? this.preparedTutorial : undefined;
            if (preparedTutorial) this.preparedTutorial = undefined;
            incoming = preparedHome?.scope ?? preparedTutorial?.scope ?? app.res.createScope(`scene:${route}`);
            const requiredBundles = route === 'battle'
                ? app.isTutorialBattle ?
                    [BUNDLES.ui, BUNDLES.battleRuntime] :
                    [BUNDLES.ui, BUNDLES.battleRuntime, BUNDLES.heroes]
                : [BUNDLES.ui];
            let bundlesReady = 0;
            progress(0.03, '加载战斗依赖');
            await Promise.all(requiredBundles.map(bundle => app.res.bundle(bundle).then(() => {
                bundlesReady++;
                progress(0.03 + 0.15 * bundlesReady / requiredBundles.length, `加载战斗依赖 ${bundle}`);
            })));
            progress(0.18, '加载场景资源');
            if (route === 'battle') {
                let loaded = 0;
                if (!app.battleStart) throw new Error('缺少服务端对局信息，请重新开始战斗');
                const selectedMap = battleMapById(app.isTutorialBattle ? 'map_1_1' : app.battleStart.map.mapId);
                const lineup = app.isTutorialBattle ? STARTER_LINEUP :
                    app.heroes.snapshot().lineup.filter((id): id is NonNullable<typeof id> => !!id);
                const references = app.isTutorialBattle ? [] : battleContentReferences([...lineup, ...STARTER_LINEUP]);
                await Promise.all([
                    ...references.map(reference => incoming!.load(reference.bundle, reference.path, sp.SkeletonData, undefined, 'critical').then(() => {
                        loaded++; progress(0.18 + 0.1 * loaded / references.length, '加载首战资源');
                    })),
                    incoming.load(selectedMap.bundle, selectedMap.path, Prefab, (finished, total) => {
                        progress(0.18 + 0.14 * (total ? finished / total : 0), `预加载地图 ${selectedMap.name}`);
                    }, 'critical').then(() => progress(0.32, '地图预加载完成')),
                ]);
            }
            for (let i = 0; i < target.prefabs.length; i++) {
                await incoming.load(target.bundle, target.prefabs[i], Prefab, (finished, total) =>
                    progress(0.32 + 0.2 * (i + (total ? finished / total : 0)) / target.prefabs.length, '加载英雄与部队'), 'critical');
            }
            progress(0.52, '加载战斗场景');
            const scene = preparedHome?.scene ?? await app.res.loadScene(target.bundle, target.scene,
                (finished, total) => progress(0.52 + 0.47 * (total ? finished / total : 0), '加载场景依赖'));
            if (!preparedHome) incoming.retain(scene);
            progress(1, '加载完成');
            this.active = { route, scope: incoming };
            // Clear the lock before the next scene starts, so its own navigation is immediately available.
            await new Promise<void>((resolve, reject) => {
                director.runScene(scene, undefined, error => {
                    this.busy = false;
                    if (error) reject(error); else {
                        launched = true; previous?.scope.dispose();
                        if (DEBUG) console.info(`[SceneFlow] entered ${route}`);
                        resolve();
                    }
                });
            });
        } finally {
            if (!launched) {
                if (this.active?.scope === incoming) this.active = previous;
                incoming?.dispose();
            }
            this.busy = false;
        }
    }
}
