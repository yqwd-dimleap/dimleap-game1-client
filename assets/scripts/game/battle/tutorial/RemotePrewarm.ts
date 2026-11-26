import { BUNDLES } from '../../../core/Bundles';
import type { AssetManager } from 'cc';
import type { GameApp } from '../../GameApp';

/** Download post-tutorial content in the background without extending the tutorial startup gate. */
export class RemoteContentPrewarm {
    private static pending?: Promise<void>;
    private static readonly ready = new Set<string>();
    private static readonly bundles = [
        BUNDLES.settings, BUNDLES.map, BUNDLES.combatContent, BUNDLES.seasonContent, BUNDLES.heroes,
    ];

    static start(app: GameApp): void {
        if (this.pending || this.bundles.every(bundle => this.ready.has(bundle))) return;
        const task = (async () => {
            await new Promise<void>(resolve => setTimeout(resolve, 300));
            console.info(`[Tutorial] remote prewarm begin: ${this.bundles.join(', ')}`);
            for (const name of this.bundles) {
                if (this.ready.has(name)) continue;
                const started = Date.now();
                try {
                    const bundle = await app.res.bundle(name);
                    await this.preloadBundle(bundle);
                    this.ready.add(name);
                    console.info(`[Tutorial] remote content ready: ${name} (${Date.now() - started}ms)`);
                } catch (error) {
                    console.warn(`[Tutorial] remote prewarm failed and will retry later: ${name}`, error);
                }
            }
            console.info('[Tutorial] remote prewarm complete');
        })();
        this.pending = task;
        const clear = (): void => { if (this.pending === task) this.pending = undefined; };
        void task.then(clear, clear);
    }

    private static preloadBundle(bundle: AssetManager.Bundle): Promise<void> {
        return new Promise((resolve, reject) => {
            bundle.preloadDir('', null, null, error => error ? reject(error) : resolve());
        });
    }

    static resetForTesting(): void {
        this.ready.clear();
        this.pending = undefined;
    }
}
