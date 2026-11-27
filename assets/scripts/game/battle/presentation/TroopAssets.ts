import { EffectAsset, Material, sp, Vec4, Color } from 'cc';
import type { ResourceLoader } from '../../../core/ResourceScope';
import { BUNDLES } from '../../../core/Bundles';
import { DEPLOYABLE_HERO_IDS, HeroId, Team } from '../../../model/config/PrototypeConfig';
import { TROOP_OUTLINE } from '../../../ui/theme/BattleTheme';
import { ProjectileKind, rangedAttack, upwardAttack } from '../../../model/battle/CombatTiming';
import { TOKEN_BASE_CLIPS, TOKEN_BASE_PATH } from './TokenBaseConfig';
import { SpineBatchRenderer } from './SpineBatchRenderer';
import {
    BATTLE_TROOP_PATHS, HERO_MELEE_EFFECTS, HERO_RANGED_ART, combatBundleForAssetPath, setupCenter,
} from '../BattleContent';
import { BATTLE_FEEDBACK, ENEMY_OUTLINE_SCALE_LIMIT, feedbackValue } from './BattleFeedbackSettings';

export const TROOP_PATHS: Partial<Record<HeroId, string>> = BATTLE_TROOP_PATHS;

/** Loaded only after entering the battle content; no bootstrap resource references. */
export class TroopAssets {
    private loadGeneration = 0;
    private data = new Map<HeroId, sp.SkeletonData>();
    death!: sp.SkeletonData;
    deathDuration = 0;
    collision!: sp.SkeletonData;
    reinforcement!: sp.SkeletonData;
    collisionDuration = 0;
    reinforcementDuration = 0;
    tokenBase!: sp.SkeletonData;
    launchers!: readonly [sp.SkeletonData, sp.SkeletonData];
    get tokenBaseHeight(): number { return (this.tokenBase.skeletonJson as any).skeleton.height; }
    tokenBaseMountHeight(team: Team): number {
        const skin = team === 0 ? 'lan' : 'hong';
        const region = (this.tokenBase.skeletonJson as any).skins
            .find((item: { name: string }) => item.name === skin)?.attachments?.hu_lana?.hu_lana2;
        // Idle hides the 109px landing ring. Dock the smaller team artwork to the string.
        const height = region?.height * Math.abs(region?.scaleY ?? 1) / 2 - (region?.y ?? 0);
        if (!(height > 0) || !Number.isFinite(height)) throw new Error(`底座挂载尺寸无效：${skin}`);
        return height;
    }
    private heroEffects = new Map<HeroId, sp.SkeletonData>();
    private projectiles = new Map<ProjectileKind, sp.SkeletonData>();
    private enemyMaterials = new Map<HeroId, Material>();
    private outlineMaterials = new Set<Material>();
    private outlineWidth: number = TROOP_OUTLINE.width * BATTLE_FEEDBACK.enemyOutlineScale;
    private batchRenderer?: SpineBatchRenderer;
    attachBatch(skeleton: sp.Skeleton): void { this.batchRenderer?.attach(skeleton); }
    detachBatch(skeleton: sp.Skeleton): void { this.batchRenderer?.detach(skeleton); }
    async load(res: ResourceLoader, heroes: readonly HeroId[] = DEPLOYABLE_HERO_IDS): Promise<void> {
        const generation = ++this.loadGeneration;
        const active = (): void => {
            if (generation !== this.loadGeneration) throw new Error('Troop resource loading cancelled');
        };
        this.tokenBase = await res.load(BUNDLES.combatShared, `battle/${TOKEN_BASE_PATH}`, sp.SkeletonData, undefined, 'critical');
        active();
        const base = this.tokenBase.getRuntimeData();
        for (const clip of TOKEN_BASE_CLIPS) {
            const animation = base?.findAnimation(clip);
            if (!animation || (!clip.startsWith('idle') && !(animation.duration > 0))) throw new Error(`底座动画无效：${clip}`);
        }
        for (const skin of ['lan', 'hong']) if (!base?.findSkin(skin)) throw new Error(`底座皮肤缺失：${skin}`);
        if (!(this.tokenBaseHeight > 0)) throw new Error('底座原始高度无效');
        this.launchers = await Promise.all([
            res.load(BUNDLES.combatShared, 'battle/animations/dangong/nu_lan', sp.SkeletonData, undefined, 'critical'),
            res.load(BUNDLES.combatShared, 'battle/animations/dangong/nu_hong', sp.SkeletonData, undefined, 'critical'),
        ]);
        active();
        const effects = await Promise.all([
            res.load(BUNDLES.combatShared, 'battle/animations/pengzhuang/zhuanjihuohua', sp.SkeletonData, undefined, 'normal'),
            res.load(BUNDLES.combatShared, 'battle/animations/zengbing/hu_hong_lan_tx', sp.SkeletonData, undefined, 'normal'),
        ]);
        active();
        [this.collision, this.reinforcement] = effects;
        this.collisionDuration = this.collision.getRuntimeData()?.findAnimation('animation')?.duration ?? 0;
        this.reinforcementDuration = this.reinforcement.getRuntimeData()?.findAnimation('luodi')?.duration ?? 0;
        if (!(this.collisionDuration > 0) || !(this.reinforcementDuration > 0)) throw new Error('碰撞或增兵特效动画缺失');
        await Promise.all(heroes.map(async id => {
            const path = TROOP_PATHS[id]!;
            const data = await res.load(combatBundleForAssetPath(path), path, sp.SkeletonData, undefined, 'critical');
            active();
            const animations = (data.skeletonJson as any)?.animations;
            for (const clip of ['idle', 'walk', 'attack']) {
                if (!animations?.[clip]) throw new Error(`兵种动画缺失：${id}/${clip}`);
            }
            this.data.set(id, data);
        }));
        await Promise.all(heroes.map(async id => {
            const path = HERO_MELEE_EFFECTS[id] ?? HERO_RANGED_ART[id]?.path;
            if (!path) return;
            const data = await res.load(combatBundleForAssetPath(path), path, sp.SkeletonData, undefined, 'normal'); active();
            if (!data.getRuntimeData()?.findAnimation('attack')) throw new Error(`英雄攻击特效缺失：${id}/attack`);
            if (HERO_RANGED_ART[id]?.impact === 'hit' && !data.getRuntimeData()?.findAnimation('hit'))
                throw new Error(`英雄命中特效缺失：${id}/hit`);
            this.heroEffects.set(id, data);
        }));
        const kinds = new Set<ProjectileKind>();
        for (const id of heroes) {
            const attack = rangedAttack(id); if (attack && !HERO_RANGED_ART[id]) kinds.add(attack.kind);
        }
        await Promise.all(Array.from(kinds).map(async kind => {
            const data = await res.load(BUNDLES.combatShared, `heroes/animations/batched/${kind}`, sp.SkeletonData, undefined, 'normal');
            active();
            if (!(data.skeletonJson as any)?.animations?.attack) throw new Error(`弹体动画缺失：${kind}/attack`);
            this.projectiles.set(kind, data);
        }));
        this.death = await res.load(BUNDLES.combatShared, 'battle/animations/death/si_tongyong', sp.SkeletonData, undefined, 'background');
        active();
        if (!(this.death.skeletonJson as any)?.animations?.animation) throw new Error('死亡动画缺失：si_tongyong/animation');
        this.deathDuration = this.death.getRuntimeData()?.findAnimation('animation')?.duration ?? 0;
        if (!(this.deathDuration > 0)) throw new Error('死亡动画时长无效：si_tongyong/animation');
        const effect = await res.load(BUNDLES.battleRuntime, 'materials/troop-outline', EffectAsset, undefined, 'normal');
        active();
        const sharedMaterials = new Map<string, Material>();
        for (const id of heroes) {
            const texture = this.get(id).textures[0];
            if (!texture) throw new Error(`兵种贴图缺失：${id}`);
            const shared = sharedMaterials.get(texture.uuid);
            if (shared) { this.enemyMaterials.set(id, shared); continue; }
            const material = new Material();
            material.initialize({ effectAsset: effect });
            material.setProperty('outlineColor', new Color(255, 55, 55, 255));
            material.setProperty('outlineParams', new Vec4(this.outlineWidth / texture.width, this.outlineWidth / texture.height, 0, 0));
            this.enemyMaterials.set(id, material);
            this.outlineMaterials.add(material);
            sharedMaterials.set(texture.uuid, material);
        }
        const batchEffect = await res.load(BUNDLES.battleRuntime, 'materials/troop-multitexture', EffectAsset, undefined, 'background');
        active();
        this.batchRenderer = new SpineBatchRenderer(batchEffect, skeleton => {
            if (!skeleton.customMaterial) return 0;
            return this.outlineMaterials.has(skeleton.customMaterial) ? this.outlineWidth : null;
        });
    }
    get(id: HeroId): sp.SkeletonData {
        const data = this.data.get(id); if (!data) throw new Error(`兵种资源尚未开放：${id}`); return data;
    }
    attackEffect(id: HeroId): sp.SkeletonData | undefined { return HERO_MELEE_EFFECTS[id] ? this.heroEffects.get(id) : undefined; }
    projectileArt(hero: HeroId, kind: ProjectileKind, impact = false): {
        data: sp.SkeletonData; clip: string; native: boolean; axis: number; center?: { x: number; y: number };
        scale?: number; impactScale?: number; flightDuration?: number; impactPlaybackRate?: number;
    } | undefined {
        const art = HERO_RANGED_ART[hero];
        if (art) {
            if (!impact && !art.flight) return undefined;
            const data = this.heroEffects.get(hero);
            if (!data) throw new Error(`英雄攻击资源未加载：${hero}`);
            const center = art.flightCenter ?? setupCenter((data.skeletonJson as any)?.skeleton);
            return { data, clip: impact ? art.impact : 'attack', native: true, axis: art.axis,
                scale: art.scale, impactScale: art.impactScale, flightDuration: art.flightDuration,
                impactPlaybackRate: art.impactPlaybackRate,
                ...(!impact && center ? { center } : {}) };
        }
        if (impact && kind === 'arrow') return undefined;
        return { data: this.projectile(kind), clip: impact ? 'hit' : 'attack', native: false, axis: kind === 'bolt' ? 0 : 90 };
    }
    enemyMaterial(id: HeroId): Material { return this.enemyMaterials.get(id)!; }
    projectile(kind: ProjectileKind): sp.SkeletonData { return this.projectiles.get(kind)!; }
    setOutlineWidth(width: number): number {
        this.outlineWidth = Math.round(Math.max(TROOP_OUTLINE.min, Math.min(TROOP_OUTLINE.max,
            Number.isFinite(width) ? width : TROOP_OUTLINE.width)) * 100) / 100;
        const updated = new Set<Material>();
        for (const [id, material] of this.enemyMaterials) {
            if (updated.has(material)) continue;
            const texture = this.get(id).textures[0];
            material.setProperty('outlineParams', new Vec4(this.outlineWidth / texture.width, this.outlineWidth / texture.height, 0, 0));
            updated.add(material);
        }
        return this.outlineWidth;
    }
    setEnemyOutlineScale(scale: number): number {
        const value = feedbackValue(scale, BATTLE_FEEDBACK.enemyOutlineScale, ENEMY_OUTLINE_SCALE_LIMIT);
        BATTLE_FEEDBACK.enemyOutlineScale = value;
        this.setOutlineWidth(TROOP_OUTLINE.width * value);
        return value;
    }
    destroy(): void {
        this.loadGeneration++;
        this.batchRenderer?.destroy(); this.batchRenderer = undefined;
        for (const material of new Set(this.enemyMaterials.values())) material.destroy(); this.enemyMaterials.clear();
        this.outlineMaterials.clear();
        this.data.clear(); this.projectiles.clear(); this.heroEffects.clear();
    }
}
