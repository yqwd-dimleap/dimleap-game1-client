/** Runtime bundle names shared by loading, routing, and feature code. */
export const BUNDLES = {
    ui: 'ui_bundle',
    settings: 'settings_ui',
    heroes: 'heroes_bundle',
    battleRuntime: 'battle_runtime',
    map: 'map_bundle',
    combatShared: 'combat_shared',
    combatHeroes: 'combat_heroes',
    seasonContent: 'season_content',
} as const;

export type BundleName = typeof BUNDLES[keyof typeof BUNDLES];
