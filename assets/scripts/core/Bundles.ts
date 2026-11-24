/** Runtime bundle names shared by loading, routing, and feature code. */
export const BUNDLES = {
    ui: 'ui_bundle',
    heroes: 'heroes_bundle',
    battle: 'battle_bundle',
    battleUi: 'battle_ui_bundle',
    map: 'map_bundle',
    combatContent: 'combat_content',
    seasonContent: 'season_content',
} as const;

export type BundleName = typeof BUNDLES[keyof typeof BUNDLES];
