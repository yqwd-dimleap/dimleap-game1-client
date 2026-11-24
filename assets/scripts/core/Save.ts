export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface PlayerSave {
    schema: 1; sound: boolean; matches: number; netStars?: number; merit?: number;
    identity?: { playerId: string; nickname: string; avatar: number };
}
export class Save {
    private readonly key = 'runestone.player.v2';
    constructor(private storage: StoragePort) {}
    read(): PlayerSave {
        const defaults: PlayerSave = { schema: 1, sound: true, matches: 0 };
        try {
            const raw = this.storage.getItem(this.key);
            if (!raw) return defaults;
            const data = JSON.parse(raw) as Partial<PlayerSave>;
            const identity = data.identity;
            if (identity !== undefined && (!identity || typeof identity !== 'object' || Array.isArray(identity) ||
                typeof identity.playerId !== 'string' || !/^\d{6,8}$/.test(identity.playerId) ||
                typeof identity.nickname !== 'string' || !identity.nickname.trim() || Array.from(identity.nickname).length > 19 ||
                /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(identity.nickname) ||
                !Number.isInteger(identity.avatar) || identity.avatar < 1 || identity.avatar > 8)) throw new Error('Invalid player identity');
            if (data.netStars !== undefined && (!Number.isSafeInteger(data.netStars) || data.netStars < 0)) throw new Error('Invalid rank stars');
            if (data.merit !== undefined && (!Number.isSafeInteger(data.merit) || data.merit < 0)) throw new Error('Invalid merit');
            if (data.schema !== 1 || typeof data.sound !== 'boolean' || !Number.isSafeInteger(data.matches) || data.matches! < 0)
                throw new Error('Unsupported or invalid player save');
            return data as PlayerSave;
        } catch (error) { console.warn('[Save] read failed; original storage retained', error); return defaults; }
    }
    write(data: PlayerSave): boolean {
        try { this.storage.setItem(this.key, JSON.stringify(data)); return true; }
        catch (error) { console.warn('[Save] write failed', error); return false; }
    }
}
