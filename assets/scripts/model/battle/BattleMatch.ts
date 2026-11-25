import { HeroId } from './types';
/** Local opponent simulation; one identity is reused throughout matching, VS and battle. */
export interface MatchIdentity { nickname: string; avatar: number }
export interface BattleMatch { startedAt: number; blue: MatchIdentity; red: MatchIdentity }
/** Matching (including opponent lock) takes 2s; the complete VS clip takes another 2s. */
export const MATCH_TIMING = Object.freeze({ matching: 2, lock: 0.15, vs: 2, vsHold: 1.5, candidate: 0.12 });
export function matchSearchWait(startedAt: number, now = Date.now()): number {
    return Math.max(0, MATCH_TIMING.matching - MATCH_TIMING.lock - Math.max(0, now - startedAt) / 1000);
}
export function createMatchOpponent(random = Math.random): MatchIdentity {
    const names = ['长坂小将', '桃园来客', '江东游侠', '卧龙听雨', '赤壁东风', '常山少年', '虎牢守将', '洛阳行者'];
    return { nickname: names[Math.floor(random() * names.length)] + String(100 + Math.floor(random() * 900)), avatar: 1 + Math.floor(random() * 8) };
}
export function createBattleMatch(random = Math.random, now = Date.now(), player: MatchIdentity = { nickname: '我方', avatar: 1 }): BattleMatch {
    return { startedAt: now, blue: { nickname: player.nickname, avatar: player.avatar }, red: createMatchOpponent(random) };
}
/** Sample without replacement. Called once per selecting turn, never by render/update. */
export function drawBattleHand(available: readonly HeroId[], random = Math.random): HeroId[] {
    const pool = Array.from(new Set(available));
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
}
