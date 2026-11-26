import { BUNDLES } from '../../../core/Bundles';
import type { GameApp } from '../../GameApp';

/** Warm remote bundle manifests after a local tutorial has started; failures remain non-blocking. */
export class RemoteContentPrewarm {
    private static pending?: Promise<void>;
    private static complete = false;

    static start(app: GameApp): void {
        if (this.complete || this.pending) return;
        const task = (async () => {
            for (const bundle of [BUNDLES.battleUi, BUNDLES.map, BUNDLES.combatContent]) {
                try {
                    await app.res.bundle(bundle);
                    console.info(`[Tutorial] remote bundle ready: ${bundle}`);
                } catch (error) {
                    console.warn(`[Tutorial] remote prewarm deferred: ${bundle}`, error);
                }
            }
            this.complete = true;
        })();
        this.pending = task;
        const clear = (): void => { if (this.pending === task) this.pending = undefined; };
        void task.then(clear, clear);
    }

    static resetForTesting(): void {
        this.complete = false;
        this.pending = undefined;
    }
}
