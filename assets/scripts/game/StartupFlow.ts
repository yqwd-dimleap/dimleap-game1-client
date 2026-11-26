export interface StartupProgress { progress: number; message: string }
export interface StartupPorts {
    initialize(): Promise<void>;
    checkVersion(): Promise<void>;
    preloadBootBundles(report: (state: StartupProgress) => void): Promise<void>;
    prepareSession(): Promise<void>;
    prepareTutorial(report: (state: StartupProgress) => void): Promise<void>;
    enterHome(report: (state: StartupProgress) => void): Promise<void>;
}

/** Startup gate: preload local feature bundles, prepare the tutorial, then enter the first scene. */
export class StartupFlow {
    private pending?: Promise<void>;
    private attempt = 0;
    constructor(private ports: StartupPorts) {}
    run(report: (state: StartupProgress) => void): Promise<void> {
        if (this.pending) return this.pending;
        const attempt = ++this.attempt;
        let active = true, highest = 0;
        const progress = (value: number, message: string): void => {
            if (!active || attempt !== this.attempt) return;
            highest = Math.max(highest, Math.max(0, Math.min(1, value)));
            report({ progress: highest, message });
        };
        this.pending = Promise.resolve().then(async () => {
            progress(0, '读取启动配置');
            await this.ports.initialize();
            progress(0.08, '检查客户端版本');
            await this.ports.checkVersion();
            progress(0.12, '预加载启动资源');
            await this.ports.preloadBootBundles(state => {
                progress(0.12 + 0.18 * state.progress, state.message);
            });
            progress(0.32, '准备游戏会话');
            await Promise.all([
                this.ports.prepareSession(),
                this.ports.prepareTutorial(state => {
                    progress(0.32 + 0.2 * state.progress, state.message);
                }),
            ]);
            progress(0.55, '进入游戏');
            await this.ports.enterHome(state => progress(0.55 + 0.45 * state.progress, state.message));
            progress(1, '加载完成');
        }).then(() => { active = false; this.pending = undefined; }, error => {
            active = false; this.pending = undefined; throw error;
        });
        return this.pending;
    }
}
