import type { MeritReward } from '../config/GameTables';

export interface MeritProgressModel {
    merit: number;
    stageIndex: number;
    previousMerit: number;
    nextMerit?: number;
    segmentProgress: number;
    totalProgress: number;
}

export type MeritRewardState = 'highlight' | 'already_claim' | 'lock_claim';

/** Every reward tier occupies the same visual width, independent of its merit threshold. */
export const MERIT_SEGMENT_WIDTH = 100;
/** Trailing breathing room so the last reward icon is not clipped by the lane edge. */
export const MERIT_TRACK_TAIL_WIDTH = 100;

export function meritLaneWidth(count: number): number {
    return Math.max(0, Math.floor(count)) * MERIT_SEGMENT_WIDTH;
}

/** The authored track is one segment wider than the reward interval span. */
export function meritTrackWidth(count: number): number {
    const tiers = Math.max(0, Math.floor(count));
    return tiers ? meritLaneWidth(tiers) + MERIT_TRACK_TAIL_WIDTH : 0;
}

/** Convert logical tier progress to the filled fraction of the wider authored track. */
export function meritTrackFillRange(progress: MeritProgressModel, count: number): number {
    const track = meritTrackWidth(count);
    return track > 0 ? Math.max(0, Math.min(1, progress.totalProgress)) * meritLaneWidth(count) / track : 0;
}

export function meritMarkerX(index: number, count: number): number {
    const width = meritTrackWidth(count);
    // Keep one full segment of leading space and one at the tail. For 27 tiers
    // markers therefore run from -1300 through +1300 on a 2800-wide track.
    return -width / 2 + (index + 1) * MERIT_SEGMENT_WIDTH;
}

export function meritProgress(merit: number, milestones: readonly MeritReward[]): MeritProgressModel {
    const safe = Math.max(0, Number.isFinite(merit) ? merit : 0);
    if (!milestones.length) return { merit: safe, stageIndex: 0, previousMerit: 0, segmentProgress: 1, totalProgress: 1 };
    let completed = 0;
    while (completed < milestones.length && safe >= milestones[completed].requiredMerit) completed++;
    if (completed >= milestones.length) return { merit: safe, stageIndex: milestones.length - 1, previousMerit: milestones[milestones.length - 1].requiredMerit, segmentProgress: 1, totalProgress: 1 };
    const previousMerit = completed === 0 ? 0 : milestones[completed - 1].requiredMerit;
    const nextMerit = milestones[completed].requiredMerit;
    const segmentProgress = Math.max(0, Math.min(1, (safe - previousMerit) / Math.max(1, nextMerit - previousMerit)));
    return { merit: safe, stageIndex: completed, previousMerit, nextMerit, segmentProgress,
        totalProgress: Math.max(0, Math.min(1, (completed + segmentProgress) / milestones.length)) };
}

export function rewardState(reward: MeritReward, merit: number, claimed: readonly string[]): MeritRewardState {
    if (claimed.includes(String(reward.id))) return 'already_claim';
    return merit >= reward.requiredMerit ? 'highlight' : 'lock_claim';
}

export function visibleRewardItems(reward: MeritReward, max = 6): readonly { id: number; amount: number }[] {
    return reward.items
        .filter(item => item.id > 0 && item.amount > 0)
        .slice(0, Math.max(0, Math.floor(max)));
}
