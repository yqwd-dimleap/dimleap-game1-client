import { SpriteFrame } from 'cc';
import { BUNDLES } from '../../core/Bundles';
import type { ResourceLoader } from '../../core/ResourceScope';

export type HeroCardFrameIndex = 0 | 1 | 2 | 3;

/** Shared tier-frame source for collection cards and reward cards. */
export function loadHeroCardFrame(resources: ResourceLoader, frame: HeroCardFrameIndex): Promise<SpriteFrame> {
    return frame === 1
        ? resources.load(BUNDLES.ui, 'textures/main/card_1/spriteFrame', SpriteFrame, undefined, 'background')
        : resources.load(BUNDLES.heroes, `textures/view/card_${frame}/spriteFrame`, SpriteFrame, undefined, 'background');
}
