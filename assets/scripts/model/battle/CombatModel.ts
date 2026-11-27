import { BattleConfig, createBattleConfig } from './BattleConfig';
import { deploymentTroopCount, heroStats } from '../hero/HeroProgress';
import { clamp, Deployment, distance, HeroId, HEROES, Point, Team, Zone, ZONES } from '../config/PrototypeConfig';
import { attackTiming, ProjectileKind, rangedAttack } from './CombatTiming';
import { APPROACH_SLOPE, attackAligned, CombatBounds, CombatObstacle, combatSpawn, createCombatMovementScratch,
    engagementGoal, meleeHits, moveCombatUnits, segmentIntersectsObstacle, SteeringState, sweepCircle,
    UNIT_RADIUS, UNIT_SPACING } from './CombatCollision';
import { CombatSpatial } from './CombatSpatial';

export interface UnitState extends Point {
    id: number; team: Team; hero: HeroId; hp: number; maxHp: number; cooldown: number; level?: number;
    action?: 'idle' | 'walk' | 'attack'; facingX?: number; facingY?: number; attackSerial?: number; attackUntil?: number;
    targetId?: number;
}
export interface AttackEvent {
    from: Point; to: Point; team: Team; splash: number; damage: number;
    phase: 'attack' | 'launch' | 'impact'; id: number; attackerId: number; targetId: number; hero: HeroId;
    duration: number; attackDuration?: number;
}
export interface ProjectileState extends Point {
    id: number; attackerId: number; targetId: number; hero: HeroId; team: Team; from: Point; to: Point;
    elapsed: number; duration: number; attackDuration?: number; damage: number; splash: number; vx: number; vy: number;
    kind: ProjectileKind; arcHeight: number; radius: number;
    hitRadius: number; maxTargets: number; seekTarget: boolean;
}
interface PendingAttack { event: AttackEvent; due: number; projectileSpeed: number; facing: Point }
export type Winner = Team | 'draw';
export interface CombatOptions {
    units?: UnitState[];
    bounds?: CombatBounds;
    arena?: { width: number; height: number };
    config?: BattleConfig;
    obstacles?: readonly CombatObstacle[];
}
const unitId = (unit: UnitState): number => unit.id;

/** Pure battle rules. No Cocos nodes, timers, random globals or render dependencies. */
export class CombatModel {
    units: UnitState[] = [];
    events: AttackEvent[] = [];
    projectiles: ProjectileState[] = [];
    private pending: PendingAttack[] = [];
    private attackSerial = 0;
    private steering = new Map<number, SteeringState>();
    private engagement = new Map<number, { target: number; side: number; ready: boolean }>();
    private index = [new CombatSpatial<UnitState>(), new CombatSpatial<UnitState>()];
    private byId = new Map<number, UnitState>();
    private attributes = new Map<string, ReturnType<typeof heroStats>>();
    private nextTargetCheck = new Map<number, number>();
    private nextSideCheck = new Map<number, number>();
    private sideCandidates: UnitState[] = [];
    private alive: UnitState[] = [];
    private teamUnits: [UnitState[], UnitState[]] = [[], []];
    private rangedTargets = new Map<number, UnitState>();
    private previousPositions = new Map<number, Point>();
    private damage = new Map<number, number>();
    private goals = new Map<number, Point>();
    private goalCache = new Map<number, Point>();
    private nearby: UnitState[] = [];
    private candidates: UnitState[] = [];
    private candidateHits: UnitState[] = [];
    private movementScratch = createCombatMovementScratch();
    private readonly obstacles: readonly CombatObstacle[];
    private counts = [0, 0];
    private totalHp = [0, 0];
    private initialHp = [0, 0];
    readonly bounds: CombatBounds;
    private config: BattleConfig;
    get configuration(): BattleConfig { return this.config; }
    /** GM updates only future attacks in this model; airborne projectiles retain their duration. */
    setArrowFlightMultiplier(value: number): void {
        if (!Number.isFinite(value) || value < .5 || value > 3) throw new Error('Invalid arrow flight multiplier');
        this.config = createBattleConfig(this.config.zones, { ...this.config.rules, arrowFlightMultiplier: value });
    }
    private readonly arena: { width: number; height: number };
    elapsed = 0;
    winner: Winner | null = null;

    constructor(deployment: Deployment[], zones: readonly Zone[] = ZONES, options: CombatOptions = {}) {
        this.config = options.config ?? createBattleConfig(zones);
        const rules = this.config.rules;
        this.obstacles = options.obstacles ?? [];
        this.bounds = { ...(options.bounds ?? { x: rules.width / 2 - 20, y: rules.height / 2 - 20, centerX: rules.centerX, centerY: rules.centerY }) };
        // Movement bounds exclude a body margin; range always uses the actual board size.
        this.arena = { ...(options.arena ?? this.config.arena) };
        const bx = this.bounds.x, by = this.bounds.y, cx = this.bounds.centerX ?? 0, cy = this.bounds.centerY ?? 0;
        if (options.units) this.units = options.units;
        for (const token of deployment) {
            const hero = heroStats(token.hero, token.level);
            const count = deploymentTroopCount(token, this.config.zones,
                this.config.rules.tokenRadius, this.config.rules.zoneContactDepth);
            const enemies = this.units.filter(unit => unit.team !== token.team);
            for (let i = 0; i < count; i++) {
                const angle = i * 2.399963229728653;
                const radius = i === 0 ? 0 : UNIT_SPACING * Math.sqrt(i);
                const spawn = combatSpawn({
                    x: clamp(token.x + Math.cos(angle) * radius, cx - bx, cx + bx),
                    y: clamp(token.y + Math.sin(angle) * radius, cy - by, cy + by),
                }, enemies, this.bounds, this.obstacles);
                this.units.push({ ...spawn, id: this.units.length + 1, team: token.team, hero: token.hero,
                    level: token.level ?? 1, hp: hero.hp, maxHp: hero.hp, cooldown: (i % 3) * 0.06,
                    action: 'walk', facingX: token.team === 0 ? 1 : -1, facingY: 0, attackSerial: 0, attackUntil: 0 });
            }
        }
        this.rebuildIndex(this.units);
        for (const unit of this.units) this.initialHp[unit.team] += unit.maxHp;
        // Start in the direction of the real opponent, rather than a fixed team direction.
        for (const unit of this.units) {
            const target = this.chooseTarget(unit, this.units);
            if (!target) continue;
            unit.targetId = target.id;
            const d = distance(unit, target);
            if (d > .001) { unit.facingX = (target.x - unit.x) / d; unit.facingY = (target.y - unit.y) / d; }
        }
    }

    private stats(unit: UnitState): ReturnType<typeof heroStats> {
        const key = `${unit.hero}:${unit.level ?? 1}`;
        let value = this.attributes.get(key);
        if (!value) { value = heroStats(unit.hero, unit.level, this.arena); this.attributes.set(key, value); }
        return value;
    }
    private obstacleBlocksMelee(unit: UnitState, target: UnitState): boolean {
        return this.obstacles.length > 0 &&
            this.obstacles.some(obstacle => segmentIntersectsObstacle(unit, target, .5, obstacle));
    }
    private rebuildIndex(alive: readonly UnitState[]): void {
        this.index[0].clear(); this.index[1].clear(); this.byId.clear();
        for (const unit of alive) { this.index[unit.team].add(unit); this.byId.set(unit.id, unit); }
    }
    private rememberPositions(units: readonly UnitState[]): void {
        for (const unit of units) {
            let point = this.previousPositions.get(unit.id);
            if (!point) { point = { x: unit.x, y: unit.y }; this.previousPositions.set(unit.id, point); }
            else { point.x = unit.x; point.y = unit.y; }
        }
    }
    private goalPoint(id: number): Point {
        let point = this.goals.get(id);
        if (!point) {
            point = this.goalCache.get(id);
            if (!point) { point = { x: 0, y: 0 }; this.goalCache.set(id, point); }
            this.goals.set(id, point);
        }
        return point;
    }

    private chooseTarget(unit: UnitState, alive: readonly UnitState[]): UnitState | undefined {
        const current = this.byId.get(unit.targetId ?? -1), range = this.stats(unit).range;
        if (current && current.hp > 0 && current.team !== unit.team) {
            if (distance(unit, current) <= range) {
                if (rangedAttack(unit.hero) || attackAligned(unit, current)) return current;
                // In a melee, engage an available lateral opponent before orbiting a vertical one.
                // Stagger the local search rather than scanning a dense army every logic step.
                if ((this.nextSideCheck.get(unit.id) ?? 0) <= this.elapsed) {
                    this.nextSideCheck.set(unit.id, this.elapsed + .2 + unit.id % 5 * .01);
                    this.index[unit.team === 0 ? 1 : 0].rect(unit.x - range, unit.y - range,
                        unit.x + range, unit.y + range, this.sideCandidates);
                    let lateral: UnitState | undefined, best = Infinity;
                    for (const enemy of this.sideCandidates) {
                        const d = distance(unit, enemy);
                        if (d <= range && attackAligned(unit, enemy, APPROACH_SLOPE) &&
                            (d < best || (d === best && enemy.id < lateral!.id))) { lateral = enemy; best = d; }
                    }
                    if (lateral) return lateral;
                }
                return current;
            }
            if (alive.length > 128 && (this.nextTargetCheck.get(unit.id) ?? 0) > this.elapsed) return current;
        }
        const nearest = this.index[unit.team === 0 ? 1 : 0].nearest(unit, unitId);
        const best = nearest ? distance(unit, nearest) : Infinity;
        this.nextTargetCheck.set(unit.id, this.elapsed + .2 + unit.id % 5 * .01);
        if (!current || !nearest || current === nearest) return nearest;
        const currentDistance = distance(unit, current);
        // Keep an engaged target; outside reach, change only for a clearly closer enemy.
        if (currentDistance <= range || (best > range && currentDistance - best < 24)) return current;
        return nearest;
    }

    /** Balance ranged attackers across living enemies before they choose or refresh a shot. */
    private assignRangedTargets(): void {
        this.rangedTargets.clear();
        for (const team of [0, 1] as const) {
            const attackers = this.teamUnits[team], enemies = this.teamUnits[team === 0 ? 1 : 0];
            if (!enemies.length) continue;
            const loads = new Map<number, number>();
            for (const unit of attackers) {
                const stats = this.stats(unit);
                if (stats.attackTier !== 2) continue;
                const inRange = enemies.some(enemy => distance(unit, enemy) <= stats.range + 1e-6);
                let target: UnitState | undefined, minLoad = Infinity, bestDistance = Infinity;
                for (const enemy of enemies) {
                    const d = distance(unit, enemy);
                    if (inRange && d > stats.range + 1e-6) continue;
                    const load = loads.get(enemy.id) ?? 0;
                    if (load < minLoad || (load === minLoad && (d < bestDistance ||
                        (d === bestDistance && enemy.id < (target?.id ?? Infinity))))) {
                        target = enemy; minLoad = load; bestDistance = d;
                    }
                }
                if (!target) continue;
                this.rangedTargets.set(unit.id, target);
                loads.set(target.id, (loads.get(target.id) ?? 0) + 1);
            }
        }
    }

    step(dt: number): void {
        this.events.length = 0;
        if (this.winner !== null) return;
        this.elapsed += dt;
        const alive = this.alive;
        alive.length = 0;
        for (const unit of this.units) if (unit.hp > 0) alive.push(unit);
        this.rebuildIndex(alive);
        this.teamUnits[0].length = 0; this.teamUnits[1].length = 0;
        for (const unit of alive) this.teamUnits[unit.team].push(unit);
        this.assignRangedTargets();
        this.rememberPositions(alive);
        const previous = this.previousPositions;
        const damage = this.damage;
        const goals = this.goals;
        damage.clear(); goals.clear();
        // Resolve attacks simultaneously, so iteration order cannot grant a first-strike advantage.
        for (const unit of alive) {
            unit.cooldown -= dt;
            unit.action = 'idle';
            // Avoid holding the final attack pose for an extra fixed step because of float drift.
            if ((unit.attackUntil ?? 0) > this.elapsed + 1e-8) { unit.action = 'attack'; continue; }
            const hero = this.stats(unit), previousTargetId = unit.targetId;
            const target = hero.attackTier === 2 ? this.rangedTargets.get(unit.id) : this.chooseTarget(unit, alive);
            if (target?.id !== previousTargetId) { this.steering.delete(unit.id); this.engagement.delete(unit.id); }
            unit.targetId = target?.id;
            if (!target) continue;
            const best = distance(unit, target);
            if (best > .001) { unit.facingX = (target.x - unit.x) / best; unit.facingY = (target.y - unit.y) / best; }
            let approach = this.engagement.get(unit.id);
            if (!approach || approach.target !== target.id) {
                const dx = unit.x - target.x;
                approach = { target: target.id, side: Math.abs(dx) > 8 ? Math.sign(dx) : unit.team === 0 ? -1 : 1, ready: false };
                this.engagement.set(unit.id, approach);
            }
            // A small angle margin prevents walk/attack toggling at the edge of the attack cone.
            approach.ready = attackAligned(unit, target, approach.ready ? undefined : APPROACH_SLOPE);
            // A ranged shot can aim across the field; horizontal clips only choose its visual side.
            const ranged = rangedAttack(unit.hero);
            // Melee units must physically reach a clear side of a blocker. Otherwise a nearer
            // enemy behind a wall makes them stop against the wall and appear permanently stuck.
            const blocked = !ranged && this.obstacleBlocksMelee(unit, target);
            if (best > hero.range + 1e-6 || blocked) {
                unit.action = 'walk';
                if (blocked) {
                    const amount = Math.min(hero.speed * dt, best);
                    const goal = this.goalPoint(unit.id);
                    goal.x = unit.x + (target.x - unit.x) / best * amount;
                    goal.y = unit.y + (target.y - unit.y) / best * amount;
                } else if (ranged) {
                    const amount = Math.min(hero.speed * dt, best - Math.max(0, hero.range - 4));
                    const goal = this.goalPoint(unit.id);
                    goal.x = unit.x + (target.x - unit.x) / best * amount;
                    goal.y = unit.y + (target.y - unit.y) / best * amount;
                } else {
                    const offset = (unit.id % 3 - 1) * Math.min(12, hero.range * .15);
                    engagementGoal(unit, target, hero.range, approach.side, offset, hero.speed * dt, this.bounds, this.goalPoint(unit.id));
                }
            } else if (unit.cooldown <= (hero.attackTier === 1 ? 1e-8 : 0)) {
                const timing = attackTiming(unit.hero, hero.attackTier, hero.attackRate, hero.attackWait);
                unit.cooldown = timing.cooldown;
                unit.facingX = Math.sign(target.x - unit.x) || -approach.side; unit.facingY = 0;
                unit.action = 'attack'; unit.attackUntil = this.elapsed + timing.duration;
                unit.attackSerial = ++this.attackSerial;
                const event: AttackEvent = { from: { x: unit.x, y: unit.y }, to: { x: target.x, y: target.y },
                    team: unit.team, splash: hero.splash, damage: hero.damage, phase: 'attack', id: unit.attackSerial,
                    attackerId: unit.id, targetId: target.id, hero: unit.hero, duration: timing.duration, attackDuration: timing.duration };
                this.events.push(event);
                this.pending.push({ event, due: this.elapsed + timing.windup, projectileSpeed: timing.projectileSpeed,
                    facing: { x: unit.facingX ?? 1, y: unit.facingY ?? 0 } });
            }
        }
        moveCombatUnits(alive, goals, this.bounds, this.steering, dt, previous, this.movementScratch, this.obstacles);
        for (const unit of alive) if (unit.action === 'walk') {
            const before = previous.get(unit.id)!, moved = distance(unit, before);
            if (moved < 1e-6) { if (!rangedAttack(unit.hero)) unit.action = 'idle'; }
            else { unit.facingX = (unit.x - before.x) / moved; unit.facingY = (unit.y - before.y) / moved; }
        }
        // Direct shots sweep through enemies; lobbed skills resolve an area around their impact.
        // Movement finished: use current positions for projectile and skill-collision broad phases.
        this.index[0].clear(); this.index[1].clear();
        for (const unit of alive) this.index[unit.team].add(unit);
        const nearby = this.nearby;
        const addDamage = (target: UnitState, amount: number, radius: number, maxTargets = Infinity): void => {
            damage.set(target.id, (damage.get(target.id) ?? 0) + amount);
            if (radius <= 0 || maxTargets <= 1) return;
            this.index[target.team].rect(target.x - radius, target.y - radius, target.x + radius, target.y + radius, nearby);
            nearby.sort((a, b) => distance(a, target) - distance(b, target) || a.id - b.id);
            let hits = 1;
            for (const victim of nearby) {
                if (victim.id === target.id || distance(victim, target) > radius) continue;
                if (hits >= maxTargets) break;
                damage.set(victim.id, (damage.get(victim.id) ?? 0) + amount);
                hits++;
            }
        };
        const candidates = this.candidates;
        const hits = this.candidateHits;
        let maxSpeed = 0;
        for (const unit of alive) maxSpeed = Math.max(maxSpeed, this.stats(unit).speed);
        const motionMargin = maxSpeed * dt;
        let projectileWrite = 0;
        for (let projectileIndex = 0; projectileIndex < this.projectiles.length; projectileIndex++) {
            const projectile = this.projectiles[projectileIndex];
            let keep = false;
            const travel = Math.max(0, Math.min(dt, projectile.duration - projectile.elapsed));
            const next = { x: projectile.x + projectile.vx * travel, y: projectile.y + projectile.vy * travel };
            if (projectile.arcHeight > 0) {
                projectile.elapsed += travel; projectile.x = next.x; projectile.y = next.y;
                if (projectile.elapsed + 1e-8 < projectile.duration) keep = true;
                else {
                    // Ballistic shots land at their authored point. Spell strikes may
                    // follow the locked body so a moving target still receives the hit.
                    const locked = this.byId.get(projectile.targetId);
                    const impact = projectile.seekTarget && locked && locked.hp > 0
                        ? { x: locked.x, y: locked.y } : projectile.to;
                    projectile.x = impact.x; projectile.y = impact.y;
                    const radius = projectile.hitRadius;
                    this.index[projectile.team === 0 ? 1 : 0].rect(impact.x - radius, impact.y - radius,
                        impact.x + radius, impact.y + radius, candidates);
                    hits.length = 0;
                    for (const enemy of candidates) if (enemy.hp > 0 && distance(enemy, projectile) <= radius) hits.push(enemy);
                    hits.sort((a, b) => distance(a, projectile) - distance(b, projectile) || a.id - b.id);
                    const primary = hits[0];
                    if (primary) addDamage(primary, projectile.damage, radius, projectile.maxTargets);
                    this.events.push({ ...projectile, to: { ...impact },
                        targetId: primary?.id ?? projectile.targetId, phase: 'impact' });
                }
            } else {
                let target: UnitState | undefined, first = Infinity;
                const margin = UNIT_RADIUS + projectile.radius + motionMargin;
                this.index[projectile.team === 0 ? 1 : 0].rect(Math.min(projectile.x, next.x) - margin, Math.min(projectile.y, next.y) - margin,
                    Math.max(projectile.x, next.x) + margin, Math.max(projectile.y, next.y) + margin, candidates);
                for (const enemy of candidates) {
                    const before = previous.get(enemy.id)!;
                    // Relative motion sweeps against a stationary circle, including moving targets.
                    const t = sweepCircle({ x: projectile.x - before.x, y: projectile.y - before.y },
                        { x: next.x - enemy.x, y: next.y - enemy.y }, { x: 0, y: 0 }, UNIT_RADIUS + projectile.radius);
                    if (t !== null && (t < first || (t === first && enemy.id < target!.id))) { first = t; target = enemy; }
                }
                if (target) {
                    addDamage(target, projectile.damage, projectile.hitRadius, projectile.maxTargets);
                    this.events.push({ ...projectile, to: { x: target.x, y: target.y }, targetId: target.id, phase: 'impact' });
                } else {
                    projectile.x = next.x; projectile.y = next.y; projectile.elapsed += travel;
                    keep = projectile.elapsed + 1e-8 < projectile.duration;
                }
            }
            if (keep) this.projectiles[projectileWrite++] = projectile;
        }
        this.projectiles.length = projectileWrite;
        let pendingWrite = 0;
        for (let pendingIndex = 0; pendingIndex < this.pending.length; pendingIndex++) {
            const attack = this.pending[pendingIndex];
            if (attack.due > this.elapsed + 1e-8) {
                this.pending[pendingWrite++] = attack;
                continue;
            }
            const attacker = this.byId.get(attack.event.attackerId), target = this.byId.get(attack.event.targetId);
            if (!attacker || attacker.hp <= 0 || !target || target.hp <= 0) continue;
            const event = { ...attack.event, from: { x: attacker.x, y: attacker.y }, to: { x: target.x, y: target.y } };
            // Projectiles aim at any bearing within range; only melee swings need a horizontal cone.
            if (attack.projectileSpeed > 0 ? distance(attacker, target) > this.stats(attacker).range + 1e-6
                : !meleeHits(attacker, target, attack.facing, this.stats(attacker).range)) continue;
            if (attack.projectileSpeed === 0 && this.obstacleBlocksMelee(attacker, target)) continue;
            if (attack.projectileSpeed > 0) {
                const shot = rangedAttack(attacker.hero)!;
                const d = Math.max(.001, distance(attacker, target)), range = Math.max(d, this.stats(attacker).range) + UNIT_RADIUS * 2;
                const duration = shot.arc ? clamp(d / shot.speed, shot.minFlight ?? .4, shot.maxFlight ?? 1.2) *
                    (shot.kind === 'arrow' ? this.config.rules.arrowFlightMultiplier : 1) : range / shot.speed;
                const projectile: ProjectileState = { ...event, x: attacker.x, y: attacker.y,
                    vx: (target.x - attacker.x) / (shot.arc ? duration : d / shot.speed),
                    vy: (target.y - attacker.y) / (shot.arc ? duration : d / shot.speed),
                    kind: shot.kind, radius: shot.radius,
                    hitRadius: Math.max(shot.hitRadius ?? 0, shot.radius + UNIT_RADIUS, event.splash),
                    maxTargets: Math.max(1, shot.maxTargets ?? (event.splash > 0 ? Number.MAX_SAFE_INTEGER : 1)),
                    seekTarget: shot.seekTarget ?? false,
                    arcHeight: shot.arc ? Math.max(shot.minArcHeight ?? 80, d * (shot.arcHeightRatio ?? .45)) : 0,
                    elapsed: 0, duration };
                this.projectiles.push(projectile); this.events.push({ ...event, phase: 'launch', duration: projectile.duration });
            } else {
                addDamage(target, event.damage, event.splash, Infinity); this.events.push({ ...event, phase: 'impact' });
            }
        }
        this.pending.length = pendingWrite;
        for (const unit of alive) {
            unit.hp = Math.max(0, unit.hp - (damage.get(unit.id) ?? 0));
            unit.x = clamp(unit.x, (this.bounds.centerX ?? 0) - this.bounds.x, (this.bounds.centerX ?? 0) + this.bounds.x);
            unit.y = clamp(unit.y, (this.bounds.centerY ?? 0) - this.bounds.y, (this.bounds.centerY ?? 0) + this.bounds.y);
        }
        const counts = this.counts, hp = this.totalHp, initial = this.initialHp;
        counts[0] = counts[1] = hp[0] = hp[1] = 0;
        for (const u of this.units) {
            hp[u.team] += u.hp;
            if (u.hp > 0) counts[u.team]++;
        }
        const arrowsInFlight = this.projectiles.some(p => counts[p.team === 0 ? 1 : 0] > 0);
        if ((counts[0] === 0 || counts[1] === 0) && !arrowsInFlight) {
            this.winner = counts[0] === counts[1] ? 'draw' : (counts[0] > 0 ? 0 : 1);
        } else if (this.elapsed >= this.config.rules.combatSeconds) {
            const difference = hp[0] / initial[0] - hp[1] / initial[1];
            this.winner = Math.abs(difference) < 0.0001 ? 'draw' : difference > 0 ? 0 : 1;
        }
    }

    summary(): { count: number[]; hp: number[] } {
        const count = [0, 0], hp = [0, 0];
        for (const u of this.units) { if (u.hp > 0) count[u.team]++; hp[u.team] += u.hp; }
        return { count, hp: hp.map(Math.ceil) };
    }
}
