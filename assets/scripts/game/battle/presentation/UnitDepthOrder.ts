import type { Node } from 'cc';

type WebNode = Node & {
    _eventProcessor?: { onUpdatingSiblingIndex(): void };
    _onSiblingIndexChanged?: (index: number) => void;
};

/** Creator 3.8.8 Web adapter for the lab's plain unit roots.
 * Updating each sibling separately repeatedly scans the complete army. Publish one
 * final order, refresh all sibling indices once, then invalidate input dispatch once.
 * Unknown node hooks use the public setSiblingIndex path instead.
 */
export function reorderUnitNodes(nodes: readonly Node[]): boolean {
    if (!nodes.length) return true;
    const parent = nodes[0].parent;
    if (!parent || typeof parent._updateSiblingIndex !== 'function') return false;
    const children = parent.children, selected = new Set(nodes);
    if (selected.size !== nodes.length || nodes.some(node => node.parent !== parent)) return false;
    const ordered = [...nodes, ...children.filter(node => !selected.has(node))];
    if (ordered.length !== children.length) return false;
    const changed = ordered.filter((node, index) => node !== children[index]) as WebNode[];
    if (!changed.length) return true;
    if (changed.some(node => node._onSiblingIndexChanged !== undefined ||
        typeof node._eventProcessor?.onUpdatingSiblingIndex !== 'function')) return false;
    for (let i = 0; i < ordered.length; i++) children[i] = ordered[i];
    parent._updateSiblingIndex();
    changed[0]._eventProcessor!.onUpdatingSiblingIndex();
    return true;
}
