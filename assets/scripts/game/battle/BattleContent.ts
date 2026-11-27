import { HeroId } from '../../model/config/PrototypeConfig';
import { rangedAttack } from '../../model/battle/CombatTiming';
import { BUNDLES } from '../../core/Bundles';

/** Resource keys only: importing this manifest does not import battle components. */
export const BATTLE_TROOP_PATHS: Record<string, string> = {
    swordsman: 'heroes/animations/batched/swordsman', archer: 'heroes/animations/batched/archer',
    shield: 'heroes/animations/batched/shield', cavalry: 'heroes/animations/batched/cavalry',
    guanyu: 'heroes/animations/guanyu/Y_guanyu', zhangfei: 'heroes/animations/zhangfei/Y_zhangfei',
    liubei: 'heroes/animations/liubei/Y_liubei', lvbu: 'heroes/animations/lvbu/Y_lvbu',
    huangzhong: 'heroes/animations/huangzhong/Y_huangzhong', zhugeliang: 'heroes/animations/zhugeliang/Y_zhugeliang',
    caocao: 'heroes/animations/caocao/Y_caocao', simayi: 'heroes/animations/simayi/Y_simayi',
    sunquan: 'heroes/animations/sunquan/Y_sunquan', zhaoyun: 'heroes/animations/zhaoyun/Y_zhaoyun',
    zhouyu: 'heroes/animations/zhouyu/Y_zhouyu', xiaoqiao: 'heroes/animations/xiaoqiao/Y_xiaoqiao',
    dianwei: 'heroes/animations/dianwei/Y_dianwei',
    gongnuche: 'heroes/animations/gongnuche/B_gongnuche', huopaoche: 'heroes/animations/huopaoche/B_huopaoche',
};
/** Authored effects stay remote and are requested only for participating heroes. */
export const HERO_MELEE_EFFECTS: Partial<Record<HeroId, string>> = {
    lvbu: 'heroes/animations/lvbu/Y_lvbu_tx', liubei: 'heroes/animations/liubei/Y_liubei_tx',
    zhouyu: 'heroes/animations/zhouyu/Y_zhouyu_tx', dianwei: 'heroes/animations/dianwei/Y_dianwei_tx',
};
export const HERO_RANGED_ART: Partial<Record<HeroId, {
    path: string; flight: boolean; axis: number; impact: 'attack' | 'hit';
    flightCenter?: { x: number; y: number }; scale?: number; impactScale?: number;
    flightDuration?: number; impactPlaybackRate?: number;
}>> = {
    // Animated projectile centers in exported Spine coordinates; hit clips keep their own origin.
    huangzhong: { path: 'heroes/animations/huangzhong/Y_huangzhong_tx', flight: true, axis: 90, impact: 'hit' },
    sunquan: { path: 'heroes/animations/sunquan/Y_sunquan_tx', flight: true, axis: 90, impact: 'hit', flightCenter: { x: .1, y: -79.56 } },
    // These exports are lightning/wind at the destination, not travelling arrows.
    simayi: { path: 'heroes/animations/simayi/Y_simayi_tx', flight: false, axis: 0, impact: 'attack' },
    zhugeliang: { path: 'heroes/animations/zhugeliang/Y_zhugeliang_tx', flight: false, axis: 0, impact: 'attack' },
    xiaoqiao: { path: 'heroes/animations/xiaoqiao/Y_xiaoqiao_tx', flight: false, axis: 0, impact: 'attack' },
    gongnuche: { path: 'heroes/animations/gongnuche/B_gongnuche_tx', flight: true, axis: 0, impact: 'hit', scale: .3, impactScale: .5 },
    // B_gong_tx and B_huopaoche_tx both author their flight attack clip at 0.2667s.
    huopaoche: { path: 'heroes/animations/huopaoche/B_huopaoche_tx', flight: true, axis: 90, impact: 'hit', flightDuration: .2667 },
};
/** Use the imported Spine setup bounds when an asset has no authored flight-center override. */
export function setupCenter(header?: { x: number; y: number; width: number; height: number }): { x: number; y: number } | undefined {
    if (!header || !Number.isFinite(header.x) || !Number.isFinite(header.y) ||
        !(header.width > 0) || !(header.height > 0)) return undefined;
    return { x: header.x + header.width / 2, y: header.y + header.height / 2 };
}
/** VS spine ships with battle_runtime and is authored on MatchView/VSView. */
export const MATCH_SPINE_PATH = 'animations/pipei/UI_pipei_VS';
export const SETTLEMENT_SPINE_PATH = 'animations/shengli_shibai/UI_shengli_shibai';
export const SETTLEMENT_PREFAB_PATH = 'prefabs/BattleSettlement';
export const ROUND_SETTLEMENT_PREFAB_PATH = 'prefabs/RoundSettlement';
export const BATTLE_PAUSE_PREFAB_PATH = 'prefabs/BattlePause';
export interface BattleMapDefinition { id: string; name: string; bundle: string; path: string }
/** The beginner map is local; the remaining authored maps stay in remote map_bundle. */
export const BATTLE_MAPS: readonly BattleMapDefinition[] = [
    { id: 'map_1_1', name: '地图一', bundle: BUNDLES.battleRuntime, path: 'prefabs/tutorial/map/map_1_1' },
    { id: 'map_1_2', name: '地图二', bundle: BUNDLES.map, path: 'prefabs/map_1_2' },
    { id: 'map_1_3', name: '地图三', bundle: BUNDLES.map, path: 'prefabs/map_1_3' },
    { id: 'map_1_4', name: '地图四', bundle: BUNDLES.map, path: 'prefabs/map_1_4' },
    { id: 'map_1_5', name: '地图五', bundle: BUNDLES.map, path: 'prefabs/map_1_5' },
    { id: 'map_2_1', name: '地图2-1', bundle: BUNDLES.map, path: 'prefabs/map_2_1' },
    { id: 'map_2_2', name: '地图2-2', bundle: BUNDLES.map, path: 'prefabs/map_2_2' },
    { id: 'map_2_3', name: '地图2-3', bundle: BUNDLES.map, path: 'prefabs/map_2_3' },
    { id: 'map_2_4', name: '地图2-4', bundle: BUNDLES.map, path: 'prefabs/map_2_4' },
    { id: 'map_2_5', name: '地图2-5', bundle: BUNDLES.map, path: 'prefabs/map_2_5' },
    { id: 'map_3_1', name: '地图3-1', bundle: BUNDLES.map, path: 'prefabs/map_3_1' },
    { id: 'map_3_2', name: '地图3-2', bundle: BUNDLES.map, path: 'prefabs/map_3_2' },
    { id: 'map_3_3', name: '地图3-3', bundle: BUNDLES.map, path: 'prefabs/map_3_3' },
    { id: 'map_3_4', name: '地图3-4', bundle: BUNDLES.map, path: 'prefabs/map_3_4' },
    { id: 'map_3_5', name: '地图3-5', bundle: BUNDLES.map, path: 'prefabs/map_3_5' },
    { id: 'map_4_1', name: '地图4-1', bundle: BUNDLES.map, path: 'prefabs/map_4_1' },
    { id: 'map_4_2', name: '地图4-2', bundle: BUNDLES.map, path: 'prefabs/map_4_2' },
    { id: 'map_4_3', name: '地图4-3', bundle: BUNDLES.map, path: 'prefabs/map_4_3' },
    { id: 'map_4_4', name: '地图4-4', bundle: BUNDLES.map, path: 'prefabs/map_4_4' },
    { id: 'map_4_5', name: '地图4-5', bundle: BUNDLES.map, path: 'prefabs/map_4_5' },
    { id: 'map_5_1', name: '地图5-1', bundle: BUNDLES.map, path: 'prefabs/map_5_1' },
    { id: 'map_5_2', name: '地图5-2', bundle: BUNDLES.map, path: 'prefabs/map_5_2' },
    { id: 'map_5_3', name: '地图5-3', bundle: BUNDLES.map, path: 'prefabs/map_5_3' },
    { id: 'map_5_4', name: '地图5-4', bundle: BUNDLES.map, path: 'prefabs/map_5_4' },
    { id: 'map_5_5', name: '地图5-5', bundle: BUNDLES.map, path: 'prefabs/map_5_5' },
];
export function selectBattleMap(seed: number): BattleMapDefinition {
    const value = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
    return BATTLE_MAPS[value % BATTLE_MAPS.length];
}
export function battleMapById(id: string): BattleMapDefinition {
    const found = BATTLE_MAPS.find(map => map.id === id);
    if (!found) throw new Error(`服务端返回了未知地图：${id}`);
    return found;
}
export const SETTLEMENT_ART_PATHS = {
    victory: 'textures/ui/victory_icon/spriteFrame',
    failure: 'textures/ui/fail_icon/spriteFrame',
} as const;
export interface CombatContentReference { bundle: string; path: string }
/** Batched troop animations stay in the shared remote pack; named heroes live separately. */
export function combatBundleForAssetPath(path: string): string {
    return path.startsWith('heroes/animations/') && !path.startsWith('heroes/animations/batched/')
        ? BUNDLES.combatHeroes : BUNDLES.combatShared;
}
export function battleContentReferences(ids: readonly string[]): CombatContentReference[] {
    const paths = [
        'battle/animations/dizuo/hu_hong_lan', 'battle/animations/dangong/nu_lan', 'battle/animations/dangong/nu_hong',
        'battle/animations/pengzhuang/zhuanjihuohua', 'battle/animations/zengbing/hu_hong_lan_tx', 'battle/animations/death/si_tongyong',
        ...ids.map(id => BATTLE_TROOP_PATHS[id]),
        ...ids.map(id => HERO_MELEE_EFFECTS[id as HeroId] ?? HERO_RANGED_ART[id as HeroId]?.path ?? '').filter(Boolean),
        ...ids.map(id => { const attack = rangedAttack(id as HeroId); return attack && !HERO_RANGED_ART[id as HeroId] ? `heroes/animations/batched/${attack.kind}` : ''; }).filter(Boolean),
    ];
    const unique = new Map<string, CombatContentReference>();
    for (const path of Array.from(new Set(paths))) {
        const bundle = combatBundleForAssetPath(path);
        unique.set(`${bundle}:${path}`, { bundle, path });
    }
    return Array.from(unique.values());
}
