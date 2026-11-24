import type { PlayerSave } from '../../core/Save';

/** Snapshot boundary shared by the lobby and matching. A future server adapter supplies the same fields. */
export interface PlayerProfile { playerId: string; nickname: string; avatar: number; netStars: number }

export function validatePlayerProfile(profile: PlayerProfile): void {
    if (!profile || typeof profile.playerId !== 'string' || !/^\d{6,8}$/.test(profile.playerId) ||
        typeof profile.nickname !== 'string' || !profile.nickname.trim() || Array.from(profile.nickname).length > 19 ||
        /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(profile.nickname) ||
        !Number.isInteger(profile.avatar) || profile.avatar < 1 || profile.avatar > 8 ||
        !Number.isSafeInteger(profile.netStars) || profile.netStars < 0) throw new Error('Invalid player profile');
}

export function localPlayerProfile(sessionId: string, save: PlayerSave): Readonly<PlayerProfile> {
    // Compact device-local display ID; a real account will use the server-issued playerId.
    let hash = 2166136261;
    for (let i = 0; i < sessionId.length; i++) hash = Math.imul(hash ^ sessionId.charCodeAt(i), 16777619);
    const playerId = String(10000000 + (hash >>> 0) % 90000000);
    const profile = { ...(save.identity ?? { playerId, nickname: `主公${playerId.slice(-4)}`, avatar: 1 }), netStars: save.netStars ?? 0 };
    validatePlayerProfile(profile);
    return Object.freeze(profile);
}
