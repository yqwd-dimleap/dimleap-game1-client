import type { Platform } from '../sdk/Platform';

export const REMOTE_VERSION_SCHEMA = 1;
export const REMOTE_VERSION_CACHE_KEY = 'runestone.remote.version.v1';
export const REMOTE_DEVICE_KEY = 'runestone.remote.device.v1';

export interface RemoteVersionManifest {
    schema?: number;
    /** Default version for bundles without an explicit override. */
    current: string;
    /** Safe target used when the active directory cannot be loaded. */
    fallback?: string;
    /** Previous published version; used as a last local recovery candidate. */
    previous?: string;
    /** Operational override. The normal rollback path should update current instead. */
    rollback_to?: string | null;
    /** Optional gray version and device-stable percentage. */
    next?: string;
    gray_percent?: number;
    force_restart?: boolean;
    /** Per-bundle directory overrides, for example { map_bundle: "1.0.4" }. */
    bundles?: Record<string, string>;
    updated_at?: string;
}

export interface RemoteVersionSnapshot {
    readonly activeVersion: string;
    readonly source: 'remote' | 'cache' | 'config';
    readonly fetchedAt: number;
    readonly manifest: Readonly<RemoteVersionManifest> | null;
}

export interface RemoteVersionStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

interface CachedVersionState {
    cacheVersion: 1;
    activeVersion: string;
    fetchedAt: number;
    manifest: RemoteVersionManifest;
}

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RETRY_DELAYS_MS = [0, 300, 700];
const MANIFEST_TIMEOUT_MS = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeRemoteVersion(value: unknown): string {
    if (typeof value !== 'string') throw new Error('远程版本必须是字符串');
    const normalized = value.trim().replace(/^v/i, '');
    if (!VERSION_PATTERN.test(normalized)) throw new Error(`远程版本格式无效：${value}`);
    return normalized;
}

export function remoteVersionDirectory(value: string): string {
    return `remote_v${normalizeRemoteVersion(value)}`;
}

function optionalVersion(source: Record<string, unknown>, key: string): string | undefined {
    if (source[key] === undefined || source[key] === null || source[key] === '') return undefined;
    return normalizeRemoteVersion(source[key]);
}

/** Validate untrusted CDN JSON before any value is used to build a URL. */
export function parseRemoteVersionManifest(value: unknown): RemoteVersionManifest {
    if (!isRecord(value)) throw new Error('远程版本清单不是对象');
    if (value.schema !== undefined && value.schema !== REMOTE_VERSION_SCHEMA)
        throw new Error(`不支持的远程版本清单 schema：${String(value.schema)}`);
    const current = normalizeRemoteVersion(value.current);
    const manifest: RemoteVersionManifest = {
        schema: REMOTE_VERSION_SCHEMA,
        current,
        fallback: optionalVersion(value, 'fallback'),
        previous: optionalVersion(value, 'previous'),
        rollback_to: value.rollback_to === null || value.rollback_to === undefined ? null : normalizeRemoteVersion(value.rollback_to),
        next: optionalVersion(value, 'next'),
        force_restart: value.force_restart === true,
    };
    if (value.gray_percent !== undefined) {
        if (typeof value.gray_percent !== 'number' || !Number.isFinite(value.gray_percent) ||
            value.gray_percent < 0 || value.gray_percent > 1)
            throw new Error('gray_percent 必须在 0～1 之间');
        manifest.gray_percent = value.gray_percent;
    }
    if (typeof value.updated_at === 'string') manifest.updated_at = value.updated_at;
    if (value.bundles !== undefined) {
        if (!isRecord(value.bundles)) throw new Error('bundles 必须是对象');
        const bundles: Record<string, string> = {};
        for (const [name, version] of Object.entries(value.bundles)) {
            if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`远程 Bundle 名称无效：${name}`);
            bundles[name] = normalizeRemoteVersion(version);
        }
        manifest.bundles = bundles;
    }
    return manifest;
}

function graySeed(storage: RemoteVersionStorage): number {
    let id = '';
    try { id = storage.getItem(REMOTE_DEVICE_KEY) || ''; } catch { /* storage can be unavailable */ }
    if (!id) {
        id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        try { storage.setItem(REMOTE_DEVICE_KEY, id); } catch { /* keep an in-memory seed */ }
    }
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0x100000000;
}

export function selectRemoteVersion(manifest: RemoteVersionManifest, storage: RemoteVersionStorage): string {
    if (manifest.rollback_to) return normalizeRemoteVersion(manifest.rollback_to);
    if (manifest.next && (manifest.gray_percent ?? 0) > 0 && graySeed(storage) < (manifest.gray_percent ?? 0))
        return normalizeRemoteVersion(manifest.next);
    return normalizeRemoteVersion(manifest.current);
}

function readCache(storage: RemoteVersionStorage): CachedVersionState | null {
    let raw = '';
    try { raw = storage.getItem(REMOTE_VERSION_CACHE_KEY) || ''; } catch { return null; }
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<CachedVersionState>;
        if (value.cacheVersion !== 1 || typeof value.fetchedAt !== 'number') return null;
        const manifest = parseRemoteVersionManifest(value.manifest);
        return {
            cacheVersion: 1,
            activeVersion: normalizeRemoteVersion(value.activeVersion),
            fetchedAt: value.fetchedAt,
            manifest,
        };
    } catch { return null; }
}

function writeCache(storage: RemoteVersionStorage, state: CachedVersionState): void {
    try { storage.setItem(REMOTE_VERSION_CACHE_KEY, JSON.stringify(state)); } catch { /* best effort */ }
}

function withCacheBuster(url: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}_rv=${Date.now().toString(36)}`;
}

export function remoteBundleUrl(baseUrl: string, bundleName: string, version: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    return `${base}/${remoteVersionDirectory(version)}/remote/${encodeURIComponent(bundleName)}`;
}

/**
 * Resolves one platform's remote content family at cold start.
 * A remote manifest wins over the package fallback; a last valid cache bridges offline starts.
 */
export class RemoteVersionManager {
    private pending?: Promise<RemoteVersionSnapshot>;
    private snapshot: RemoteVersionSnapshot;
    private initialized = false;
    private loadedVersions = new Map<string, string>();

    constructor(
        private readonly baseUrl: string,
        private readonly defaultVersion: string,
        private readonly platform: Platform,
        private readonly storage: RemoteVersionStorage,
        private readonly enabled: boolean,
    ) {
        const activeVersion = normalizeRemoteVersion(defaultVersion);
        this.snapshot = Object.freeze({ activeVersion, source: 'config', fetchedAt: 0, manifest: null });
    }

    initialize(): Promise<RemoteVersionSnapshot> {
        if (this.initialized) return Promise.resolve(this.snapshot);
        if (!this.enabled || !this.baseUrl) {
            this.initialized = true;
            return Promise.resolve(this.snapshot);
        }
        if (this.pending) return this.pending;
        const task = this.fetchManifest().then(snapshot => {
            this.snapshot = snapshot;
            this.initialized = true;
            return snapshot;
        });
        this.pending = task;
        const clear = (): void => { if (this.pending === task) this.pending = undefined; };
        void task.then(clear, clear);
        return task;
    }

    get state(): RemoteVersionSnapshot { return this.snapshot; }

    versionForBundle(bundleName: string): string {
        const explicit = this.snapshot.manifest?.bundles?.[bundleName];
        const current = this.snapshot.manifest?.current;
        // A generated manifest mirrors current in every bundle entry. A different value is a real pin,
        // while matching entries must still follow rollback/next selection.
        return explicit && explicit !== current ? normalizeRemoteVersion(explicit) : this.snapshot.activeVersion;
    }

    recoveryVersionsForBundle(bundleName: string): string[] {
        const versions = [
            this.versionForBundle(bundleName),
            this.snapshot.activeVersion,
            this.snapshot.manifest?.fallback,
            this.snapshot.manifest?.previous,
            this.defaultVersion,
        ];
        return Array.from(new Set(versions.filter((value): value is string => !!value)
            .map(value => normalizeRemoteVersion(value))));
    }

    loadedVersionFor(bundleName: string): string | undefined {
        return this.loadedVersions.get(bundleName);
    }

    markLoaded(bundleName: string, version: string): void {
        this.loadedVersions.set(bundleName, normalizeRemoteVersion(version));
    }

    clearLoadedVersions(): void {
        this.loadedVersions.clear();
    }

    private async fetchManifest(): Promise<RemoteVersionSnapshot> {
        const cached = readCache(this.storage);
        const url = `${this.baseUrl.replace(/\/+$/, '')}/config/remote_version.json`;
        let lastError: unknown;
        for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
            const delay = RETRY_DELAYS_MS[attempt];
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            try {
                const data = await this.platform.request<unknown>(withCacheBuster(url), {
                    method: 'GET',
                    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
                    timeoutMs: MANIFEST_TIMEOUT_MS,
                });
                const manifest = parseRemoteVersionManifest(data);
                const activeVersion = selectRemoteVersion(manifest, this.storage);
                const fetchedAt = Date.now();
                writeCache(this.storage, { cacheVersion: 1, activeVersion, fetchedAt, manifest });
                const bundleVersions = Object.entries(manifest.bundles || {})
                    .map(([name, version]) => `${name}=${version}`).join(', ') || `default=${activeVersion}`;
                console.info(
                    `[RemoteVersion] CDN ${url} | current=${manifest.current} | active=${activeVersion}` +
                    ` | fallback=${manifest.fallback || '-'} | bundles=[${bundleVersions}]`,
                );
                return Object.freeze({ activeVersion, source: 'remote', fetchedAt, manifest: Object.freeze(manifest) });
            } catch (error) {
                lastError = error;
                console.warn(`[RemoteVersion] manifest attempt ${attempt + 1}/${RETRY_DELAYS_MS.length} failed`, error);
            }
        }
        if (cached) {
            console.warn(
                `[RemoteVersion] CDN ${url} unavailable; cached current=${cached.manifest.current}` +
                ` | active=${cached.activeVersion}`, lastError,
            );
            return Object.freeze({
                activeVersion: cached.activeVersion,
                source: 'cache',
                fetchedAt: cached.fetchedAt,
                manifest: Object.freeze(cached.manifest),
            });
        }
        const fallback = normalizeRemoteVersion(this.defaultVersion);
        console.warn(`[RemoteVersion] CDN ${url} unavailable; package fallback=${fallback}`, lastError);
        return Object.freeze({ activeVersion: fallback, source: 'config', fetchedAt: 0, manifest: null });
    }
}
