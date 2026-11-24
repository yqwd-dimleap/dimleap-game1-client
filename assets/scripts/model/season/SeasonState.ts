/** Server-owned seasonal results; rank score and merit rewards are separate. */
export interface SeasonRankEntry {
    playerId: string;
    nickname: string;
    rank: number;
    netStars: number;
    avatarId?: number;
    avatarUrl?: string;
    isSelf?: boolean;
}
export interface SeasonState { seasonId: string; merit: number; claimedMilestoneIds: string[]; ownRank?: number }
