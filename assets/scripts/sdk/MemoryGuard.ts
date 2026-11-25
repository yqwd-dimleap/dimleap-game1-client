/**
 * Mini-game memory pressure hook. WeChat reports levels 5/10/15 through
 * `onMemoryWarning`; the engine offers no portable "release unused" call, so we
 * keep the last state for diagnostics and only force a JS collection at the
 * critical level. Cache owners keep their own trim logic.
 */
interface MemoryWarningHost {
    onMemoryWarning?(listener: (result: { level: number }) => void): void;
    triggerGC?(): void;
}

export interface MemorySnapshot {
    level: number;
    warnings: number;
    lastWarningAt: number;
}

const CRITICAL_LEVEL = 15;

export class MemoryGuard {
    private static installed = false;
    private static level = 0;
    private static warnings = 0;
    private static lastWarningAt = 0;

    static install(): void {
        if (MemoryGuard.installed) return;
        const host = (globalThis as { wx?: MemoryWarningHost }).wx;
        if (!host?.onMemoryWarning) return;
        MemoryGuard.installed = true;
        host.onMemoryWarning(result => {
            const level = typeof result?.level === 'number' ? result.level : 0;
            MemoryGuard.level = Math.max(MemoryGuard.level, level);
            MemoryGuard.warnings++;
            MemoryGuard.lastWarningAt = Date.now();
            console.warn(`[Memory] warning level ${level} (#${MemoryGuard.warnings})`);
            if (level >= CRITICAL_LEVEL) {
                try { host.triggerGC?.(); } catch { /* platform best effort */ }
            }
        });
    }

    static snapshot(): MemorySnapshot {
        return { level: MemoryGuard.level, warnings: MemoryGuard.warnings, lastWarningAt: MemoryGuard.lastWarningAt };
    }
}
