import { _decorator, Button, Label, Node, ProgressBar } from 'cc';
import { UIBase } from '../UIBase';
import type { LoadingState } from '../../core/LoadingState';

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
    onLoad(): void { this.initializeView(); }
    private initializeView(): void {
        if (this.initialized) return;
        this.bindUI();
        const barNode = this.node.getChildByName('ProgressBar') ?? this.node.getChildByName('ProgressTrack');
        const bar = barNode?.getComponent(ProgressBar);
        if (!bar) throw new Error(`${this.node.name}: requires ProgressBar`);
        this.bar = bar; this.percent = this.ui.at('Percent', Label);
        this.message = this.node.getChildByName('Message')?.getComponent(Label) ?? undefined;
        this.title = this.node.getChildByName('Title')?.getComponent(Label) ?? undefined;
        this.retryButton = this.node.getChildByName('Retry')?.getComponent(Button) ?? undefined;
        const target = this.retryButton?.node ?? this.node;
        const event = this.retryButton ? Button.EventType.CLICK : Node.EventType.TOUCH_END;
        const retry = (): void => { if (this.failed) { this.failed = false; this.retry?.(); } };
        target.on(event, retry); this.own(() => { if (target.isValid) target.off(event, retry); });
        this.initialized = true;
    }
    begin(title: string, retry: () => void): void {
        this.initializeView(); this.node.active = true; this.retry = retry; this.failed = false;
        if (this.title) this.title.string = title;
        if (this.retryButton) this.retryButton.node.active = false;
        this.setProgress({ progress: 0, message: '准备加载' });
    }
    setProgress(state: LoadingState): void {
        if (!this.isValid) return;
        this.initializeView();
        const progress = Math.max(0, Math.min(1, state.progress));
        this.bar.progress = progress; this.percent.string = `${Math.floor(progress * 100)}%`;
        if (this.message) this.message.string = state.message;
    }
    fail(error: unknown): void {
        if (!this.isValid) return;
        this.initializeView(); console.error('[Loading]', error); this.failed = true;
        this.percent.string = '加载失败，点击重试';
        if (this.message) this.message.string = error instanceof Error ? error.message : String(error);
        if (this.retryButton) this.retryButton.node.active = true;
    }
    hide(): void { this.node.active = false; }
}
