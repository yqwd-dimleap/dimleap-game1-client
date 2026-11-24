import { SpriteFrame } from 'cc';
import type { ResourceLoader } from '../../core/ResourceScope';
import type { LoadPriority } from '../../core/LoadQueue';
import { BUNDLES } from '../../core/Bundles';

/** One shared owner for avatars and rank art; feature bundles never carry duplicate copies. */
export const PLAYER_UI_BUNDLE = BUNDLES.ui;
export const avatarPath = (id: number): string => `textures/avatar/avatar_${id}/spriteFrame`;
export function loadPlayerAvatars(resources: ResourceLoader, priority: LoadPriority = 'normal'): Promise<SpriteFrame[]> {
    return Promise.all(Array.from({ length: 8 }, (_, i) => resources.load(PLAYER_UI_BUNDLE, avatarPath(i + 1), SpriteFrame, undefined, priority)));
}
export function loadPlayerBadge(resources: ResourceLoader, avatar: number, rankArt: number): Promise<SpriteFrame[]> {
    return Promise.all([avatarPath(avatar), `textures/level/level_${rankArt}/spriteFrame`, `textures/level/title_bg_${rankArt}/spriteFrame`]
        .map(path => resources.load(PLAYER_UI_BUNDLE, path, SpriteFrame)));
}
