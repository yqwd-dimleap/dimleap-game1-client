import { Point, clamp } from '../config/PrototypeConfig';

/** Pointer direction steers the bow; its string can only travel along the bow's axis. */
export function slingAim(pull: Point, limit: number): { angle: number; stretch: number } {
    const length = Math.hypot(pull.x, pull.y);
    return { angle: length > 0 ? -Math.atan2(pull.x, pull.y) * 180 / Math.PI : 0,
        stretch: clamp(length / Math.max(1, limit), 0, 1) };
}

/** An analytic damped spring avoids frame-rate-dependent integration and overshoot drift. */
export function slingRecoil(stretch: number, seconds: number): number {
    if (stretch === 0 || seconds >= .65) return 0;
    return stretch * Math.exp(-9 * seconds) * Math.cos(24 * seconds);
}
