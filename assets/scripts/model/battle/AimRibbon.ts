import { Point, RULES } from '../config/PrototypeConfig';

export interface RibbonQuad { corners: Point[]; from: number; to: number; samples: Point[] }
export const AIM_RIBBON_WIDTH = RULES.tokenRadius * 2;

const cross = (a: Point, b: Point, p: Point): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const area = (polygon: readonly Point[]): number => polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.y - p.y * q.x;
}, 0) / 2;

/** Keep one side of a line. All stroke polygons are convex and counterclockwise. */
function clip(polygon: readonly Point[], a: Point, b: Point, sign: number): Point[] {
    const result: Point[] = [];
    let previous = polygon[polygon.length - 1], distance = cross(a, b, previous) * sign;
    for (const point of polygon) {
        const next = cross(a, b, point) * sign;
        if ((distance >= 0) !== (next >= 0)) {
            const t = distance / (distance - next);
            result.push({ x: previous.x + (point.x - previous.x) * t, y: previous.y + (point.y - previous.y) * t });
        }
        if (next >= 0) result.push(point);
        previous = point; distance = next;
    }
    return result;
}

/** Partition the difference, so retracing a bank never draws translucent colour twice. */
function subtract(polygon: Point[], cover: readonly Point[]): Point[][] {
    const bounds = (points: readonly Point[]): number[] => [Math.min(...points.map(p => p.x)), Math.max(...points.map(p => p.x)),
        Math.min(...points.map(p => p.y)), Math.max(...points.map(p => p.y))];
    const p = bounds(polygon), c = bounds(cover);
    if (p[1] <= c[0] || p[0] >= c[1] || p[3] <= c[2] || p[2] >= c[3]) return [polygon];
    const pieces: Point[][] = [];
    let remainder = polygon;
    for (let i = 0; i < cover.length && remainder.length >= 3; i++) {
        const a = cover[i], b = cover[(i + 1) % cover.length];
        const outside = clip(remainder, a, b, -1);
        if (outside.length >= 3 && area(outside) > 1e-6) pieces.push(outside);
        remainder = clip(remainder, a, b, 1);
    }
    return pieces;
}

/** Union of constant-width legs and round banks; neither short returns nor U-turns taper a leg. */
export function aimRibbonQuads(path: readonly Point[], width = AIM_RIBBON_WIDTH): RibbonQuad[] {
    if (!Number.isFinite(width) || width <= 0) return [];
    const turns: Point[] = [];
    for (const point of path) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        const last = turns[turns.length - 1];
        if (last && Math.hypot(point.x - last.x, point.y - last.y) <= .01) continue;
        if (turns.length > 1) {
            const a = turns[turns.length - 2], ux = last.x - a.x, uy = last.y - a.y;
            const vx = point.x - last.x, vy = point.y - last.y;
            if (ux * vx + uy * vy > 0 && Math.abs(ux * vy - uy * vx) < 1e-5 * Math.hypot(ux, uy) * Math.hypot(vx, vy)) turns.pop();
        }
        turns.push(point);
    }
    if (turns.length < 2) return [];
    const distances = [0];
    for (let i = 1; i < turns.length; i++) distances.push(distances[i - 1] + Math.hypot(turns[i].x - turns[i - 1].x, turns[i].y - turns[i - 1].y));
    const total = distances[distances.length - 1], half = width / 2;
    const covers: Point[][] = [], quads: RibbonQuad[] = [];
    const append = (polygon: Point[], sample: (point: Point) => Point): void => {
        let pieces = [polygon];
        for (const cover of covers) {
            const visible: Point[][] = [];
            for (const piece of pieces) visible.push(...subtract(piece, cover));
            pieces = visible;
        }
        for (const piece of pieces) {
            // Pair adjacent fan triangles into the standard Sprite's two triangles.
            for (let i = 1; i < piece.length - 1; i += 2) {
                const corners = [piece[0], piece[i], piece[i + 2] ?? piece[i + 1], piece[i + 1]];
                const samples = corners.map(sample), progress = samples.map(p => p.y);
                quads.push({ corners, samples, from: Math.min(...progress), to: Math.max(...progress) });
            }
        }
    };
    for (let i = 1; i < turns.length; i++) {
        const a = turns[i - 1], b = turns[i], length = distances[i] - distances[i - 1];
        const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length, nx = -uy, ny = ux;
        const rectangle = (start: number, end: number): Point[] => [
            { x: a.x + ux * start + nx * half, y: a.y + uy * start + ny * half },
            { x: a.x + ux * start - nx * half, y: a.y + uy * start - ny * half },
            { x: a.x + ux * end - nx * half, y: a.y + uy * end - ny * half },
            { x: a.x + ux * end + nx * half, y: a.y + uy * end + ny * half },
        ];
        const sample = (p: Point): Point => ({
            x: Math.max(0, Math.min(1, .5 - ((p.x - a.x) * nx + (p.y - a.y) * ny) / width)),
            y: Math.max(0, Math.min(1, (distances[i - 1] + (p.x - a.x) * ux + (p.y - a.y) * uy) / total)),
        });
        // Bound alpha/texture interpolation along long legs, independently of physical time samples.
        const count = Math.max(1, Math.ceil(length / 80));
        for (let j = 0; j < count; j++) append(rectangle(length * j / count, length * (j + 1) / count), sample);
        covers.push(rectangle(0, length));
        if (i < turns.length - 1) {
            // A full contact disk also handles a head-on reflection, where offset lines never meet.
            // Axis samples make the exterior touch the rail exactly at arbitrary aiming angles.
            const disk = Array.from({ length: 48 }, (_, j) => ({
                x: b.x + half * Math.cos(j * Math.PI / 24), y: b.y + half * Math.sin(j * Math.PI / 24),
            }));
            append(disk, p => ({ x: sample(p).x, y: distances[i] / total }));
            covers.push(disk);
        }
    }
    return quads;
}
