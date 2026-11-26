import { BUNDLES } from '../../../core/Bundles';
import type { GameApp } from '../../GameApp';

/** Warm only remote manifests needed after the local tutorial; failures remain retryable. */
export class RemoteContentPrewarm {
    private static pending?: Promise<void>;
    private static readonly ready = new Set<string>();

    static start(app: GameApp): void {
        const bundles = [BUNDLES.battleUi, BUNDLES.combatContent];
        if (this.pending || bundles.every(bundle => this.ready.has(bundle))) return;
        const task = (async () => {
            await new Promise<void>(resolve => setTimeout(resolve, 300));
            for (const bundle of bundles) {
                if (this.ready.has(bundle)) continue;
                try {
                    await app.res.bundle(bundle);
                    this.ready.add(bundle);
                    console.info(`[Tutorial] remote bundle ready: ${bundle}`);
                } catch (error) {
                    console.warn(`[Tutorial] remote prewarm failed and will retry later: ${bundle}`, error);
                }
            }
        })();
        this.pending = task;
        const clear = (): void => { if (this.pending === task) this.pending = undefined; };
        void task.then(clear, clear);
    }

    static resetForTesting(): void {
        this.ready.clear();
        this.pending = undefined;
    }
}
