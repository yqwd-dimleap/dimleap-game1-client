import type { Point, Zone } from './types';

/** A single occupied buffer zone can add at most three troops, regardless of icon count. */
export const MAX_ZONE_BONUS = 3;
export interface MapBounds { width: number; height: number; centerX?: number; centerY?: number }
export interface ZoneBounds { left: number; right: number; bottom: number; top: number }

/** The token centre owns a zone; polygon edges are included. Points are relative to the zone centre. */
export function zoneContains(point: Point, zone: Zone): boolean {
    const x = point.x - zone.x, y = point.y - zone.y, vertices = zone.polygon;
    if (!vertices) return Math.hypot(x, y) <= zone.radius;
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const a = vertices[j], b = vertices[i], dx = b.x - a.x, dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length > 0 && Math.abs((x - a.x) * dy - (y - a.y) * dx) <= 1e-6 * length &&
            (x - a.x) * (x - b.x) + (y - a.y) * (y - b.y) <= 1e-6) return true;
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

export function zoneBounds(zone: Zone): ZoneBounds {
    const vertices = zone.polygon ?? [{ x: -zone.radius, y: -zone.radius }, { x: zone.radius, y: zone.radius }];
    return { left: zone.x + Math.min(...vertices.map(p => p.x)), right: zone.x + Math.max(...vertices.map(p => p.x)),
        bottom: zone.y + Math.min(...vertices.map(p => p.y)), top: zone.y + Math.max(...vertices.map(p => p.y)) };
}

function copy(zone: Zone): Zone { return { ...zone, polygon: zone.polygon?.map(p => ({ ...p })) }; }
function limits(zone: Zone, arena: MapBounds, margin: number): ZoneBounds {
    const cx = arena.centerX ?? 0, cy = arena.centerY ?? 0;
    if (![arena.width, arena.height, cx, cy, margin].every(Number.isFinite) || arena.width <= 0 || arena.height <= 0 || margin < 0)
        throw new Error('Invalid map bounds or edge margin');
    const b = zoneBounds({ ...zone, x: 0, y: 0 });
    const result = { left: cx - arena.width / 2 + margin - b.left, right: cx + arena.width / 2 - margin - b.right,
        bottom: cy - arena.height / 2 + margin - b.bottom, top: cy + arena.height / 2 - margin - b.top };
    if (result.left > result.right || result.bottom > result.top) throw new Error(`Zone does not fit arena: ${zone.id}`);
    return result;
}

export function validateZones(zones: readonly Zone[]): void {
    const ids = new Set<string>();
    if (!zones.length) throw new Error('Battle map has no zones');
    for (const zone of zones) {
        if (!zone.id || ids.has(zone.id)) throw new Error(`Duplicate or empty zone id: ${zone.id}`);
        ids.add(zone.id);
        if (![zone.x, zone.y, zone.radius, zone.bonus].every(Number.isFinite) || zone.radius <= 0 ||
            !Number.isInteger(zone.bonus) || zone.bonus < 0 || zone.bonus > MAX_ZONE_BONUS)
            throw new Error(`Invalid zone bonus: ${zone.id}/${zone.bonus}; expected 0..${MAX_ZONE_BONUS}`);
        if (zone.polygon) {
            const vertices = zone.polygon;
            const area = vertices.reduce((sum, a, i) => { const b = vertices[(i + 1) % vertices.length]; return sum + a.x * b.y - b.x * a.y; }, 0);
            if (vertices.length < 3 || vertices.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
                !Number.isFinite(area) || Math.abs(area) < 1e-6 || !zoneContains(zone, zone))
                throw new Error(`Zone polygon must have area and contain its centre: ${zone.id}`);
        }
    }
}

/**
 * Authored arenas use central symmetry so both teams receive identical zone positions and values.
 * Every off-centre zone must have exactly one counterpart at (-x, -y).
 */
export function validateMirroredZoneLayout(zones: readonly Zone[], epsilon = 1e-3): void {
    validateZones(zones);
    if (!Number.isFinite(epsilon) || epsilon <= 0) throw new Error('Invalid mirrored-layout tolerance');
    const centred = zones.filter(zone => Math.hypot(zone.x, zone.y) <= epsilon);
    if (centred.length !== 1)
        throw new Error(`Mirrored battle map must have exactly one centre zone at (0,0); found ${centred.length}`);
    for (const zone of zones) {
        if (zone === centred[0]) continue;
        const mirror = zones.find(other => other !== zone &&
            Math.abs(other.x + zone.x) <= epsilon && Math.abs(other.y + zone.y) <= epsilon);
        if (!mirror) throw new Error(`Mirrored battle map is missing a counterpart for ${zone.id}`);
        if (mirror.bonus !== zone.bonus || Math.abs(mirror.radius - zone.radius) > epsilon)
            throw new Error(`Mirrored battle zones must have equal value and size: ${zone.id}/${mirror.id}`);
    }
}

/**
 * Fixed maps keep the editor's authored positions, including intentionally
 * asymmetric layouts and art extending under the frame. Mirror symmetry is
 * available as a separate authoring check, not a runtime gate.
 */
export function authoredZoneLayout(zones: readonly Zone[]): Zone[] {
    validateZones(zones);
    return zones.map(copy);
}

/** Explicit opt-in fitting utility; fixed maps never invoke it automatically. */
export function fitZoneLayout(zones: readonly Zone[], arena: MapBounds, margin = 28): Zone[] {
    validateZones(zones);
    return zones.map(source => {
        const zone = copy(source), b = limits(zone, arena, margin);
        zone.x = Math.max(b.left, Math.min(b.right, zone.x)); zone.y = Math.max(b.bottom, Math.min(b.top, zone.y));
        return zone;
    });
}

/** Stable seeded placement. Conservative bounds prevent overlap, including concave artwork. */
export function randomZoneLayout(zones: readonly Zone[], arena: MapBounds, seed: number, margin = 28, gap = 16): Zone[] {
    validateZones(zones);
    if (!Number.isFinite(seed) || !Number.isFinite(gap) || gap < 0) throw new Error('Invalid map seed or zone gap');
    let state = seed >>> 0;
    const random = (): number => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
    const ordered = zones.map(copy).sort((a, b) => {
        const x = zoneBounds(a), y = zoneBounds(b);
        return (y.right - y.left) * (y.top - y.bottom) - (x.right - x.left) * (x.top - x.bottom);
    });
    for (let attempt = 0; attempt < 32; attempt++) {
        const placed: Zone[] = [];
        for (const source of ordered) {
            const b = limits(source, arena, margin); let accepted = false;
            for (let trial = 0; trial < 256; trial++) {
                const candidate = { ...copy(source), x: b.left + random() * (b.right - b.left), y: b.bottom + random() * (b.top - b.bottom) };
                const cb = zoneBounds(candidate);
                if (placed.some(zone => { const pb = zoneBounds(zone); return !(cb.right + gap <= pb.left || pb.right + gap <= cb.left ||
                    cb.top + gap <= pb.bottom || pb.top + gap <= cb.bottom); })) continue;
                placed.push(candidate); accepted = true; break;
            }
            if (!accepted) break;
        }
        if (placed.length === zones.length) return zones.map(z => placed.find(p => p.id === z.id)!);
    }
    // Dense artwork can require nearly aligned rows, which random rejection rarely samples.
    // Try bounded shelf packing before rejecting a layout; preserve every authored outline.
    for (const transpose of [false, true]) {
        const availableWidth = (transpose ? arena.height : arena.width) - margin * 2;
        const availableHeight = (transpose ? arena.width : arena.height) - margin * 2;
        const packed: { zone: Zone; x: number; y: number; w: number; h: number; bounds: ZoneBounds }[] = [];
        let x = 0, y = 0, rowHeight = 0;
        for (const zone of ordered) {
            const b = zoneBounds({ ...zone, x: 0, y: 0 });
            const w = transpose ? b.top - b.bottom : b.right - b.left;
            const h = transpose ? b.right - b.left : b.top - b.bottom;
            if (x + w > availableWidth + 1e-6) { x = 0; y += rowHeight + gap + 1e-4; rowHeight = 0; }
            if (w > availableWidth || y + h > availableHeight + 1e-6) break;
            packed.push({ zone, x, y, w, h, bounds: b }); x += w + gap + 1e-4; rowHeight = Math.max(rowHeight, h);
        }
        if (packed.length !== zones.length) continue;
        const offsetY = random() * Math.max(0, availableHeight - y - rowHeight);
        const placed = packed.map(p => {
            const xx = p.x, yy = p.y + offsetY;
            return { ...copy(p.zone),
                x: (arena.centerX ?? 0) - arena.width / 2 + margin + (transpose ? yy : xx) - p.bounds.left,
                y: (arena.centerY ?? 0) - arena.height / 2 + margin + (transpose ? xx : yy) - p.bounds.bottom };
        });
        return zones.map(zone => placed.find(p => p.id === zone.id)!);
    }
    throw new Error('Cannot place non-overlapping zones in this arena');
}
