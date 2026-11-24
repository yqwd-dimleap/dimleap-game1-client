import { DEBUG } from 'cc/env';

const now = (): number => globalThis.performance?.now?.() ?? Date.now();
const started = now();
const marks: Record<string, number> = {};

/** Browser/engine application timings, not platform cold-start or GPU presentation timings. */
export class StartupTrace {
    static mark(stage: string): void {
        if (stage in marks) return;
        marks[stage] = Math.round((now() - started) * 100) / 100;
        if (DEBUG) console.info('[Startup]', stage, marks[stage], 'ms since trace module loaded');
    }
    static snapshot(): Record<string, number> { return { ...marks }; }
}
