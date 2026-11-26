export interface StartupProgress { progress: number; message: string }
export interface StartupPorts {
    initialize(): Promise<void>;
    checkVersion(): Promise<void>;
    prepareSession(): Promise<void>;
    enterHome(report: (state: StartupProgress) => void): Promise<void>;
}

/** Startup gate: enter the lightweight main shell before its UI bundles finish loading. */
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
            progress(0.12, '检查客户端版本');
            await this.ports.checkVersion();
            progress(0.24, '准备游戏会话');
            await this.ports.prepareSession();
            progress(0.55, '进入游戏');
            await this.ports.enterHome(state => progress(0.55 + 0.45 * state.progress, state.message));
            progress(1, '加载完成');
        }).then(() => { active = false; this.pending = undefined; }, error => {
            active = false; this.pending = undefined; throw error;
        });
        return this.pending;
    }
}
