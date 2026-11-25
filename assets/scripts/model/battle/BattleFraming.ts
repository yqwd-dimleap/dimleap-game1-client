import { Team, clamp } from '../config/PrototypeConfig';

export type CameraStage = 'overview' | 'blue-aim' | 'red-aim' | 'flight' | 'combat';
export interface CameraPose { x: number; y: number; height: number }
export const CAMERA_POSES: Record<CameraStage, CameraPose> = {
    overview: { x: 0, y: 0, height: 730 },
    'blue-aim': { x: 0, y: -95, height: 730 },
    'red-aim': { x: 0, y: 95, height: 730 },
    flight: { x: 0, y: 0, height: 600 },
    combat: { x: 0, y: 0, height: 730 },
};
/** Every authored map prefab is 900x1650 and centred on the board (map_bundle/prefabs). */
export const MAP_ART_HEIGHT = 1650;

export function framingHeight(height: number, aspect: number): number {
    const safe = Math.max(0.1, aspect);
    // Keep the entire arena width on tall devices; preserve each stage's relative zoom.
    const zoomed = height * Math.max(1, (750 / 1334) / safe);
    // Never look past the map art vertically: the world camera would otherwise
    // clear around it and expose that colour as a band at the screen edge.
    // Phone aspects stay below 0.562, so the width never exceeds the 900 art here.
    return Math.min(zoomed, MAP_ART_HEIGHT / 2);
}

/** The vertical pan may only use the margin the map art still covers. */
export function framingPan(y: number, height: number): number {
    const limit = Math.max(0, MAP_ART_HEIGHT / 2 - height);
    return clamp(y, -limit, limit);
}
export const aimStage = (team: Team): CameraStage => team === 0 ? 'blue-aim' : 'red-aim';

/** Re-target from the current pose; a new turn never snaps through the previous target. */
export class FramingTrack {
    stage: CameraStage = 'overview';
    pose: CameraPose = { ...CAMERA_POSES.overview };
    private from = { ...this.pose };
    private elapsed = 0;
    private duration = 0;
    get moving(): boolean { return this.elapsed < this.duration; }
    frame(stage: CameraStage, duration = 0.48): void {
        this.stage = stage; this.from = { ...this.pose }; this.elapsed = 0; this.duration = duration;
        if (duration <= 0) this.pose = { ...CAMERA_POSES[stage] };
    }
    update(dt: number): void {
        if (!this.moving) return;
        this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
        const t = clamp(this.elapsed / this.duration, 0, 1), s = t * t * (3 - 2 * t);
        const to = CAMERA_POSES[this.stage];
        this.pose = { x: this.from.x + (to.x - this.from.x) * s,
            y: this.from.y + (to.y - this.from.y) * s,
            height: this.from.height + (to.height - this.from.height) * s };
    }
}
