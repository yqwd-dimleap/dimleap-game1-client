import { SpriteFrame } from 'cc';
import type { ResourceLoader } from '../../core/ResourceScope';
import type { LoadPriority } from '../../core/LoadQueue';
import { BUNDLES } from '../../core/Bundles';

/** Common avatars stay local; full rank art is loaded with season content. */
export const PLAYER_UI_BUNDLE = BUNDLES.ui;
export const PLAYER_RANK_BUNDLE = BUNDLES.seasonContent;
export const RANK_LEVEL_PREFAB_PATH = 'ui/prefabs/shared/RankLevel';
export const avatarPath = (id: number): string => `textures/avatar/avatar_${id}/spriteFrame`;
export const rankBadgePath = (rankArt: number): string => `ui/textures/level/level_${rankArt}/spriteFrame`;
export const rankTitlePath = (rankArt: number): string => `ui/textures/level/title_bg_${rankArt}/spriteFrame`;
export function loadPlayerAvatars(resources: ResourceLoader, priority: LoadPriority = 'normal'): Promise<SpriteFrame[]> {
    return Promise.all(Array.from({ length: 8 }, (_, i) => resources.load(PLAYER_UI_BUNDLE, avatarPath(i + 1), SpriteFrame, undefined, priority)));
}
export function loadPlayerBadge(resources: ResourceLoader, avatar: number, rankArt: number): Promise<SpriteFrame[]> {
    return Promise.all([
        resources.load(PLAYER_UI_BUNDLE, avatarPath(avatar), SpriteFrame),
        resources.load(PLAYER_RANK_BUNDLE, rankBadgePath(rankArt), SpriteFrame),
        resources.load(PLAYER_RANK_BUNDLE, rankTitlePath(rankArt), SpriteFrame),
    ]);
}
