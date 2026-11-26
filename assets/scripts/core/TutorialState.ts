export const TUTORIAL_VERSION = 1;

export interface TutorialSave {
    schema: 1;
    version: number;
    completed: boolean;
    completedAt?: number;
}

export interface TutorialStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** Device-local onboarding state: a fresh install must warm remote content again. */
export class TutorialStateStore {
    private readonly key = 'runestone.tutorial.v1';
    constructor(private storage: TutorialStorage) {}

    read(): TutorialSave | null {
        try {
            const raw = this.storage.getItem(this.key);
            if (!raw || raw.length > 512) return null;
            const value = JSON.parse(raw) as Partial<TutorialSave>;
            const version = value.version;
            if (value.schema !== 1 || typeof version !== 'number' || !Number.isInteger(version) || version < 1 ||
                typeof value.completed !== 'boolean' ||
                (value.completedAt !== undefined && (!Number.isFinite(value.completedAt) || value.completedAt < 0))) return null;
            return value as TutorialSave;
        } catch {
            return null;
        }
    }

    needsTutorial(): boolean {
        const value = this.read();
        return !value?.completed || value.version < TUTORIAL_VERSION;
    }

    complete(): boolean {
        try {
            this.storage.setItem(this.key, JSON.stringify({
                schema: 1,
                version: TUTORIAL_VERSION,
                completed: true,
                completedAt: Date.now(),
            } satisfies TutorialSave));
            console.info('[Tutorial] completed');
            return true;
        } catch (error) {
            console.warn('[Tutorial] state write failed', error);
            return false;
        }
    }

    reset(): void {
        try { this.storage.removeItem(this.key); }
        catch (error) { console.warn('[Tutorial] state reset failed', error); }
    }
}
