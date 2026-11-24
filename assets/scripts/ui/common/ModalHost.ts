import { _decorator, Button, Component, isValid, Node, UITransform, Vec3, Widget } from 'cc';

export interface ModalOptions {
    /** Visible panel bounds, independent of an authored root's content size. */
    bounds?: Node;
    anchor?: Node;
    anchorOffset?: Readonly<{ x: number; y: number; z?: number }>;
    closed?: () => void;
}
export interface ModalPresenter {
    open(content: Node, options?: ModalOptions): void;
    close(content: Node): void;
}
interface Entry { content: Node; options: ModalOptions }

/** Shared native modal surface. Feature prefabs are passed in; never referenced statically. */
@_decorator.ccclass('ModalHost')
export class ModalHost extends Component implements ModalPresenter {
    private entries: Entry[] = [];
    private backdrop?: Node;
    private content?: Node;
    private initialized = false;
    private readonly outside = (): void => {
        const top = this.entries[this.entries.length - 1];
        if (top) this.close(top.content);
    };
    initialize(): void {
        if (this.initialized) return;
        this.backdrop = this.node.getChildByName('Backdrop') ?? undefined;
        this.content = this.node.getChildByName('Content') ?? undefined;
        if (!this.backdrop?.getComponent(Button) || !this.content) throw new Error('ModalLayer requires Backdrop/Button and Content');
        this.backdrop.on(Button.EventType.CLICK, this.outside);
        this.node.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.initialized = true; this.node.active = false;
    }
    open(content: Node, options: ModalOptions = {}): void {
        this.initialize();
        if (!isValid(content, true)) return;
        const previous = this.entries.findIndex(entry => entry.content === content);
        if (previous >= 0) this.close(content);
        for (const entry of this.entries) entry.content.active = false;
        this.content!.addChild(content);
        this.entries.push({ content, options });
        this.node.active = true;
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        this.node.getComponent(Widget)?.updateAlignment();
        content.active = true; this.layout();
    }
    close(content: Node): void {
        const index = this.entries?.findIndex(entry => entry.content === content) ?? -1;
        if (index < 0) return;
        const removed = this.entries.splice(index);
        for (const entry of removed.reverse()) {
            if (isValid(entry.content, true)) entry.content.active = false;
            entry.options.closed?.();
        }
        const top = this.entries[this.entries.length - 1];
        if (top && isValid(top.content, true)) { top.content.active = true; this.layout(); }
        if (isValid(this.node, true)) this.node.active = !!top;
    }
    private layout(): void {
        const entry = this.entries[this.entries.length - 1];
        if (!entry || !this.content || !isValid(entry.content, true)) return;
        const host = this.node.getComponent(UITransform)!;
        const parent = this.content.getComponent(UITransform)!;
        const node = entry.content, boundsNode = entry.options.bounds ?? node;
        node.setPosition(0, 0);
        const rect = boundsNode.getComponent(UITransform)!.getBoundingBoxToWorld();
        const low = parent.convertToNodeSpaceAR(new Vec3(rect.xMin, rect.yMin));
        const high = parent.convertToNodeSpaceAR(new Vec3(rect.xMax, rect.yMax));
        const anchor = entry.options.anchor;
        const target = anchor && isValid(anchor, true) ? parent.convertToNodeSpaceAR(anchor.worldPosition) :
            new Vec3(-(low.x + high.x) / 2, -(low.y + high.y) / 2);
        if (entry.options.anchorOffset) {
            target.x += entry.options.anchorOffset.x;
            target.y += entry.options.anchorOffset.y;
            target.z += entry.options.anchorOffset.z ?? 0;
        }
        const margin = 16;
        const clamp = (v: number, min: number, max: number): number => min <= max ? Math.max(min, Math.min(max, v)) : (min + max) / 2;
        node.setPosition(clamp(target.x, -host.width / 2 + margin - low.x, host.width / 2 - margin - high.x),
            clamp(target.y, -host.height / 2 + margin - low.y, host.height / 2 - margin - high.y));
    }
    onDestroy(): void {
        if (this.backdrop && isValid(this.backdrop, true)) this.backdrop.off(Button.EventType.CLICK, this.outside);
        if (isValid(this.node, true)) this.node.off(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.entries = []; this.backdrop = undefined; this.content = undefined;
    }
}
