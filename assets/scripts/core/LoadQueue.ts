export type LoadPriority = 'critical' | 'normal' | 'background';

const PRIORITY: Record<LoadPriority, number> = {
    critical: 0,
    normal: 1,
    background: 2,
};

export class LoadCancelledError extends Error {
    constructor() {
        super('Resource load cancelled');
        this.name = 'LoadCancelledError';
    }
}

interface QueueEntry {
    run: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    priority: number;
    order: number;
    cancelled?: () => boolean;
}

export interface LoadQueueSnapshot {
    concurrency: number;
    active: number;
    queued: number;
    peakQueued: number;
    started: number;
    completed: number;
    failed: number;
    cancelled: number;
}

/** Shared admission control for asset requests; callers keep their own promise semantics. */
export class LoadQueue {
    private queue: QueueEntry[] = [];
    private active = 0;
    private sequence = 0;
    private peakQueued = 0;
    private started = 0;
    private completed = 0;
    private failed = 0;
    private cancelled = 0;

    constructor(private concurrency = 6) {
        if (!Number.isSafeInteger(concurrency) || concurrency <= 0) throw new Error('LoadQueue concurrency must be positive');
    }

    schedule<T>(run: () => Promise<T>, priority: LoadPriority = 'normal', cancelled?: () => boolean): Promise<T> {
        if (cancelled?.()) return Promise.reject(new LoadCancelledError());
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                run,
                resolve: value => resolve(value as T),
                reject,
                priority: PRIORITY[priority],
                order: this.sequence++,
                cancelled,
            });
            this.peakQueued = Math.max(this.peakQueued, this.queue.length);
            this.queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
            this.pump();
        });
    }

    snapshot(): LoadQueueSnapshot {
        return {
            concurrency: this.concurrency,
            active: this.active,
            queued: this.queue.length,
            peakQueued: this.peakQueued,
            started: this.started,
            completed: this.completed,
            failed: this.failed,
            cancelled: this.cancelled,
        };
    }

    private pump(): void {
        while (this.active < this.concurrency && this.queue.length) {
            const entry = this.queue.shift()!;
            if (entry.cancelled?.()) {
                this.cancelled++;
                entry.reject(new LoadCancelledError());
                continue;
            }
            this.active++;
            this.started++;
            void Promise.resolve()
                .then(entry.run)
                .then(value => {
                    this.completed++;
                    entry.resolve(value);
                    this.finish();
                }, error => {
                    this.failed++;
                    entry.reject(error);
                    this.finish();
                });
        }
    }

    private finish(): void {
        this.active--;
        this.pump();
    }
}
