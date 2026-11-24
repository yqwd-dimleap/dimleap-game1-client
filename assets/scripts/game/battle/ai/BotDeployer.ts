import type { AIRow } from '../../../model/config/GameTables';
import { arenaEdges, bonusAt, Deployment, distance, HeroId, HEROES, Point, RULES, Team, Zone, ZONES, isDeployableHero } from '../../../model/config/PrototypeConfig';
import { canEnterArena, clampedPull, predictLanding, Shot, shotFromDrag } from '../../../model/battle/ThrowMath';
import type { CombatObstacle } from '../../../model/battle/CombatCollision';

export interface BotPlan extends Shot { hero: HeroId; reason: string }
export interface BotLaunchGeometry {
    maxDrag: number;
    constrain(pull: Point): Point;
    origin(pull: Point): Point;
}
/** Candidates use the same constrained pull, actual socket origin and damped banks as the guide. */
export function planBotShot(start: Point, tokens: Deployment[], available: HeroId[], team: Team, zones: readonly Zone[] = ZONES,
    geometry?: BotLaunchGeometry, difficulty?: Readonly<AIRow>, random: () => number = Math.random,
    obstacles: readonly CombatObstacle[] = []): BotPlan {
    available = available.filter(isDeployableHero);
    if (!available.length) throw new Error('Bot has no affordable cards');
    const targets = [
        ...zones.map(z => ({ x: z.x, y: z.y, value: (z.bonus * 4 + 4) * (difficulty?.bonus_zone_weight ?? 1), attack: false, reason: `争夺 +${z.bonus} 区` })),
        ...tokens.filter(t => t.team !== team && bonusAt(t, zones) > 0).map(t => ({ x: t.x, y: t.y,
            value: (bonusAt(t, zones) * 5 + 5) * (difficulty?.displace_enemy_weight ?? 1), attack: true, reason: '撞开敌方占区 Token' })),
        { x: RULES.centerX, y: RULES.centerY, value: -100, attack: false, reason: '向场内安全部署' },
    ];
    const b = arenaEdges(RULES.tokenRadius), sign = team === 0 ? 1 : -1;
    const maxDrag = geometry?.maxDrag ?? RULES.maxDrag;
    let best: BotPlan | undefined, bestScore = -Infinity;
    const hero = (['shield', 'archer', 'cavalry', 'swordsman'] as HeroId[]).find(h => available.includes(h)) ?? available[0];
    for (const target of targets) for (const bank of [0, -1, 1]) {
        if (bank && RULES.wallRestitution < .01) continue;
        const tx = bank === 0 ? target.x : 2 * (bank < 0 ? b.left : b.right) - target.x;
        const dx = tx - start.x, dy = target.y - start.y, length = Math.hypot(dx, dy);
        if (!length || dy * sign <= 0 || Math.abs(dy) / length < Math.cos(RULES.maxLaunchAngle * Math.PI / 180)) continue;
        for (let sample = 0; sample <= 20; sample++) {
            const power = sample / 20, drag = RULES.minDrag + power * (maxDrag - RULES.minDrag);
            const request = { x: dx / length * drag, y: dy / length * drag };
            const pull = geometry ? geometry.constrain(request) : clampedPull(request.x, request.y, team, maxDrag);
            const shot = shotFromDrag(pull.x, pull.y, team, maxDrag);
            if (!shot) continue;
            const origin = geometry ? geometry.origin(pull) : { x: start.x - pull.x, y: start.y - pull.y };
            if (!canEnterArena(origin, shot)) continue;
            const prediction = predictLanding(origin, shot, target.attack ? target : undefined, obstacles);
            const miss = target.attack ? prediction.closest : distance(prediction.end, target);
            let score = target.value - miss * .12 - (bank ? 1.8 : 0);
            for (const token of tokens) {
                // Approximate obstructions; full token-contact prediction remains Box2D's job.
                const progress = ((token.x - origin.x) * dx + (token.y - origin.y) * dy) / (length * length);
                if (progress > .05 && progress < .9 && distance(token, { x: origin.x + progress * dx, y: origin.y + progress * dy }) < 90)
                    score += token.team === team ? -10 : (bonusAt(token, zones) > 0 ? 2 : -3);
            }
            if (tokens.some(t => t.team === team && distance(t, target) < 90)) score -= 9;
            if (score > bestScore) {
                bestScore = score;
                best = { ...shot, hero, reason: `${HEROES[hero].name} · ${bank ? '借墙反弹 · ' : ''}${target.reason}` };
            }
        }
    }
    if (!best) {
        // Keep turn flow valid even for an unusable GM combination; settlement brings an outside base inside.
        const shot = shotFromDrag(0, sign * maxDrag, team, maxDrag)!;
        best = { ...shot, hero, reason: '满力向场内试投（请检查速度与阻尼）' };
    }
    if (difficulty) {
        const angle = (random() * 2 - 1) * difficulty.aim_error_deg * Math.PI / 180;
        const strength = 1 + (random() * 2 - 1) * difficulty.power_error_ratio;
        const length = (RULES.minDrag + best.power * (maxDrag - RULES.minDrag)) * strength;
        const speed = Math.hypot(best.vx, best.vy);
        const requested = { x: (best.vx * Math.cos(angle) - best.vy * Math.sin(angle)) / speed * length,
            y: (best.vx * Math.sin(angle) + best.vy * Math.cos(angle)) / speed * length };
        const pull = geometry ? geometry.constrain(requested) : clampedPull(requested.x, requested.y, team, maxDrag);
        const perturbed = shotFromDrag(pull.x, pull.y, team, maxDrag);
        if (perturbed) best = { ...perturbed, hero: best.hero, reason: best.reason };
    }
    return best;
}
