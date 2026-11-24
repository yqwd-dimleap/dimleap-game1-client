import type { SeasonRankEntry } from './SeasonState';

export const SEASON_RANK_LIMIT = 100;

export interface PrototypeSeasonRankingOptions {
    limit?: number;
    selfRank?: number;
    selfPlayerId?: string;
    selfNickname?: string;
    selfAvatarId?: number;
    selfNetStars?: number;
}

const MOCK_NAMES = [
    '墨影', '长风', '山河', '青鸾', '照夜', '惊鸿', '听雨', '凌霄',
    '无咎', '星河', '飞白', '玄策', '归鸿', '扶摇', '清越', '空山',
];

function clampLimit(limit: number): number {
    if (!Number.isFinite(limit)) return SEASON_RANK_LIMIT;
    return Math.max(0, Math.min(SEASON_RANK_LIMIT, Math.floor(limit)));
}

/** Deterministic local data for the prototype leaderboard and visual tests. */
export function createPrototypeSeasonRanking(options: PrototypeSeasonRankingOptions = {}): SeasonRankEntry[] {
    const limit = clampLimit(options.limit ?? SEASON_RANK_LIMIT);
    const selfRank = Math.max(1, Math.min(limit, Math.floor(options.selfRank ?? 37)));
    const rows = Array.from({ length: limit }, (_, index) => {
        const rank = index + 1;
        const self = rank === selfRank;
        return {
            playerId: self ? options.selfPlayerId ?? 'local-player' : `mock-player-${rank}`,
            nickname: self ? options.selfNickname ?? '主公9684' : `${MOCK_NAMES[index % MOCK_NAMES.length]}${String(rank).padStart(2, '0')}`,
            rank,
            netStars: Math.max(0, Math.floor(self ? options.selfNetStars ?? 160 - rank * 2 : 160 - rank * 2)),
            avatarId: self ? Math.max(1, Math.min(8, Math.floor(options.selfAvatarId ?? 1))) : (index % 8) + 1,
            isSelf: self,
        };
    });
    return rows
        .sort((a, b) => b.netStars - a.netStars || a.playerId.localeCompare(b.playerId))
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** Keep malformed or oversized server results from inflating the virtual list. */
export function topSeasonRanking(entries: readonly SeasonRankEntry[], limit = SEASON_RANK_LIMIT): SeasonRankEntry[] {
    const max = clampLimit(limit);
    return entries
        .filter(entry => entry && typeof entry.playerId === 'string' && typeof entry.nickname === 'string' &&
            Number.isFinite(entry.rank) && entry.rank > 0 && Number.isFinite(entry.netStars))
        .slice()
        .sort((a, b) => a.rank - b.rank || b.netStars - a.netStars)
        .slice(0, max);
}
