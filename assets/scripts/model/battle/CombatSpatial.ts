import type { Point } from '../config/PrototypeConfig';

/** Broad phase only: callers still perform the same exact distance/swept tests. */
export class CombatSpatial<T extends Point> {
    private cells = new Map<number, T[]>();
    private pool: T[][] = [];
    private minX = Infinity; private maxX = -Infinity;
    private minY = Infinity; private maxY = -Infinity;
    constructor(readonly cellSize = 96) {}
    clear(): void {
        for (const bucket of this.cells.values()) { bucket.length = 0; this.pool.push(bucket); }
        this.cells.clear(); this.minX = this.minY = Infinity; this.maxX = this.maxY = -Infinity;
    }
    add(point: T): void {
        const x = Math.floor(point.x / this.cellSize), y = Math.floor(point.y / this.cellSize), key = x * 65536 + y;
        let bucket = this.cells.get(key);
        if (!bucket) { bucket = this.pool.pop() ?? []; this.cells.set(key, bucket); }
        bucket.push(point);
        this.minX = Math.min(x, this.minX); this.maxX = Math.max(x, this.maxX);
        this.minY = Math.min(y, this.minY); this.maxY = Math.max(y, this.maxY);
    }
    rect(minX: number, minY: number, maxX: number, maxY: number, output: T[]): void {
        output.length = 0;
        for (let x = Math.floor(minX / this.cellSize); x <= Math.floor(maxX / this.cellSize); x++)
            for (let y = Math.floor(minY / this.cellSize); y <= Math.floor(maxY / this.cellSize); y++) {
                const bucket = this.cells.get(x * 65536 + y);
                if (bucket) for (const item of bucket) output.push(item);
            }
    }
    nearest(point: Point, id: (item: T) => number): T | undefined {
        if (!this.cells.size) return undefined;
        const cx = Math.floor(point.x / this.cellSize), cy = Math.floor(point.y / this.cellSize);
        const limit = Math.max(Math.abs(cx - this.minX), Math.abs(cx - this.maxX), Math.abs(cy - this.minY), Math.abs(cy - this.maxY));
        let best: T | undefined, bestDistance = Infinity;
        for (let ring = 0; ring <= limit; ring++) {
            for (let x = cx - ring; x <= cx + ring; x++) for (let y = cy - ring; y <= cy + ring; y++) {
                if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue;
                const bucket = this.cells.get(x * 65536 + y);
                if (!bucket) continue;
                for (const item of bucket) {
                    const d = (item.x - point.x) ** 2 + (item.y - point.y) ** 2;
                    if (d < bestDistance || (d === bestDistance && id(item) < id(best!))) { best = item; bestDistance = d; }
                }
            }
            const outside = Math.min(point.x - (cx - ring) * this.cellSize, (cx + ring + 1) * this.cellSize - point.x,
                point.y - (cy - ring) * this.cellSize, (cy + ring + 1) * this.cellSize - point.y);
            if (best && bestDistance < outside * outside) break;
        }
        return best;
    }
}
