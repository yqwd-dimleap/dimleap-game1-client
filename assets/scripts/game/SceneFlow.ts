import { ResourceScope } from '../core/ResourceScope';
import { BUNDLES } from '../core/Bundles';
import { assetManager, director, Prefab, SceneAsset, sp } from 'cc';
import { GameApp } from './GameApp';
import { battleContentPaths, battleMapById } from './battle/BattleContent';
export type Route = 'home' | 'battle';
import { STARTER_LINEUP } from '../model/hero/HeroProgress';
import type { LoadingState } from '../core/LoadingState';
import { DEBUG } from 'cc/env';
export type { LoadingState } from '../core/LoadingState';
const ROUTES = {
    home: { bundle: 'main', scene: 'main', prefabs: [] as string[] },
    battle: { bundle: BUNDLES.battle, scene: 'battle', prefabs: ['prefabs/HeroToken', 'prefabs/Unit'] },
};
export class SceneFlow {
    static readonly instance = new SceneFlow();
    private busy = false;
    private active?: { route: Route; scope: ResourceScope };
    /** The route owns preload and runtime references until its scene is destroyed. */
    resourcesFor(route: Route): ResourceScope {
        return this.active?.route === route ? this.active.scope : GameApp.instance.res.createScope(`scene:${route}:direct`);
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
            progress(0, '读取启动配置');
            const app = GameApp.instance; await app.initialize();
            const target = ROUTES[route];
            incoming = app.res.createScope(`scene:${route}`);
            progress(0.05, '加载场景资源');
            if (route === 'battle') {
                const paths = battleContentPaths([...app.heroes.snapshot().lineup.filter((id): id is NonNullable<typeof id> => !!id), ...STARTER_LINEUP]);
                let loaded = 0;
                if (!app.battleStart) throw new Error('缺少服务端对局信息，请重新开始战斗');
                const selectedMap = battleMapById(app.battleStart.map.mapId);
                await Promise.all([
                    ...paths.map(path => incoming!.load(BUNDLES.combatContent, path, sp.SkeletonData, undefined, 'critical').then(() => {
                        loaded++; progress(0.05 + 0.1 * loaded / paths.length, '加载首战资源');
                    })),
                    incoming.load(BUNDLES.map, selectedMap.path, Prefab, (finished, total) => {
                        progress(0.05 + 0.05 * (total ? finished / total : 0), `预加载地图 ${selectedMap.name}`);
                    }, 'critical').then(() => progress(0.10, '地图预加载完成')),
                ]);
            }
            const bundle = target.bundle === 'main' ? assetManager.getBundle('main') : await app.res.bundle(target.bundle);
            if (!bundle) throw new Error('主资源包尚未就绪');
            for (let i = 0; i < target.prefabs.length; i++) {
                await incoming.load(target.bundle, target.prefabs[i], Prefab, (finished, total) =>
                    progress(0.15 + 0.2 * (i + (total ? finished / total : 0)) / target.prefabs.length, '加载英雄与部队'), 'critical');
            }
            const scene = await new Promise<SceneAsset>((resolve, reject) => bundle.loadScene(target.scene,
                (finished, total) => progress(0.35 + 0.64 * (total ? finished / total : 0), '加载场景依赖'),
                (error, asset) => error ? reject(error) : resolve(asset)));
            incoming.retain(scene);
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
