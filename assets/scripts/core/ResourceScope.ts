import type { Asset, Constructor } from 'cc';
import type { LoadProgress } from './Res';
import type { LoadPriority } from './LoadQueue';

export interface ResourceLoader {
    load<T extends Asset>(bundle: string, path: string, type: Constructor<T>, progress?: LoadProgress,
        priority?: LoadPriority, cancelled?: () => boolean): Promise<T>;
}
/** One reference per distinct asset per owner. Never force-release assets shared by another scope. */
export class ResourceScope implements ResourceLoader {
    private held = new Set<Asset>();
    private closed = false;
    constructor(readonly name: string, private loader: ResourceLoader) {}
    get disposed(): boolean { return this.closed; }
    get size(): number { return this.held.size; }
    retain<T extends Asset>(asset: T): T {
        if (this.closed) throw new Error(`Resource scope disposed: ${this.name}`);
        if (!this.held.has(asset)) { asset.addRef(); this.held.add(asset); }
        return asset;
    }
    async load<T extends Asset>(bundle: string, path: string, type: Constructor<T>, progress?: LoadProgress,
        priority?: LoadPriority): Promise<T> {
        if (this.closed) throw new Error(`Resource scope disposed: ${this.name}`);
        const asset = await this.loader.load(bundle, path, type, (finished, total) => {
            if (!this.closed) progress?.(finished, total);
        }, priority, () => this.closed);
        if (this.closed) {
            // The loader may complete after its scene is gone. Balance the late asset without touching nodes.
            asset.addRef(); asset.decRef();
            throw new Error(`Resource scope disposed: ${this.name}`);
        }
        return this.retain(asset);
    }
    dispose(): void {
        if (this.closed) return;
        this.closed = true;
        for (const asset of this.held) asset.decRef();
        this.held.clear();
    }
}
