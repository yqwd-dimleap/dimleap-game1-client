import { arenaEdges, clamp, Point, RULES, Team } from '../config/PrototypeConfig';
import type { CombatObstacle } from './CombatCollision';

export interface Shot { vx: number; vy: number; power: number }
export function shotFromDrag(dx: number, dy: number, team: number, maxDrag = RULES.maxDrag): Shot | null {
    const drag = Math.hypot(dx, dy);
    if (![dx, dy, maxDrag].every(Number.isFinite) || maxDrag <= RULES.minDrag || drag < RULES.minDrag) return null;
    // A launch must enter the arena, never point back through the launching rail.
    const forward = team === 0 ? 1 : -1;
    if (dy * forward <= 0 || Math.abs(dy) / drag + 1e-10 < Math.cos(RULES.maxLaunchAngle * Math.PI / 180)) return null;
    const power = clamp((drag - RULES.minDrag) / (maxDrag - RULES.minDrag), 0, 1);
    const speed = launchSpeed(power);
    return { vx: dx / drag * speed, vy: dy / drag * speed, power };
}

export function launchSpeed(power: number): number {
    return (RULES.minSpeed + (RULES.maxSpeed - RULES.minSpeed) * Math.pow(clamp(power, 0, 1), RULES.powerCurve)) * RULES.launchMultiplier;
}
export function powerFromSpeed(speed: number): number {
    return Math.pow(clamp((speed / RULES.launchMultiplier - RULES.minSpeed) / (RULES.maxSpeed - RULES.minSpeed), 0, 1), 1 / RULES.powerCurve);
}

export function clampedPull(dx: number, dy: number, team: Team, depth = RULES.maxDrag, halfWidth = RULES.maxDrag): Point {
    // Constrain the pouch itself to the launch cone, preserving the requested pull length.
    // Crossing an angle boundary keeps it on that boundary instead of snapping to centre.
    const sign = team === 0 ? 1 : -1;
    dy = sign * Math.max(0, dy * sign);
    const length = Math.hypot(dx, dy);
    if (length === 0) return { x: 0, y: 0 };
    const angle = RULES.maxLaunchAngle * Math.PI / 180;
    if (Math.atan2(Math.abs(dx), Math.abs(dy)) > angle) {
        dx = Math.sign(dx) * Math.sin(angle) * length;
        dy = sign * Math.cos(angle) * length;
    }
    const scale = Math.min(1, RULES.maxDrag / length, dy === 0 ? 1 : depth / Math.abs(dy), dx === 0 ? 1 : halfWidth / Math.abs(dx));
    return { x: dx * scale, y: dy * scale };
}
export function dragFromShot(shot: Shot, maxDrag = RULES.maxDrag): Point {
    const length = RULES.minDrag + shot.power * (maxDrag - RULES.minDrag);
    const speed = Math.hypot(shot.vx, shot.vy);
    return { x: shot.vx / speed * length, y: shot.vy / speed * length };
}

/** Discrete Box2D damping: v[n+1] = v[n] / (1 + damping * step). */
export function freeSlide(speed: number): { distance: number; seconds: number } {
    if (speed <= RULES.stopSpeed) return { distance: 0, seconds: 0 };
    const factor = 1 / (1 + RULES.damping * RULES.physicsStep);
    const steps = Math.ceil(Math.log(RULES.stopSpeed / speed) / Math.log(factor));
    return { distance: speed * RULES.ptm / RULES.damping * (1 - Math.pow(factor, steps)), seconds: steps * RULES.physicsStep };
}

/** A conservative energy envelope: equal-mass passive contacts cannot add kinetic energy. */
export function shotWaitLimit(speedEnvelope: number): number {
    return Math.max(RULES.maxShotSeconds, freeSlide(speedEnvelope).seconds + RULES.stopHold + 1);
}

/** Outside launches must reach the full-circle entry plane with a small positional reserve. */
export function canEnterArena(start: Point, shot: Shot): boolean {
    if (insideArena(start)) return true;
    const b = arenaEdges(RULES.tokenRadius + 4), speed = Math.hypot(shot.vx, shot.vy);
    if (!speed || !Number.isFinite(speed)) return false;
    const dx = shot.vx / speed, dy = shot.vy / speed;
    let near = 0, far = Infinity;
    for (const [p, d, lo, hi] of [[start.x, dx, b.left, b.right], [start.y, dy, b.bottom, b.top]]) {
        if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
        const a = (lo - p) / d, z = (hi - p) / d;
        near = Math.max(near, Math.min(a, z)); far = Math.min(far, Math.max(a, z));
    }
    return near <= far && far >= 0 && freeSlide(speed).distance >= near + 4;
}
export function insideArena(p: Point): boolean {
    const b = arenaEdges(RULES.tokenRadius);
    return p.x >= b.left && p.x <= b.right && p.y >= b.bottom && p.y <= b.top;
}

/** After settlement, place an escaped circle at the nearest free point inside the rails. */
export function settledTokenPosition(point: Point, occupied: readonly Point[]): Point {
    // A half pixel avoids waking a resting body through Box2D's wall/contact skin.
    const padding = Math.min(.5, (RULES.width - RULES.tokenRadius * 2) / 4, (RULES.height - RULES.tokenRadius * 2) / 4);
    const b = arenaEdges(RULES.tokenRadius + padding), gap = RULES.tokenRadius * 2 + .5;
    const origin = { x: Number.isFinite(point.x) ? point.x : RULES.centerX, y: Number.isFinite(point.y) ? point.y : RULES.centerY };
    const projected = { x: clamp(origin.x, b.left, b.right), y: clamp(origin.y, b.bottom, b.top) };
    const blockers = occupied.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    const free = (p: Point): boolean => p.x >= b.left - 1e-7 && p.x <= b.right + 1e-7 &&
        p.y >= b.bottom - 1e-7 && p.y <= b.top + 1e-7 && blockers.every(o => Math.hypot(p.x - o.x, p.y - o.y) >= gap - 1e-7);
    if (free(projected)) return projected;
    let best: Point | null = null, nearest = Infinity;
    const consider = (x: number, y: number): void => {
        const p = { x: clamp(x, b.left, b.right), y: clamp(y, b.bottom, b.top) };
        const d = Math.hypot(p.x - origin.x, p.y - origin.y);
        if (free(p) && d < nearest) { best = p; nearest = d; }
    };
    for (const x of [b.left, b.right]) for (const y of [b.bottom, b.top]) consider(x, y);
    for (let i = 0; i < blockers.length; i++) {
        const a = blockers[i], dx = origin.x - a.x, dy = origin.y - a.y, length = Math.hypot(dx, dy);
        if (length > 0) consider(a.x + dx / length * gap, a.y + dy / length * gap);
        // Nearest legal points lie on an exclusion circle, a rail, or their intersections.
        for (const x of [b.left, b.right]) if (Math.abs(x - a.x) <= gap) {
            const h = Math.sqrt(Math.max(0, gap * gap - (x - a.x) ** 2));
            consider(x, a.y - h); consider(x, a.y + h);
        }
        for (const y of [b.bottom, b.top]) if (Math.abs(y - a.y) <= gap) {
            const h = Math.sqrt(Math.max(0, gap * gap - (y - a.y) ** 2));
            consider(a.x - h, y); consider(a.x + h, y);
        }
        for (let j = 0; j < i; j++) {
            const z = blockers[j], x = z.x - a.x, y = z.y - a.y, d = Math.hypot(x, y);
            if (d < 1e-7 || d > gap * 2) continue;
            const h = Math.sqrt(Math.max(0, gap * gap - d * d / 4)), mx = (a.x + z.x) / 2, my = (a.y + z.y) / 2;
            consider(mx - y / d * h, my + x / d * h); consider(mx + y / d * h, my - x / d * h);
        }
    }
    // No free space is a possible authored-map condition. Keep the circle inside
    // rather than hiding it, retrying forever or moving any other settled token.
    return best ?? projected;
}

// Only an unoccupied-board direction guide: real impacts remain Box2D's responsibility.
// Both aiming and physics use the token centre and its collision radius.
export function guidePath(start: Point, shot: Shot, inset = RULES.tokenRadius, seconds = 2.2,
    obstacles: readonly CombatObstacle[] = []): Point[] {
    const points: Point[] = [];
    simulatePath(start, shot, inset, seconds, obstacles, (x, y) => points.push({ x, y }));
    return points;
}

/** Stream AI evaluation without allocating a full trajectory for every candidate. */
export function predictLanding(start: Point, shot: Shot, target?: Point,
    obstacles: readonly CombatObstacle[] = []): { end: Point; closest: number } {
    let closest = Infinity;
    const end = simulatePath(start, shot, RULES.tokenRadius, freeSlide(Math.hypot(shot.vx, shot.vy)).seconds, obstacles,
        target ? (x, y) => { closest = Math.min(closest, Math.hypot(x - target.x, y - target.y)); } : undefined);
    return { end, closest };
}

interface ObstacleHit { time: number; normal: Point }

function obstacleHit(from: Point, vx: number, vy: number, radius: number, obstacle: CombatObstacle): ObstacleHit | null {
    if (obstacle.kind === 'circle') {
        const expanded = obstacle.radius + radius;
        const x = from.x - obstacle.x, y = from.y - obstacle.y;
        const c = x * x + y * y - expanded * expanded;
        if (c <= 0) return null;
        const a = vx * vx + vy * vy;
        if (a < 1e-12) return null;
        const b = x * vx + y * vy, discriminant = b * b - a * c;
        if (discriminant < 0) return null;
        const time = (-b - Math.sqrt(discriminant)) / a;
        if (time < 0) return null;
        const nx = (from.x + vx * time - obstacle.x) / expanded;
        const ny = (from.y + vy * time - obstacle.y) / expanded;
        return { time, normal: { x: nx, y: ny } };
    }
    const cos = Math.cos(obstacle.angle), sin = Math.sin(obstacle.angle);
    const dx = from.x - obstacle.x, dy = from.y - obstacle.y;
    const ox = dx * cos + dy * sin, oy = -dx * sin + dy * cos;
    const lvx = vx * cos + vy * sin, lvy = -vx * sin + vy * cos;
    const halfX = obstacle.halfWidth + radius, halfY = obstacle.halfHeight + radius;
    let enter = -Infinity, exit = Infinity, normalX = 0, normalY = 0;
    for (const [origin, delta, min, max, axis] of [
        [ox, lvx, -halfX, halfX, 0], [oy, lvy, -halfY, halfY, 1],
    ] as const) {
        if (Math.abs(delta) < 1e-9) {
            if (origin < min || origin > max) return null;
            continue;
        }
        let first = (min - origin) / delta, second = (max - origin) / delta;
        let sign = -1;
        if (first > second) {
            [first, second] = [second, first];
            sign = 1;
        }
        if (first > enter) {
            enter = first;
            normalX = axis === 0 ? sign : 0;
            normalY = axis === 1 ? sign : 0;
        }
        exit = Math.min(exit, second);
        if (enter > exit) return null;
    }
    if (enter < 0 || enter > exit) return null;
    return { time: enter, normal: {
        x: normalX * cos - normalY * sin,
        y: normalX * sin + normalY * cos,
    } };
}

function simulatePath(start: Point, shot: Shot, inset: number, seconds: number,
    obstacles: readonly CombatObstacle[], visit?: (x: number, y: number) => void): Point {
    let x = start.x, y = start.y, vx = shot.vx * RULES.ptm, vy = shot.vy * RULES.ptm;
    visit?.(x, y);
    const b = arenaEdges(inset);
    const inside = (p: Point): boolean => p.x >= b.left && p.x <= b.right && p.y >= b.bottom && p.y <= b.top;
    let entered = inside(start);
    for (let i = 0; i < Math.ceil(seconds / RULES.physicsStep); i++) {
        if (Math.hypot(vx, vy) <= RULES.stopSpeed * RULES.ptm) break;
        vx /= 1 + RULES.damping * RULES.physicsStep; vy /= 1 + RULES.damping * RULES.physicsStep;
        let remaining = RULES.physicsStep;
        // Retain the actual contact point so the wide guide has sharp, joined banks.
        for (let contact = 0; remaining > 1e-8 && contact < 4; contact++) {
            const tx = vx > 1e-8 ? (b.right - x) / vx : vx < -1e-8 ? (b.left - x) / vx : Infinity;
            const ty = !entered ? Infinity : vy > 1e-8 ? (b.top - y) / vy : vy < -1e-8 ? (b.bottom - y) / vy : Infinity;
            let hit = Math.min(tx >= -1e-8 ? Math.max(0, tx) : Infinity,
                ty >= -1e-8 ? Math.max(0, ty) : Infinity);
            let solid: ObstacleHit | null = null;
            if (entered) for (const obstacle of obstacles) {
                const candidate = obstacleHit({ x, y }, vx, vy, inset, obstacle);
                if (candidate && candidate.time >= -1e-8 && (!solid || candidate.time < solid.time)) solid = candidate;
            }
            if (solid && solid.time < hit) hit = Math.max(0, solid.time);
            if (hit > remaining) { x += vx * remaining; y += vy * remaining; remaining = 0; break; }
            x += vx * hit; y += vy * hit; remaining -= hit;
            visit?.(x, y);
            let reflected = false;
            if (solid && Math.abs(solid.time - hit) <= 1e-7) {
                const speed = vx * solid.normal.x + vy * solid.normal.y;
                vx -= (1 + RULES.wallRestitution) * speed * solid.normal.x;
                vy -= (1 + RULES.wallRestitution) * speed * solid.normal.y;
                x += solid.normal.x * .01; y += solid.normal.y * .01;
                reflected = true;
            }
            if (Math.abs(tx - hit) < 1e-7) { vx *= -RULES.wallRestitution; reflected = true; }
            if (Math.abs(ty - hit) < 1e-7) { vy *= -RULES.wallRestitution; reflected = true; }
            if (!reflected) remaining = 0;
        }
        if (!entered && inside({ x, y })) entered = true;
        visit?.(x, y);
    }
    return { x, y };
}
