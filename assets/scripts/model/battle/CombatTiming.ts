import type { HeroId } from '../config/PrototypeConfig';

export type ProjectileKind = 'arrow' | 'bolt' | 'shell';
export interface RangedAttack {
    kind: ProjectileKind; speed: number; arc: boolean; radius: number;
    minFlight?: number; maxFlight?: number; minArcHeight?: number; arcHeightRatio?: number;
    launchX?: number; launchHeight?: number; launchLead?: number;
    /** Effective skill collision radius around the real impact point, in arena pixels. */
    hitRadius?: number;
    /** All bodies inside the skill collision are damaged; this only caps dense crowds. */
    maxTargets?: number;
    /** Resolve the impact around the locked target's current body; false uses the authored landing point. */
    seekTarget?: boolean;
}
const BOW_ARC = { speed: 300, arc: true, minFlight: .8, maxFlight: 1.35, minArcHeight: 110, arcHeightRatio: .5 } as const;
const RANGED: Partial<Record<HeroId, RangedAttack>> = {
    // Flight time controls pacing; height controls the shape. Keep both in model seconds/units.
    archer: {
        kind: 'arrow', speed: 300, arc: true, radius: 3,
        minFlight: .8, maxFlight: 1.35, minArcHeight: 110, arcHeightRatio: .5,
        hitRadius: 30, maxTargets: 3, seekTarget: true
    },
    huangzhong: {
        kind: 'arrow', radius: 3, ...BOW_ARC,
        launchX: 0, launchHeight: 100, launchLead: 53.33,
        hitRadius: 34, maxTargets: 3, seekTarget: true
    },
    // Mage artwork is a destination strike rather than a travelling body, so its
    // collision is intentionally wider and follows the current target at impact.
    zhugeliang: { kind: 'shell', speed: 340, arc: true, radius: 6, hitRadius: 78, seekTarget: true },
    simayi: { kind: 'shell', speed: 340, arc: true, radius: 6, hitRadius: 58, maxTargets: 5, seekTarget: true },
    xiaoqiao: { kind: 'shell', speed: 340, arc: true, radius: 6, hitRadius: 52, maxTargets: 4, seekTarget: true },
    sunquan: { kind: 'shell', speed: 340, arc: true, radius: 6, launchX: 0, launchHeight: 100, launchLead: 57.74,
        hitRadius: 38, maxTargets: 3, seekTarget: true },
    gongnuche: { kind: 'bolt', radius: 5, ...BOW_ARC, hitRadius: 42, maxTargets: 4, seekTarget: true },
    huopaoche: { kind: 'shell', radius: 6, ...BOW_ARC, hitRadius: 64, seekTarget: true },
};
export const rangedAttack = (hero: HeroId): RangedAttack | undefined => RANGED[hero];
export const upwardAttack = (hero: HeroId): boolean => !!RANGED[hero]?.arc;
/** Ground movement and airborne height are separate; only landing can hit with a lobbed shot. */
export function projectilePose(p: { hero?: HeroId; kind: ProjectileKind; x: number; y: number; vx: number; vy: number; elapsed: number; duration: number; arcHeight: number }): { x: number; y: number; angle: number } {
    const t = Math.max(0, Math.min(1, p.elapsed / p.duration));
    // Archers release above the body at the raised bow. Blend back to the target's
    // body height at landing; ground flight coordinates still own damage/collision.
    const shot = p.hero ? RANGED[p.hero] : undefined;
    let launchX = shot?.launchX ?? 0, launchHeight = shot?.launchHeight ?? (p.kind === 'arrow' ? 50 : 22);
    const landingHeight = 22;
    // Long authored projectiles start with their tail at the bow. Place their center
    // ahead along the initial tangent, then blend that offset to zero at landing.
    const ax = p.vx - launchX / p.duration, ay = p.vy + (landingHeight - launchHeight + 4 * p.arcHeight) / p.duration;
    const length = Math.hypot(ax, ay), lead = shot?.launchLead ?? 0;
    if (lead && length > 0) { launchX += ax / length * lead; launchHeight += ay / length * lead; }
    const height = launchHeight + (landingHeight - launchHeight) * t;
    const lift = 4 * p.arcHeight * t * (1 - t);
    const vertical = p.vy + (landingHeight - launchHeight) / p.duration + 4 * p.arcHeight * (1 - 2 * t) / p.duration;
    return {
        x: p.x + launchX * (1 - t), y: p.y + height + lift,
        angle: Math.atan2(vertical, p.vx - launchX / p.duration) * 180 / Math.PI
    };
}

/**
 * Melee attacks repeat as attack -> attack at 1 / attack_rate_s. The attack clip is
 * scaled to that interval, so there is no idle segment between swings.
 * Ranged attacks retain the fixed attack clip followed by attack_wait_s.
 */
export function attackTiming(hero: HeroId, attackTier: 1 | 2, attackRate: number, attackWait = 0): {
    duration: number; windup: number; projectileSpeed: number; cooldown: number;
} {
    const ranged = attackTier === 2;
    const duration = ranged ? 2 / 3 : 1 / Math.max(.01, attackRate);
    return { duration, windup: duration * (ranged ? .5 : .45), projectileSpeed: rangedAttack(hero)?.speed ?? 0,
        cooldown: ranged ? duration + Math.max(0, attackWait) : duration };
}
