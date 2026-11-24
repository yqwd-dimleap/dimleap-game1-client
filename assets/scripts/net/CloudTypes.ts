export interface CloudHeroProgress { level: number; shards: number; unlocked: boolean }
export interface CloudPlayerState {
    playerId: string;
    nickname: string;
    avatarId: number;
    coins: number;
    netStars: number;
    matches: number;
    merit: number;
    seasonId: string;
    lineup: (string | null)[];
}
export interface CloudBootstrap {
    player: CloudPlayerState;
    heroes: Record<string, CloudHeroProgress>;
    season: { seasonId: string; merit: number; claimedMilestoneIds: string[] };
    configVersion: string;
}
export interface CloudDifficulty {
    difficultyId: number;
    name: string;
    enemyHeroLevel: number;
    aimErrorDeg: number;
    powerErrorRatio: number;
    bonusZoneWeight: number;
    displaceEnemyWeight: number;
}
export interface CloudBattleStart {
    battleId: string;
    ticket: string;
    configVersion: string;
    rankId: number;
    netStars: number;
    difficulty: CloudDifficulty;
    map: { mapId: string; zoneSeed: number };
}
export interface CloudBattleResult {
    duplicate: boolean;
    reward: {
        result: 'win' | 'loss';
        coins: number;
        starsDelta: number;
        merit: number;
        starsBefore: number;
        starsAfter: number;
    };
    player: { coins: number; netStars: number; matches: number; merit: number };
}
export interface CloudRankEntry {
    playerId: string;
    nickname: string;
    avatarId: number;
    netStars: number;
    rank: number;
    isSelf: boolean;
    isBot: boolean;
}
export interface CloudLeaderboard {
    entries: CloudRankEntry[];
    self: CloudRankEntry | null;
    ownRank: number | null;
    seasonId: string;
    cached: boolean;
}
export interface CloudHeroMutation {
    coins: number;
    hero: CloudHeroProgress;
    alreadyUnlocked?: boolean;
    alreadyMax?: boolean;
}
export interface CloudMeritClaim {
    rewardId: number;
    claimed: boolean;
    coins: number;
    granted: { itemId: number; name: string; amount: number; heroKey?: string }[];
    claimedMilestoneIds: string[];
}
