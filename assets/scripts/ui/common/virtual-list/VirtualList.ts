import { instantiate, isValid, Node, Prefab, ScrollView, UITransform } from 'cc';

/** Fixed-height rows. Node count depends on viewport height, not data count. */
export class VirtualList {
    private rows: { node: Node; index: number; revision: number }[] = [];
    private count = 0;
    private revision = 0;
    private disposed = false;
    private scrollNode: Node;
    private content: Node;
    private view: UITransform;
    private render: (node: Node, index: number) => void = () => {};
    constructor(private scroll: ScrollView, private prefab: Prefab, private rowHeight = 96, private buffer = 2) {
        if (!(rowHeight > 0) || !scroll.content || !scroll.view) throw new Error('VirtualList requires content, view and positive row height');
        this.scrollNode = scroll.node; this.content = scroll.content; this.view = scroll.view;
        this.scrollNode.on(ScrollView.EventType.SCROLLING, this.refresh, this);
        this.view.node.on(Node.EventType.SIZE_CHANGED, this.refresh, this);
    }
    setItems<T>(items: readonly T[], bind: (node: Node, item: T, index: number) => void): void {
        if (!this.alive()) return;
        this.count = items.length; this.revision++;
        this.render = (node, index) => bind(node, items[index], index);
        this.content.getComponent(UITransform)!.setContentSize(this.view.width, this.count * this.rowHeight);
        this.refresh();
    }
    private refresh(): void {
        if (!this.alive()) return;
        const content = this.content, height = this.view.height;
        const capacity = Math.min(this.count, Math.ceil(height / this.rowHeight) + 2 * this.buffer + 1);
        const offset = Math.max(0, this.scroll.getScrollOffset().y);
        const start = Math.max(0, Math.min(this.count - capacity, Math.floor(offset / this.rowHeight) - this.buffer));
        while (this.rows.length < capacity) {
            const node = instantiate(this.prefab); content.addChild(node);
            this.rows.push({ node, index: -1, revision: -1 });
        }
        while (this.rows.length > capacity) {
            const row = this.rows.pop()!; if (isValid(row.node, true)) row.node.destroy();
        }
        this.rows.forEach((row, slot) => {
            const index = start + slot;
            row.node.setPosition(0, -(index + .5) * this.rowHeight);
            if (row.index !== index || row.revision !== this.revision) {
                row.index = index; row.revision = this.revision; this.render(row.node, index);
            }
        });
    }
    private alive(): boolean {
        return !this.disposed && isValid(this.scrollNode, true) && isValid(this.content, true) && !!this.view.node && isValid(this.view.node, true);
    }
    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        // Components lose their node reference during scene teardown. Keep event targets separately.
        if (isValid(this.scrollNode, true)) this.scrollNode.off(ScrollView.EventType.SCROLLING, this.refresh, this);
        if (this.view.node && isValid(this.view.node, true)) this.view.node.off(Node.EventType.SIZE_CHANGED, this.refresh, this);
        this.rows.splice(0).forEach(row => { if (isValid(row.node, true)) row.node.destroy(); });
        this.render = () => {};
    }
}
