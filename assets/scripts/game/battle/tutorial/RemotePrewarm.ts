import { BUNDLES } from '../../../core/Bundles';
import { sp } from 'cc';
import type { AssetManager } from 'cc';
import { STARTER_LINEUP } from '../../../model/hero/HeroProgress';
import type { GameApp } from '../../GameApp';
import { battleContentReferences } from '../BattleContent';

/** Warm likely next-step bundle configs and the current lineup's combat art without blocking UI. */
export class RemoteContentPrewarm {
    private static pending?: Promise<void>;
    private static readonly ready = new Set<string>();
    private static requested = false;
    private static readonly configBundles = [
        BUNDLES.heroes,
        BUNDLES.map,
        BUNDLES.combatShared,
        BUNDLES.combatHeroes,
    ];

    static startAfterHome(app: GameApp, shouldRun: () => boolean): void {
        if (this.requested) return;
        this.requested = true;
        this.run(app, 1200, shouldRun);
    }

    static start(app: GameApp, delayMs = 500, shouldRun: () => boolean = () => true): void {
        if (this.requested) return;
        this.requested = true;
        this.run(app, delayMs, shouldRun);
    }

    private static run(app: GameApp, delayMs: number, shouldRun: () => boolean): void {
        if (this.pending) return;
        const task = (async () => {
            if (delayMs > 0) await new Promise<void>(resolve => setTimeout(resolve, delayMs));
            if (!shouldRun()) return;
            console.info('[RemotePrewarm] targeted remote prewarm begin');
            await Promise.all(this.configBundles.map(async name => {
                if (this.ready.has(name)) return;
                try {
                    await app.res.bundle(name);
                    this.ready.add(name);
                    console.info(`[RemotePrewarm] remote bundle config ready: ${name}`);
                } catch (error) {
                    console.warn(`[RemotePrewarm] remote bundle config prewarm failed: ${name}`, error);
                }
            }));
            if (!shouldRun()) return;
            const lineup = app.heroes.snapshot().lineup.filter((id): id is NonNullable<typeof id> => !!id);
            const heroIds = Array.from(new Set([...lineup, ...STARTER_LINEUP]));
            const references = battleContentReferences(heroIds);
            const byBundle = new Map<string, string[]>();
            for (const reference of references) {
                const paths = byBundle.get(reference.bundle) || [];
                paths.push(reference.path);
                byBundle.set(reference.bundle, paths);
            }
            await Promise.all(Array.from(byBundle).map(async ([name, paths]) => {
                if (!shouldRun()) return;
                try {
                    const started = Date.now();
                    const bundle = await app.res.bundle(name);
                    await this.preloadPaths(bundle, paths);
                    this.ready.add(name);
                    console.info(`[RemotePrewarm] targeted combat content ready: ${name} ` +
                        `(${paths.length} assets, ${Date.now() - started}ms)`);
                } catch (error) {
                    console.warn(`[RemotePrewarm] targeted combat prewarm failed: ${name}`, error);
                }
            }));
            console.info('[RemotePrewarm] targeted remote prewarm complete');
        })();
        this.pending = task;
        const clear = (): void => { if (this.pending === task) this.pending = undefined; };
        void task.then(clear, clear);
    }

    private static preloadPaths(bundle: AssetManager.Bundle, paths: readonly string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            bundle.preload([...paths], sp.SkeletonData, error => error ? reject(error) : resolve());
        });
    }

    static resetForTesting(): void {
        this.ready.clear();
        this.pending = undefined;
        this.requested = false;
    }
}
