export type GuestPlatform = 'web' | 'wx' | 'tt';
export interface GuestSession {
    schema: 1;
    id: string;
    platform: GuestPlatform;
    kind: 'local-guest';
    verified: false;
}
export interface SessionStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** Local prototype identity only. Never use it to authorize server rewards or purchases. */
export class GuestSessionStore {
    current: GuestSession | null = null;
    persisted = false;
    constructor(private storage: SessionStorage, private platform: GuestPlatform,
        private createId = () => `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`) {}
    private get key(): string { return `runestone.guest.v1.${this.platform}`; }
    restore(): GuestSession | null {
        try {
            const raw = this.storage.getItem(this.key);
            if (!raw || raw.length > 1024) return null;
            const value = JSON.parse(raw) as GuestSession;
            if (value.schema !== 1 || value.kind !== 'local-guest' || value.verified !== false ||
                value.platform !== this.platform || typeof value.id !== 'string' || !/^guest-[a-z0-9-]{3,80}$/.test(value.id)) return null;
            this.current = value; this.persisted = true; return value;
        } catch { return null; }
    }
    enterGuest(): GuestSession {
        if (this.current) return this.current;
        this.current = { schema: 1, id: this.createId(), platform: this.platform, kind: 'local-guest', verified: false };
        try { this.storage.setItem(this.key, JSON.stringify(this.current)); this.persisted = true; }
        catch { this.persisted = false; }
        return this.current;
    }
}
