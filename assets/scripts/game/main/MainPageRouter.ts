import { instantiate, isValid, Node, Prefab } from 'cc';
import { Res } from '../../core/Res';
import { ResourceScope } from '../../core/ResourceScope';
import type { MainPage } from '../../ui/main/MainShellView';

export interface MainPageHandle { show?(): void; hide?(): void; destroy(): void }
interface PageDefinition { bundle: string; path: string; create(node: Node, resources: ResourceScope): Promise<MainPageHandle> | MainPageHandle }
interface CachedPage { node: Node; resources: ResourceScope; handle: MainPageHandle; used: number }

/** Last selection wins. Every instantiated page owns a bounded resource scope. */
export class MainPageRouter {
    private pages = new Map<MainPage, CachedPage>();
    private generation = 0;
    private disposed = false;
    private active?: MainPage;
    private pending?: { page: MainPage; result: Promise<boolean> };
    private warming = new Map<MainPage, Promise<boolean>>();
    private warmShells = new Map<MainPage, Node>();
    private warmActivate = new Set<MainPage>();
    constructor(private host: Node, private res: Res, private routes: Record<MainPage, PageDefinition>, private capacity = 2) {}
    /** Warm a page in the background without changing the active page. */
    preload(page: MainPage): Promise<boolean> {
        const cached = this.pages.get(page);
        if (cached) return Promise.resolve(true);
        if (this.warming.has(page)) return this.warming.get(page)!;
        const result = this.showPage(page, false, false, node => {
            this.warmShells.set(page, node);
            if (this.warmActivate.has(page)) this.activateShell(page, node);
        });
        this.warming.set(page, result);
        const clear = (): void => {
            if (this.warming.get(page) === result) this.warming.delete(page);
            this.warmShells.delete(page);
            if (!this.pages.has(page)) this.warmActivate.delete(page);
        };
        void result.then(clear, clear);
        return result;
    }
    show(page: MainPage): Promise<boolean> {
        // Repeated taps share the current request instead of restarting page creation.
        if (this.pending?.page === page) return this.pending.result;
        const warm = this.warming.get(page);
        const activationGeneration = warm ? ++this.generation : undefined;
        for (const warmed of this.warmActivate) if (warmed !== page) this.warmActivate.delete(warmed);
        if (warm) {
            this.warmActivate.add(page);
            const shell = this.warmShells.get(page);
            if (shell) this.activateShell(page, shell);
        }
        const result = warm ? warm.then(ok => {
            this.warmActivate.delete(page);
            return ok ? this.showPage(page, true, true, undefined, activationGeneration) : false;
        }, error => { this.warmActivate.delete(page); throw error; }) : this.showPage(page);
        const request = { page, result };
        this.pending = request;
        const clear = (): void => { if (this.pending === request) this.pending = undefined; };
        void request.result.then(clear, clear);
        return request.result;
    }
    isLoaded(page: MainPage): boolean { return this.pages.has(page); }
    private activateShell(page: MainPage, node: Node): void {
        if (this.active && this.active !== page) this.pages.get(this.active)?.handle.hide?.();
        for (const [name, entry] of this.pages) entry.node.active = name === page;
        node.active = true;
    }
    private async showPage(page: MainPage, activate = true, guardGeneration = true, onShell?: (node: Node) => void, expectedGeneration?: number): Promise<boolean> {
        if (this.disposed || !isValid(this.host, true)) return false;
        const generation = expectedGeneration ?? (guardGeneration ? ++this.generation : this.generation);
        if (guardGeneration && expectedGeneration !== undefined && expectedGeneration !== this.generation) return false;
        const previous = this.active;
        let cached = this.pages.get(page);
        if (!cached) {
            const definition = this.routes[page], resources = this.res.createScope(`page:${page}`);
            let node: Node | undefined, handle: MainPageHandle | undefined;
            try {
                const prefab = await resources.load(definition.bundle, definition.path, Prefab);
                if (this.disposed || !isValid(this.host, true) || (guardGeneration && generation !== this.generation)) { resources.dispose(); return false; }
                node = instantiate(prefab); this.host.addChild(node);
                onShell?.(node);
                // Activate the authored page shell as soon as its prefab is available. Feature
                // controllers may still be loading icons and secondary cards, but the user can
                // see the destination page immediately instead of waiting for every asset.
                if (activate) {
                    if (previous && previous !== page) this.pages.get(previous)?.handle.hide?.();
                    for (const [name, entry] of this.pages) entry.node.active = name === page;
                    node.active = true;
                } else node.active = false;
                handle = await definition.create(node, resources);
                if (this.disposed || !isValid(this.host, true) || !isValid(node, true) || (guardGeneration && generation !== this.generation)) {
                    handle.destroy(); if (isValid(node, true)) node.destroy(); resources.dispose();
                    if (activate && previous && this.pages.has(previous)) {
                        this.pages.get(previous)!.node.active = true; this.pages.get(previous)!.handle.show?.();
                    }
                    return false;
                }
                cached = { node, resources, handle, used: generation }; this.pages.set(page, cached);
            } catch (error) {
                try { handle?.destroy(); } finally { if (node && isValid(node, true)) node.destroy(); resources.dispose(); }
                if (activate && previous && this.pages.has(previous)) {
                    this.pages.get(previous)!.node.active = true; this.pages.get(previous)!.handle.show?.();
                }
                if (this.disposed || generation !== this.generation) return false;
                throw error;
            }
        }
        if (!activate) {
            cached.node.active = this.warmActivate.has(page);
            return true;
        }
        this.activateShell(page, cached.node);
        this.active = page; cached.used = generation; cached.handle.show?.();
        while (this.pages.size > this.capacity) {
            const candidate = Array.from(this.pages).filter(([name]) => name !== this.active).sort((a, b) => a[1].used - b[1].used)[0];
            if (!candidate) break;
            this.release(candidate[0], candidate[1]);
        }
        return true;
    }
    private release(name: MainPage, page: CachedPage): void {
        this.pages.delete(name);
        try { page.handle.destroy(); } finally { if (isValid(page.node, true)) page.node.destroy(); page.resources.dispose(); }
    }
    destroy(): void {
        if (this.disposed) return;
        this.disposed = true; this.generation++;
        for (const [name, page] of this.pages) this.release(name, page);
    }
}
