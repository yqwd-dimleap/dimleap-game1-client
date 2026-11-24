import { HERO_TABLE_IDS } from '../config/GameTables';
import type { HeroId } from '../battle/types';
/** Every current hero id has a portrait in heroes_bundle/textures/heros. */
export const HERO_ICON_PATHS: Partial<Record<HeroId, string>> = {};
for (const id of Object.keys(HERO_TABLE_IDS) as HeroId[]) {
    const numeric = HERO_TABLE_IDS[id];
    HERO_ICON_PATHS[id] = `textures/heros/hero_${numeric}/spriteFrame`;
}
