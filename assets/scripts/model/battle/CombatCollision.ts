import { Point, Team } from '../config/PrototypeConfig';
import { CombatSpatial } from './CombatSpatial';

/** Circles match unit separation; continuous sweeps prevent high speed arrows tunnelling. */
export const UNIT_RADIUS = 16;
export const ARROW_RADIUS = 3;
/** Opposing troops keep this spacing; allies may overlap and pass through. */
export const UNIT_SPACING = 48;
/** Keep routed bodies clear of contact skin; only the routing nodes receive this margin. */
const ROUTE_CLEARANCE = 6;
/** Prevent Box2D contact skin from turning a valid path step into a zero-length step. */
const MOVEMENT_CLEARANCE = .75;
/** A walking unit that cannot make meaningful progress for this long is treated as stuck. */
const STUCK_DISTANCE = 6;
const STUCK_SECONDS = .8;
interface MovingUnit extends Point { id: number; team: Team }
export interface CombatBounds { x: number; y: number; centerX?: number; centerY?: number }
export type CombatObstacle =
    | { id?: string; kind: 'circle'; x: number; y: number; radius: number }
    | { id?: string; kind: 'box'; x: number; y: number; halfWidth: number; halfHeight: number; angle: number };
export interface SteeringState {
    side: number;
    blockedFor: number;
    anchorX?: number;
    anchorY?: number;
    stalledFor?: number;
}
export interface CombatMovementScratch {
    readonly index: [CombatSpatial<MovingUnit>, CombatSpatial<MovingUnit>];
    readonly reserved: Map<number, Point>;
    readonly positions: Map<number, Point>;
    readonly routes: Map<number, { points: Point[]; index: number }>;
}

export function createCombatMovementScratch(): CombatMovementScratch {
    return {
        index: [new CombatSpatial<MovingUnit>(), new CombatSpatial<MovingUnit>()],
        reserved: new Map(),
        positions: new Map(),
        routes: new Map(),
    };
}

/** Enter at ~24 degrees; an engaged unit may keep attacking up to ~33 degrees. */
export const APPROACH_SLOPE = .45;
export const ATTACK_SLOPE = .65;
export function attackAligned(origin: Point, target: Point, slope = ATTACK_SLOPE): boolean {
    const x = Math.abs(target.x - origin.x), y = Math.abs(target.y - origin.y);
    return x > 1e-6 && y <= x * slope + 1e-6;
}

/** Solid obstacle test for a unit body. Tangency is permitted; crossing or overlap is not. */
export function circleIntersectsObstacle(point: Point, radius: number, obstacle: CombatObstacle): boolean {
    const tolerance = 1e-5;
    if (obstacle.kind === 'circle') {
        return Math.hypot(point.x - obstacle.x, point.y - obstacle.y) < radius + obstacle.radius - tolerance;
    }
    const cos = Math.cos(obstacle.angle), sin = Math.sin(obstacle.angle);
    const dx = point.x - obstacle.x, dy = point.y - obstacle.y;
    const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
    const outsideX = Math.max(0, Math.abs(localX) - obstacle.halfWidth);
    const outsideY = Math.max(0, Math.abs(localY) - obstacle.halfHeight);
    return outsideX * outsideX + outsideY * outsideY < radius * radius - tolerance;
}

function segmentHitsExpandedBox(from: Point, to: Point, minX: number, minY: number, maxX: number, maxY: number): boolean {
    const dx = to.x - from.x, dy = to.y - from.y;
    let enter = 0, exit = 1;
    for (const [origin, delta, min, max] of [[from.x, dx, minX, maxX], [from.y, dy, minY, maxY]] as const) {
        if (Math.abs(delta) < 1e-9) {
            if (origin < min || origin > max) return false;
            continue;
        }
        let first = (min - origin) / delta, second = (max - origin) / delta;
        if (first > second) [first, second] = [second, first];
        enter = Math.max(enter, first);
        exit = Math.min(exit, second);
        if (enter > exit) return false;
    }
    return exit >= 0 && enter <= 1;
}

function pointSegmentDistanceSq(point: Point, from: Point, to: Point): number {
    const dx = to.x - from.x, dy = to.y - from.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq < 1e-12 ? 0 :
        Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq));
    const x = from.x + dx * t - point.x, y = from.y + dy * t - point.y;
    return x * x + y * y;
}

function segmentBoxDistanceSq(from: Point, to: Point, halfWidth: number, halfHeight: number): number {
    if (segmentHitsExpandedBox(from, to, -halfWidth, -halfHeight, halfWidth, halfHeight)) return 0;
    const pointBox = (point: Point): number => {
        const dx = Math.max(0, Math.abs(point.x) - halfWidth);
        const dy = Math.max(0, Math.abs(point.y) - halfHeight);
        return dx * dx + dy * dy;
    };
    const corners = [
        { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight },
    ];
    let result = Math.min(pointBox(from), pointBox(to));
    for (const corner of corners) result = Math.min(result, pointSegmentDistanceSq(corner, from, to));
    return result;
}

/** Swept test prevents a fast body from jumping across a thin collider in one step. */
export function segmentIntersectsObstacle(from: Point, to: Point, radius: number, obstacle: CombatObstacle): boolean {
    const tolerance = 1e-5;
    if (obstacle.kind === 'circle') {
        const dx = to.x - from.x, dy = to.y - from.y;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq < 1e-12 ? 0 :
            Math.max(0, Math.min(1, ((obstacle.x - from.x) * dx + (obstacle.y - from.y) * dy) / lengthSq));
        return Math.hypot(from.x + dx * t - obstacle.x, from.y + dy * t - obstacle.y) <
            radius + obstacle.radius - tolerance;
    }
    const cos = Math.cos(obstacle.angle), sin = Math.sin(obstacle.angle);
    const local = (point: Point): Point => {
        const dx = point.x - obstacle.x, dy = point.y - obstacle.y;
        return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
    };
    const a = local(from), b = local(to);
    return segmentBoxDistanceSq(a, b, obstacle.halfWidth, obstacle.halfHeight) < radius * radius - tolerance;
}

/** Approach a side of the enemy, orbiting nearby bodies rather than cutting through them. */
export function engagementGoal(unit: Point, target: Point, range: number, side: number, offset: number,
    step: number, bounds: CombatBounds, output: Point = { x: 0, y: 0 }): Point {
    const x = unit.x - target.x, y = unit.y - target.y, d = Math.hypot(x, y);
    const reach = Math.max(0, range - 4);
    if (d > 1e-6 && d <= range + UNIT_SPACING && !attackAligned(unit, target, APPROACH_SLOPE)) {
        const bearing = Math.atan2(y, x), desired = Math.atan2(offset, side * reach);
        const turn = Math.atan2(Math.sin(desired - bearing), Math.cos(desired - bearing));
        const radial = Math.max(-step * .25, Math.min(step * .25, Math.max(UNIT_SPACING + 2, reach) - d));
        const angle = Math.min(Math.abs(turn), Math.sqrt(Math.max(0, step * step - radial * radial)) / d) * Math.sign(turn);
        output.x = target.x + (d + radial) * Math.cos(bearing + angle);
        output.y = target.y + (d + radial) * Math.sin(bearing + angle);
    } else if (attackAligned(unit, target, APPROACH_SLOPE)) {
        const amount = Math.min(step, Math.max(0, d - reach));
        output.x = unit.x - x / d * amount;
        output.y = unit.y - y / d * amount;
    } else {
        output.x = target.x + side * reach;
        output.y = target.y + offset;
    }
    const cx = bounds.centerX ?? 0, cy = bounds.centerY ?? 0;
    output.x = Math.max(cx - bounds.x, Math.min(cx + bounds.x, output.x));
    output.y = Math.max(cy - bounds.y, Math.min(cy + bounds.y, output.y));
    const length = Math.hypot(output.x - unit.x, output.y - unit.y);
    const ratio = length > step ? step / length : 1;
    output.x = unit.x + (output.x - unit.x) * ratio;
    output.y = unit.y + (output.y - unit.y) * ratio;
    return output;
}

export function combatSpawn(preferred: Point, enemies: readonly Point[], bounds: CombatBounds,
    obstacles: readonly CombatObstacle[] = []): Point {
    const cx = bounds.centerX ?? 0, cy = bounds.centerY ?? 0;
    const limit = Math.ceil(Math.hypot(bounds.x * 2, bounds.y * 2) / UNIT_SPACING) + 1;
    for (let ring = 0; ring <= limit; ring++) {
        for (let y = -ring; y <= ring; y++) for (let x = -ring; x <= ring; x++) {
            if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
            const p = { x: Math.max(cx - bounds.x, Math.min(cx + bounds.x, preferred.x + x * UNIT_SPACING)),
                y: Math.max(cy - bounds.y, Math.min(cy + bounds.y, preferred.y + y * UNIT_SPACING)) };
            if (enemies.every(other => Math.hypot(other.x - p.x, other.y - p.y) >= UNIT_SPACING - 1e-6) &&
                obstacles.every(obstacle => !circleIntersectsObstacle(p, UNIT_RADIUS, obstacle))) return p;
        }
    }
    throw new Error('No free space for combat deployment');
}

function segmentClear(from: Point, to: Point, radius: number, obstacles: readonly CombatObstacle[]): boolean {
    return obstacles.every(obstacle => !segmentIntersectsObstacle(from, to, radius, obstacle));
}

function navigationPoints(obstacles: readonly CombatObstacle[], radius: number, bounds: CombatBounds): Point[] {
    const cx = bounds.centerX ?? 0, cy = bounds.centerY ?? 0, result: Point[] = [];
    const add = (point: Point): void => {
        if (point.x >= cx - bounds.x && point.x <= cx + bounds.x &&
            point.y >= cy - bounds.y && point.y <= cy + bounds.y) result.push(point);
    };
    for (const obstacle of obstacles) {
        if (obstacle.kind === 'circle') {
            const r = obstacle.radius + radius + ROUTE_CLEARANCE;
            for (const [sx, sy] of [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]])
                add({ x: obstacle.x + sx * r, y: obstacle.y + sy * r });
        } else {
            const cos = Math.cos(obstacle.angle), sin = Math.sin(obstacle.angle);
            const hx = obstacle.halfWidth + radius + ROUTE_CLEARANCE;
            const hy = obstacle.halfHeight + radius + ROUTE_CLEARANCE;
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
                add({ x: obstacle.x + sx * hx * cos - sy * hy * sin,
                    y: obstacle.y + sx * hx * sin + sy * hy * cos });
        }
    }
    return result;
}

/** Bounded A* fallback for overlapping rails and compound corners where raw corner visibility has no portal. */
function gridRoute(start: Point, goal: Point, bounds: CombatBounds, radius: number,
    obstacles: readonly CombatObstacle[]): Point[] | null {
    const cx = bounds.centerX ?? 0, cy = bounds.centerY ?? 0, cell = 12;
    const minX = cx - bounds.x, minY = cy - bounds.y;
    const cols = Math.floor(bounds.x * 2 / cell) + 1;
    const rows = Math.floor(bounds.y * 2 / cell) + 1;
    if (cols < 2 || rows < 2 || cols * rows > 8000) return null;
    const total = cols * rows, clearance = radius + ROUTE_CLEARANCE;
    const blocked = new Uint8Array(total);
    const center = (id: number): Point => ({ x: minX + (id % cols) * cell, y: minY + Math.floor(id / cols) * cell });
    const isBlocked = (id: number): boolean => {
        if (blocked[id] !== 0) return blocked[id] === 2;
        const point = center(id);
        const solid = point.x < minX || point.x > cx + bounds.x || point.y < minY || point.y > cy + bounds.y ||
            obstacles.some(obstacle => circleIntersectsObstacle(point, clearance, obstacle));
        blocked[id] = solid ? 2 : 1;
        return solid;
    };
    const nearestFree = (point: Point): number => {
        const baseX = Math.max(0, Math.min(cols - 1, Math.round((point.x - minX) / cell)));
        const baseY = Math.max(0, Math.min(rows - 1, Math.round((point.y - minY) / cell)));
        for (let ring = 0; ring <= 8; ring++) {
            let best = -1, distanceSq = Infinity;
            for (let y = baseY - ring; y <= baseY + ring; y++) for (let x = baseX - ring; x <= baseX + ring; x++) {
                if (x < 0 || x >= cols || y < 0 || y >= rows || Math.max(Math.abs(x - baseX), Math.abs(y - baseY)) !== ring) continue;
                const id = y * cols + x;
                if (isBlocked(id)) continue;
                const p = center(id), d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
                if (d < distanceSq) { best = id; distanceSq = d; }
            }
            if (best >= 0) return best;
        }
        return -1;
    };
    const from = nearestFree(start), to = nearestFree(goal);
    if (from < 0 || to < 0) return null;
    if (from === to) return segmentClear(start, goal, radius, obstacles) ? [{ ...goal }] : null;
    const scores = new Float64Array(total); scores.fill(Infinity);
    const previous = new Int32Array(total); previous.fill(-1);
    const closed = new Uint8Array(total);
    const heap: { id: number; score: number }[] = [];
    const push = (id: number, score: number): void => {
        heap.push({ id, score });
        for (let child = heap.length - 1; child > 0;) {
            const parent = (child - 1) >> 1;
            if (heap[parent].score <= heap[child].score) break;
            [heap[parent], heap[child]] = [heap[child], heap[parent]];
            child = parent;
        }
    };
    const pop = (): number => {
        const top = heap[0].id, tail = heap.pop()!;
        if (heap.length) {
            heap[0] = tail;
            for (let parent = 0;;) {
                const left = parent * 2 + 1, right = left + 1;
                let next = parent;
                if (left < heap.length && heap[left].score < heap[next].score) next = left;
                if (right < heap.length && heap[right].score < heap[next].score) next = right;
                if (next === parent) break;
                [heap[parent], heap[next]] = [heap[next], heap[parent]];
                parent = next;
            }
        }
        return top;
    };
    const heuristic = (id: number): number => {
        const a = center(id), b = center(to);
        return Math.hypot(a.x - b.x, a.y - b.y);
    };
    scores[from] = 0;
    push(from, heuristic(from));
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (heap.length) {
        const current = pop();
        if (closed[current]) continue;
        if (current === to) break;
        closed[current] = 1;
        const x = current % cols, y = Math.floor(current / cols), a = center(current);
        for (const [dx, dy] of directions) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            const next = ny * cols + nx;
            if (closed[next] || isBlocked(next)) continue;
            const b = center(next);
            if (dx && dy && (!segmentClear(a, b, clearance, obstacles))) continue;
            if (!segmentClear(a, b, radius, obstacles)) continue;
            const score = scores[current] + Math.hypot(b.x - a.x, b.y - a.y);
            if (score >= scores[next]) continue;
            scores[next] = score;
            previous[next] = current;
            push(next, score + heuristic(next));
        }
    }
    if (previous[to] < 0) return null;
    const raw: Point[] = [];
    for (let id = to; id !== from && id >= 0; id = previous[id]) raw.push(center(id));
    raw.reverse();
    if (!raw.length || !segmentClear(start, raw[0], radius, obstacles)) raw.unshift({ ...start });
    const last = raw[raw.length - 1];
    if (segmentClear(last, goal, radius, obstacles)) raw.push({ ...goal });
    const simplified: Point[] = [];
    let anchor = start, fromIndex = 0;
    while (fromIndex < raw.length) {
        let next = raw.length - 1;
        while (next > fromIndex && !segmentClear(anchor, raw[next], radius, obstacles)) next--;
        simplified.push(raw[next]);
        anchor = raw[next];
        fromIndex = next + 1;
    }
    return simplified;
}

/** Small visibility graph around blocker outlines; cheaper than a whole-arena grid search. */
function obstacleRoute(start: Point, goal: Point, bounds: CombatBounds, radius: number,
    obstacles: readonly CombatObstacle[]): Point[] {
    if (segmentClear(start, goal, radius, obstacles)) return [{ ...goal }];
    let destination = goal;
    if (obstacles.some(obstacle => circleIntersectsObstacle(goal, radius, obstacle))) {
        let dx = goal.x - start.x, dy = goal.y - start.y, length = Math.hypot(dx, dy);
        if (length <= 1e-9) {
            const blocker = obstacles.find(obstacle => circleIntersectsObstacle(goal, radius, obstacle));
            dx = blocker ? goal.x - blocker.x : 0; dy = blocker ? goal.y - blocker.y : 1;
            length = Math.hypot(dx, dy) || 1;
        }
        destination = {
            x: goal.x + dx / length * UNIT_SPACING * 2,
            y: goal.y + dy / length * UNIT_SPACING * 2,
        };
    }
    const waypoints = navigationPoints(obstacles, radius, bounds);
    const points = [start, ...waypoints, destination];
    const count = points.length, distances = Array<number>(count).fill(Infinity);
    const previous = Array<number>(count).fill(-1), visited = Array<boolean>(count).fill(false);
    distances[0] = 0;
    for (let step = 0; step < count; step++) {
        let current = -1;
        for (let index = 0; index < count; index++)
            if (!visited[index] && (current < 0 || distances[index] < distances[current])) current = index;
        if (current < 0 || !Number.isFinite(distances[current])) break;
        if (current === count - 1) break;
        visited[current] = true;
        for (let next = 1; next < count; next++) {
            if (next === current || visited[next] || !segmentClear(points[current], points[next], radius, obstacles)) continue;
            const cost = distances[current] + Math.hypot(points[next].x - points[current].x, points[next].y - points[current].y);
            if (cost < distances[next]) { distances[next] = cost; previous[next] = current; }
        }
    }
    if (previous[count - 1] < 0) return gridRoute(start, destination, bounds, radius, obstacles) ?? [{ ...destination }];
    const raw: Point[] = [];
    for (let index = count - 1; index > 0; index = previous[index]) {
        raw.push(points[index]);
        if (previous[index] < 0) break;
    }
    raw.reverse();
    // String-pull the visibility graph so units take long clear legs where possible.
    const route: Point[] = [];
    let anchor = start, from = 0;
    while (from < raw.length) {
        let next = raw.length - 1;
        while (next > from && !segmentClear(anchor, raw[next], radius, obstacles)) next--;
        route.push(raw[next]);
        anchor = raw[next];
        from = next + 1;
    }
    return route;
}

/** Reserve paths against opponents only. No friendly blocking, repulsion, or displacement. */
export function moveCombatUnits(units: readonly MovingUnit[], goals: ReadonlyMap<number, Point>, bounds: CombatBounds,
    steering?: Map<number, SteeringState>, dt = 1 / 30, startPositions?: ReadonlyMap<number, Point>,
    scratch: CombatMovementScratch = createCombatMovementScratch(),
    obstacles: readonly CombatObstacle[] = []): void {
    let ordered: readonly MovingUnit[] = units;
    for (let i = 1; i < units.length; i++) if (units[i - 1].id > units[i].id) {
        ordered = [...units].sort((a, b) => a.id - b.id);
        break;
    }
    const cx = bounds.centerX ?? 0, cy = bounds.centerY ?? 0;
    let before = startPositions;
    if (!before) {
        before = scratch.positions;
        scratch.positions.clear();
        for (const unit of ordered) scratch.positions.set(unit.id, { x: unit.x, y: unit.y });
    }
    const { reserved, index, routes } = scratch;
    index[0].clear(); index[1].clear(); reserved.clear();
    let maxStep = 0;
    for (const unit of ordered) {
        index[unit.team].add(unit);
        const goal = goals.get(unit.id);
        if (goal) maxStep = Math.max(maxStep, Math.hypot(goal.x - unit.x, goal.y - unit.y));
    }
    const neighbours: MovingUnit[] = [];
    for (const unit of ordered) {
        const start = before.get(unit.id)!, goal = goals.get(unit.id);
        let next = start;
        if (goal) {
            const reach = UNIT_SPACING + 2 * maxStep + 1e-6;
            index[unit.team === 0 ? 1 : 0].rect(start.x - reach, start.y - reach, start.x + reach, start.y + reach, neighbours);
            let steer = goal;
            let advancedRoute = false;
            if (obstacles.length) {
                let route = routes.get(unit.id);
                // A live target moves every simulation tick. Rebuilding a visibility route
                // as soon as its final goal drifts makes units alternate sides at long walls.
                // Keep the committed detour until its final leg is reached.
                if (route && route.index >= route.points.length - 1 &&
                    segmentClear(start, goal, UNIT_RADIUS, obstacles)) {
                    routes.delete(unit.id);
                    route = undefined;
                }
                // Follow an in-progress detour to its far-side clearance point. Rechecking
                // only the next short step can look clear while the body is still hugging
                // a blocker, which caused units to alternate directions at fence corners.
                if (!route && !segmentClear(start, goal, UNIT_RADIUS, obstacles)) {
                    route = {
                        points: obstacleRoute(start, goal, bounds, UNIT_RADIUS, obstacles),
                        index: 0,
                    };
                    routes.set(unit.id, route);
                }
                if (route) {
                    const endpoint = route.points[route.points.length - 1];
                    if (segmentClear(endpoint, goal, UNIT_RADIUS, obstacles)) {
                        endpoint.x = goal.x;
                        endpoint.y = goal.y;
                    }
                    // Advance only when the shortcut to the next leg is itself clear.
                    // Skipping a corner by raw proximity can cut through the expanded edge.
                    while (route.index < route.points.length - 1) {
                        const waypoint = route.points[route.index];
                        const following = route.points[route.index + 1];
                        const reached = Math.hypot(start.x - waypoint.x, start.y - waypoint.y) <= 6;
                        if (!reached || !segmentClear(start, following, UNIT_RADIUS, obstacles)) break;
                        route.index++;
                        advancedRoute = true;
                    }
                    steer = route.points[route.index] ?? goal;
                    if (route.index >= route.points.length) routes.delete(unit.id);
                }
            }
            const requestedX = goal.x - start.x, requestedY = goal.y - start.y;
            const requestedLength = Math.hypot(requestedX, requestedY);
            const steerX = steer.x - start.x, steerY = steer.y - start.y;
            const steerLength = Math.hypot(steerX, steerY);
            const positionMap = before!;
            // Preserve the exact requested step unless a navigation waypoint redirects it.
            const dx = steer !== goal && steerLength > 1e-9 ? steerX / steerLength * requestedLength : requestedX;
            const dy = steer !== goal && steerLength > 1e-9 ? steerY / steerLength * requestedLength : requestedY;
            const state = steering?.get(unit.id) ?? { side: 0, blockedFor: 0 };
            if (state.anchorX === undefined || state.anchorY === undefined) {
                state.anchorX = start.x;
                state.anchorY = start.y;
                state.stalledFor = 0;
            }
            state.stalledFor = (state.stalledFor ?? 0) + dt;
            if (advancedRoute) {
                state.anchorX = start.x;
                state.anchorY = start.y;
                state.stalledFor = 0;
                state.side = 0;
                state.blockedFor = 0;
            }
            const clearCandidate = (candidate: Point): boolean => {
                if (Math.abs(candidate.x - cx) > bounds.x || Math.abs(candidate.y - cy) > bounds.y) return false;
                if (obstacles.some(obstacle =>
                    segmentIntersectsObstacle(start, candidate, UNIT_RADIUS + MOVEMENT_CLEARANCE, obstacle))) return false;
                for (const other of neighbours) {
                    if (other.id === unit.id) continue;
                    const a = positionMap.get(other.id)!, b = reserved.get(other.id) ?? a;
                    const rx = start.x - a.x, ry = start.y - a.y;
                    const vx = candidate.x - start.x - (b.x - a.x), vy = candidate.y - start.y - (b.y - a.y);
                    const vv = vx * vx + vy * vy;
                    const t = vv < 1e-12 ? 0 : Math.max(0, Math.min(1, -(rx * vx + ry * vy) / vv));
                    const clearance = Math.min(UNIT_SPACING, Math.hypot(rx, ry));
                    if (Math.hypot(rx + vx * t, ry + vy * t) < clearance - 1e-6) return false;
                }
                return true;
            };
            if (steer !== goal) {
                const routed = { x: start.x + dx, y: start.y + dy };
                if (clearCandidate(routed)) next = routed;
            }
            // Keep going around the same side of a crowd. Choosing +90/-90 anew each
            // step can send a soldier back over its last step indefinitely.
            const angleCount = state.side === 0 || state.blockedFor < .2 ? (state.side === 0 ? 7 : 4) : 7;
            for (let i = 0; next === start && i < angleCount; i++) {
                let angle = 0;
                if (state.side === 0) {
                    angle = i === 1 ? Math.PI / 6 : i === 2 ? -Math.PI / 6 : i === 3 ? Math.PI / 3 :
                        i === 4 ? -Math.PI / 3 : i === 5 ? Math.PI / 2 : i === 6 ? -Math.PI / 2 : 0;
                } else if (i > 0) {
                    const divisor = i === 1 || i === 4 ? 6 : i === 2 || i === 5 ? 3 : 2;
                    angle = state.side * Math.PI / divisor * (i >= 4 ? -1 : 1);
                }
                const c = Math.cos(angle), s = Math.sin(angle);
                const candidate = { x: start.x + dx * c - dy * s, y: start.y + dx * s + dy * c };
                if (clearCandidate(candidate)) {
                    next = candidate;
                    if (angle !== 0) state.side = Math.sign(angle);
                    break;
                }
            }
            state.blockedFor = next === start ? state.blockedFor + dt : 0;
            if ((state.stalledFor ?? 0) >= STUCK_SECONDS) {
                const madeProgress = Math.hypot(start.x - state.anchorX, start.y - state.anchorY) >= STUCK_DISTANCE;
                if (!madeProgress) {
                    const startBlocked = obstacles.some(obstacle =>
                        circleIntersectsObstacle(start, UNIT_RADIUS + MOVEMENT_CLEARANCE, obstacle));
                    const recoveryClear = (candidate: Point): boolean => {
                        if (Math.abs(candidate.x - cx) > bounds.x || Math.abs(candidate.y - cy) > bounds.y) return false;
                        if (obstacles.some(obstacle =>
                            circleIntersectsObstacle(candidate, UNIT_RADIUS + MOVEMENT_CLEARANCE, obstacle))) return false;
                        if (!startBlocked && obstacles.some(obstacle =>
                            segmentIntersectsObstacle(start, candidate, UNIT_RADIUS + MOVEMENT_CLEARANCE, obstacle))) return false;
                        for (const other of neighbours) {
                            if (other.id === unit.id) continue;
                            const position = reserved.get(other.id) ?? positionMap.get(other.id)!;
                            if (Math.hypot(candidate.x - position.x, candidate.y - position.y) < UNIT_SPACING - 1e-6)
                                return false;
                        }
                        return true;
                    };
                    let recovery: Point | null = null, recoveryScore = Infinity;
                    for (const distance of [UNIT_RADIUS / 2, UNIT_RADIUS, UNIT_RADIUS + 8, UNIT_SPACING]) {
                        for (let i = 0; i < 24; i++) {
                            const angle = i * Math.PI / 12;
                            const candidate = {
                                x: start.x + Math.cos(angle) * distance,
                                y: start.y + Math.sin(angle) * distance,
                            };
                            if (!recoveryClear(candidate)) continue;
                            const score = Math.hypot(candidate.x - goal.x, candidate.y - goal.y) + distance * .25;
                            if (score < recoveryScore) {
                                recovery = candidate;
                                recoveryScore = score;
                            }
                        }
                        if (recovery) break;
                    }
                    if (recovery) {
                        next = recovery;
                        routes.delete(unit.id);
                        state.side = state.side === 0 ? (unit.id % 2 === 0 ? 1 : -1) : -state.side;
                        state.blockedFor = 0;
                    }
                }
                state.anchorX = next.x;
                state.anchorY = next.y;
                state.stalledFor = 0;
            }
            steering?.set(unit.id, state);
        }
        reserved.set(unit.id, next);
    }
    for (const unit of units) {
        const next = reserved.get(unit.id)!;
        unit.x = next.x; unit.y = next.y;
    }
}
export function sweepCircle(from: Point, to: Point, center: Point, radius: number): number | null {
    const x = from.x - center.x, y = from.y - center.y;
    const dx = to.x - from.x, dy = to.y - from.y, c = x * x + y * y - radius * radius;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    if (a < 1e-12) return null;
    const b = x * dx + y * dy, discriminant = b * b - a * c;
    if (discriminant < 0) return null;
    const t = (-b - Math.sqrt(discriminant)) / a;
    return t >= 0 && t <= 1 ? t : null;
}
export function meleeHits(origin: Point, target: Point, facing: Point, range: number): boolean {
    const dx = target.x - origin.x, dy = target.y - origin.y;
    // Contact closes the attack window regardless of bearing. The horizontal cone is
    // only an approach preference; otherwise a crowded vertical pile can orbit forever.
    return Math.hypot(dx, dy) <= range + 1e-6;
}
