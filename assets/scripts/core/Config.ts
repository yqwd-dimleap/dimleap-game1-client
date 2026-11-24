import { DEBUG } from 'cc/env';

export interface BundleDefinition {
    delivery: 'subpackage' | 'remote';
    priority: number;
    dependencies: string[];
}
export interface AppConfig {
    version: string;
    minimumClientVersion: string;
    apiBaseUrl: string;
    remoteBaseUrl: { web: string; wx: string; tt: string };
    bundleVersions: Record<string, string>;
    /** Runtime loading and build checks share this delivery manifest. */
    bundles: Record<string, BundleDefinition>;
}
export function parseConfig(value: unknown): AppConfig {
    const c = value as AppConfig;
    if (!c || typeof c.version !== 'string' || typeof c.minimumClientVersion !== 'string' || typeof c.apiBaseUrl !== 'string' || !c.remoteBaseUrl || !c.bundleVersions)
        throw new Error('Invalid bootstrap configuration');
    for (const key of ['web', 'wx', 'tt'] as const) {
        const url = c.remoteBaseUrl[key];
        if (typeof url !== 'string' || (url && !/^https:\/\//.test(url))) throw new Error(`Invalid CDN URL: ${key}`);
    }
    const localDevelopmentApi = DEBUG && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(c.apiBaseUrl);
    if (c.apiBaseUrl && !/^https:\/\//.test(c.apiBaseUrl) && !localDevelopmentApi) throw new Error('API requires HTTPS');
    if (!c.bundles || typeof c.bundles !== 'object' || Array.isArray(c.bundles)) throw new Error('Missing bundle manifest');
    const visited = new Set<string>(), visiting = new Set<string>();
    const visit = (name: string): void => {
        if (visiting.has(name)) throw new Error(`Cyclic bundle dependency: ${name}`);
        if (visited.has(name)) return;
        const bundle = c.bundles[name];
        if (!bundle || !['subpackage', 'remote'].includes(bundle.delivery) || !Number.isInteger(bundle.priority) ||
            bundle.priority < 0 || bundle.priority > 6 || !Array.isArray(bundle.dependencies) ||
            !/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Invalid bundle definition: ${name}`);
        visiting.add(name);
        for (const dependency of bundle.dependencies) {
            if (typeof dependency !== 'string') throw new Error(`Invalid bundle dependency: ${name}`);
            visit(dependency);
            if (bundle.delivery === 'subpackage' && c.bundles[dependency].delivery === 'remote')
                throw new Error(`Local bundle cannot statically depend on remote content: ${name}`);
            if (c.bundles[dependency].priority <= bundle.priority)
                throw new Error(`Shared bundle must have higher priority: ${name} -> ${dependency}`);
        }
        visiting.delete(name); visited.add(name);
    };
    Object.keys(c.bundles).forEach(visit);
    return c;
}
