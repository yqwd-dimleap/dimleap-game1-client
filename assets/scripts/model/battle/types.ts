export type Team = 0 | 1;
export type HeroId = 'archer' | 'cavalry' | 'shield' | 'swordsman' | 'gongnuche' | 'huopaoche' | 'guanyu' | 'zhangfei' | 'liubei' | 'lvbu' | 'huangzhong' | 'zhugeliang' | 'simayi' | 'caocao' | 'sunquan' | 'zhaoyun' | 'zhouyu' | 'xiaoqiao' | 'dianwei';
export interface Point { x: number; y: number }
export interface ArenaEdges { left: number; right: number; bottom: number; top: number }
export interface RailRect extends Point { width: number; height: number }
export interface Zone extends Point { id: string; radius: number; bonus: number; polygon?: Point[] }
export interface Deployment extends Point { id: number; team: Team; hero: HeroId; level?: number }
export interface HeroDefinition {
    id: HeroId; name: string; glyph: string; count: number; cost: number; role: string; description: string;
    hp: number; damage: number; speed: number; range: number; attackRate: number; attackWait: number;
    attackTier: 1 | 2; splash: number;
    rangeMode?: 'half-field' | 'full-field';
}

