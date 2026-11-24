import { _decorator, Component, isValid, Label, Node, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { ToastService } from './ToastService';
const { ccclass } = _decorator;

const VISIBLE_SECONDS = 1.8;
const FADE_IN_SECONDS = .12;
const FADE_OUT_SECONDS = .22;

/** Reusable transient text surface. The authored label is the single text authority. */
@ccclass('ToastLayer')
export class ToastLayer extends Component {
    private panel?: Node;
    private label?: Label;
    private opacity?: UIOpacity;
    private request = 0;

    onLoad(): void {
        this.initialize();
        ToastService.register(this);
    }

    onEnable(): void {
        ToastService.register(this);
    }

    onDisable(): void {
        ToastService.unregister(this);
        this.hide();
    }

    initialize(): void {
        this.resolve();
        this.hide();
    }

    show(message: string): void {
        const text = message?.trim() ?? '';
        if (!text) {
            this.hide();
            return;
        }

        const { panel, label, opacity } = this.resolve();
        const request = ++this.request;
        Tween.stopAllByTarget(panel);
        Tween.stopAllByTarget(opacity);
        this.node.active = true;
        panel.active = true;
        panel.setScale(.96, .96, 1);
        label.string = text;
        opacity.opacity = 0;
        tween(panel).to(.16, { scale: Vec3.ONE }, { easing: 'quadOut' }).start();
        tween(opacity)
            .to(FADE_IN_SECONDS, { opacity: 255 }, { easing: 'quadOut' })
            .delay(VISIBLE_SECONDS)
            .to(FADE_OUT_SECONDS, { opacity: 0 }, { easing: 'quadIn' })
            .call(() => {
                if (request !== this.request || !isValid(this, true)) return;
                opacity.opacity = 0;
                panel.active = false;
            })
            .start();
    }

    hide(): void {
        this.request++;
        if (isValid(this.panel, true)) {
            Tween.stopAllByTarget(this.panel!);
            this.panel!.active = false;
        }
        if (isValid(this.opacity, true)) {
            Tween.stopAllByTarget(this.opacity!);
            this.opacity!.opacity = 0;
        }
    }

    private resolve(): { panel: Node; label: Label; opacity: UIOpacity } {
        if (!this.panel || !this.label || !this.opacity) {
            const panel = this.node.getChildByName('toast_bg');
            const label = panel?.getChildByName('content')?.getComponent(Label);
            if (!panel || !label) throw new Error('ToastLayer requires toast_bg/content with a Label');
            this.panel = panel;
            this.label = label;
            this.opacity = panel.getComponent(UIOpacity) ?? panel.addComponent(UIOpacity);
            this.opacity.opacity = 0;
            panel.active = false;
        }
        return { panel: this.panel, label: this.label, opacity: this.opacity };
    }

    onDestroy(): void {
        ToastService.unregister(this);
        this.hide();
    }
}
