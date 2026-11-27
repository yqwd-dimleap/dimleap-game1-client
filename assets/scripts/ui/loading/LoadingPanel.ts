import { _decorator, Button, Label, Node, ProgressBar } from 'cc';
import { UIBase } from '../UIBase';
import type { LoadingState } from '../../core/LoadingState';

const SMOOTHING_RATE = 7.5;
const MIN_CATCH_UP_RATE = 0.04;
const IDLE_CREEP_RATE = 0.008;
const IDLE_LOOKAHEAD = 0.035;
const MAX_FAKE_PROGRESS = 0.96;
const FINISH_EPSILON = 0.0005;

@_decorator.ccclass('LoadingPanel')
export class LoadingPanel extends UIBase {
    private retry?: () => void;
    private bar!: ProgressBar;
    private percent!: Label;
    private message?: Label;
    private title?: Label;
    private retryButton?: Button;
    private failed = false;
    private initialized = false;
    private targetProgress = 0;
    private visualProgress = 0;
    private finishPromise?: Promise<void>;
    private resolveFinish?: () => void;
    onLoad(): void { this.initializeView(); }
    private initializeView(): void {
        if (this.initialized) return;
        this.bindUI();
        const bar = this.node.getComponentInChildren(ProgressBar);
        if (!bar) throw new Error(`${this.node.name}: requires ProgressBar`);
        const percent = this.findNode('Percent')?.getComponent(Label);
        if (!percent) throw new Error(`${this.node.name}: requires Percent label`);
        this.bar = bar; this.percent = percent;
        this.message = this.findNode('Message')?.getComponent(Label)
            ?? percent.node.parent?.getChildByName('Label')?.getComponent(Label)
            ?? undefined;
        this.title = this.findNode('Title')?.getComponent(Label)
            ?? this.findNode('title')?.getComponent(Label)
            ?? undefined;
        this.retryButton = this.node.getComponentInChildren(Button) ?? undefined;
        const target = this.retryButton?.node ?? this.node;
        const event = this.retryButton ? Button.EventType.CLICK : Node.EventType.TOUCH_END;
        const retry = (): void => { if (this.failed) { this.failed = false; this.retry?.(); } };
        target.on(event, retry); this.own(() => { if (target.isValid) target.off(event, retry); });
        this.initialized = true;
    }
    private findNode(name: string, root: Node = this.node): Node | undefined {
        if (root.name === name) return root;
        for (const child of root.children) {
            const found = this.findNode(name, child);
            if (found) return found;
        }
        return undefined;
    }
    begin(title: string, retry: () => void): void {
        this.initializeView(); this.node.active = true; this.retry = retry; this.failed = false;
        this.resolveFinish?.(); this.resolveFinish = undefined; this.finishPromise = undefined;
        this.targetProgress = 0; this.visualProgress = 0; this.renderProgress();
        if (this.title) this.title.string = title;
        if (this.retryButton) this.retryButton.node.active = false;
        this.setProgress({ progress: 0, message: '准备加载' });
    }
    setProgress(state: LoadingState): void {
        if (!this.isValid || this.failed) return;
        this.initializeView();
        const progress = Math.max(0, Math.min(1, state.progress));
        this.targetProgress = Math.max(this.targetProgress, progress);
        if (this.message) this.message.string = state.message;
    }
    update(deltaTime: number): void {
        if (!this.initialized || !this.node.activeInHierarchy || this.failed) return;
        const dt = Math.min(0.1, Math.max(0, deltaTime));
        const remaining = this.targetProgress - this.visualProgress;
        let next = this.visualProgress;
        if (remaining > FINISH_EPSILON) {
            const blend = 1 - Math.exp(-SMOOTHING_RATE * dt);
            next += remaining * blend;
            next = Math.max(next, this.visualProgress + Math.min(remaining, dt * MIN_CATCH_UP_RATE));
        } else if (this.targetProgress < 1) {
            const idleCeiling = Math.min(MAX_FAKE_PROGRESS, this.targetProgress + IDLE_LOOKAHEAD);
            next = Math.min(idleCeiling, next + dt * IDLE_CREEP_RATE);
        }
        if (next <= this.visualProgress + FINISH_EPSILON) return;
        this.visualProgress = Math.min(1, next);
        this.renderProgress();
        if (this.targetProgress >= 1 && this.visualProgress >= 1 - FINISH_EPSILON) {
            this.visualProgress = 1; this.renderProgress();
            this.resolveFinish?.(); this.resolveFinish = undefined; this.finishPromise = undefined;
        }
    }
    finish(message: string): Promise<void> {
        if (!this.isValid || this.failed) return Promise.resolve();
        this.initializeView();
        if (this.message) this.message.string = message;
        this.targetProgress = 1;
        if (this.visualProgress >= 1 - FINISH_EPSILON) {
            this.visualProgress = 1; this.renderProgress();
            return Promise.resolve();
        }
        if (!this.finishPromise) {
            this.finishPromise = new Promise<void>(resolve => { this.resolveFinish = resolve; });
        }
        return this.finishPromise;
    }
    private renderProgress(): void {
        const progress = Math.max(0, Math.min(1, this.visualProgress));
        this.bar.progress = progress;
        this.percent.string = `${Math.min(100, Math.floor(progress * 100))}%`;
    }
    fail(error: unknown): void {
        if (!this.isValid) return;
        this.initializeView(); console.error('[Loading]', error); this.failed = true;
        this.resolveFinish?.(); this.resolveFinish = undefined; this.finishPromise = undefined;
        this.percent.string = '加载失败，点击重试';
        if (this.message) this.message.string = error instanceof Error ? error.message : String(error);
        if (this.retryButton) this.retryButton.node.active = true;
    }
    hide(): void { this.node.active = false; }
}
