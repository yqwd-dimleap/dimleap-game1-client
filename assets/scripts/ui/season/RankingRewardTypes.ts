import type { RankingReward } from '../../model/config/GameTables';
import type { Prefab, SpriteFrame } from 'cc';
import type { HeroId } from '../../model/battle/types';

export interface RankingRewardAssets {
    gold: Prefab;
    hero: Prefab;
    heroIcons: Map<HeroId, SpriteFrame>;
}

export type RankRewardPresentation = RankingReward & { assets: RankingRewardAssets };
