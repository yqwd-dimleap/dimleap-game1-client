import { Component, Node } from 'cc';

/** Short paths relative to one component's root, cached once; never searches another page. */
export class ViewNodes {
    private nodes = new Map<string, Node>();
    private components = new Map<Node, Map<unknown, Component>>();
    constructor(private root: Node) {}
    path(path: string): Node {
        if (!path || path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error(`Invalid UI path: ${path}`);
        const cached = this.nodes.get(path);
        if (cached?.isValid) return cached;
        const node = this.root.getChildByPath(path);
        if (!node) throw new Error(`${this.root.name}: missing UI path ${path}`);
        this.nodes.set(path, node); return node;
    }
    at<T extends Component>(path: string, type: new (...args: any[]) => T): T {
        const node = this.path(path);
        let cache = this.components.get(node);
        if (!cache) { cache = new Map(); this.components.set(node, cache); }
        const previous = cache.get(type);
        if (previous?.isValid) return previous as T;
        const component = node.getComponent(type);
        if (!component) throw new Error(`${this.root.name}/${path}: missing ${type.name}`);
        cache.set(type, component); return component;
    }
}
