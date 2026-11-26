import { _decorator, BlockInputEvents, Button, Component, isValid, Label, Node, sp, UITransform, Vec3 } from 'cc';

const { ccclass } = _decorator;
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;
const TYPE_INTERVAL = 0.04;
const PUNCTUATION_PAUSE = 0.12;

@ccclass('NewbieGuideView')
export class NewbieGuideView extends Component {
    private content: Node[] = [];
    private background?: Node;
    private mask?: Node;
    private selectionGuide?: Node;
    private blocker?: Node;
    private finger?: Node;
    private fingerData?: sp.SkeletonData;
    private advance?: () => void;
    private dismissCurrent?: () => void;
    private victoryResolve?: () => void;
    private tapMode: 'advance' | 'dismiss' | 'selection' | 'victory' | '' = '';
    private typingLabel?: Label;
    private typingCharacters: string[] = [];
    private typingIndex = 0;
    private typingClock = 0;
    private typingDelay = TYPE_INTERVAL;
    private fullText = new Map<Label, string>();
    private layer = 0;
    private disposed = false;

    initialize(mask: Node, selectionGuide: Node, fingerData: sp.SkeletonData, advance: () => void): void {
        this.mask = mask;
        this.selectionGuide = selectionGuide;
        this.fingerData = fingerData;
        this.advance = advance;
        this.layer = this.node.layer;
        const background = this.node.getChildByName('guide_bg');
        if (!background) throw new Error('NewbieGuide missing guide_bg');
        this.background = background;
        this.content = [1, 2, 3, 4].map(step => {
            const node = this.node.getChildByPath(`guide_bg/content${step}`);
            if (!node) throw new Error(`NewbieGuide missing content${step}`);
            node.active = false;
            const label = node.getComponent(Label);
            if (!label) throw new Error(`NewbieGuide content${step} requires Label`);
            this.fullText.set(label, label.string);
            return node;
        });
        const maskBackdrop = mask.getChildByName('Backdrop') ?? mask;
        const maskBlock = maskBackdrop.getComponent(BlockInputEvents);
        if (maskBlock) maskBlock.enabled = false;
        const maskButton = maskBackdrop.getComponent(Button);
        if (maskButton) maskButton.enabled = false;

        const parent = this.node.parent;
        if (!parent) throw new Error('NewbieGuide requires a parent');
        const blocker = new Node('NewbieGuideTouchBlocker');
        blocker.layer = this.layer;
        const transform = blocker.addComponent(UITransform);
        transform.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
        blocker.on(Node.EventType.TOUCH_END, this.onAdvanceTap, this);
        blocker.active = false;
        parent.addChild(blocker);
        this.blocker = blocker;

        const finger = new Node('NewbieGuideFinger');
        finger.layer = this.layer;
        const fingerTransform = finger.addComponent(UITransform);
        fingerTransform.setContentSize(201, 190.5);
        const skeleton = finger.addComponent(sp.Skeleton);
        skeleton.skeletonData = fingerData;
        skeleton.setAnimationCacheMode(sp.Skeleton.AnimationCacheMode.PRIVATE_CACHE);
        finger.active = false;
        parent.addChild(finger);
        this.finger = finger;

        this.node.active = false;
        mask.active = false;
        selectionGuide.active = false;
        this.setLayer(blocker, this.layer);
        this.setLayer(finger, this.layer);
    }

    showWelcome(): void {
        this.tapMode = 'advance';
        this.showStep(0);
        this.setBlocker(true);
        if (this.mask) this.mask.active = true;
    }

    showSelectHero(): void {
        this.tapMode = 'selection';
        this.showStep(1);
        this.setBlocker(true);
        if (this.mask) this.mask.active = true;
    }

    showShootPrompt(onDismiss: () => void): void {
        this.hideSelectionGuide();
        this.dismissCurrent = onDismiss;
        this.tapMode = 'dismiss';
        this.showStep(2);
        this.setBlocker(true);
        if (this.mask) this.mask.active = true;
        if (this.finger) this.finger.active = false;
    }

    showShootGuide(target: Vec3): void {
        this.tapMode = '';
        this.dismissCurrent = undefined;
        const finger = this.finger;
        if (!finger || !this.fingerData) return;
        finger.active = true;
        finger.setWorldPosition(target);
        const skeleton = finger.getComponent(sp.Skeleton);
        if (!skeleton) return;
        skeleton.skeletonData = this.fingerData;
        skeleton.paused = false;
        skeleton.timeScale = 1;
        skeleton.clearTracks();
        skeleton.setToSetupPose();
        skeleton.setAnimation(0, skeleton.findAnimation('attack') ? 'attack' : 'idle', true);
    }

    showVictory(): Promise<void> {
        return new Promise(resolve => {
            this.hideSelectionGuide();
            this.victoryResolve = resolve;
            this.dismissCurrent = undefined;
            this.tapMode = 'victory';
            this.showStep(3);
            this.setBlocker(true);
            if (this.mask) this.mask.active = true;
            if (this.finger) this.finger.active = false;
        });
    }

    hideGuide(): void {
        this.stopTyping();
        this.dismissCurrent = undefined;
        this.tapMode = '';
        this.node.active = false;
        if (this.mask) this.mask.active = false;
        if (this.blocker) this.blocker.active = false;
        if (this.finger) this.finger.active = false;
        this.hideSelectionGuide();
    }

    hideSelectionGuide(): void {
        if (this.selectionGuide?.isValid) this.selectionGuide.active = false;
    }

    hideShootGuide(): void {
        if (this.finger?.isValid) this.finger.active = false;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.teardown(true);
    }

    onDestroy(): void {
        if (!this.disposed) {
            this.disposed = true;
            this.teardown(false);
        }
    }

    private teardown(destroyOwnedNodes: boolean): void {
        this.stopTyping();
        this.advance = undefined;
        this.dismissCurrent = undefined;
        const victory = this.victoryResolve;
        this.victoryResolve = undefined;
        victory?.();
        if (this.blocker?.isValid) {
            this.blocker.off(Node.EventType.TOUCH_END, this.onAdvanceTap, this);
            if (destroyOwnedNodes) this.blocker.destroy();
        }
        this.blocker = undefined;
        if (this.finger?.isValid && destroyOwnedNodes) this.finger.destroy();
        this.finger = undefined;
        this.fingerData = undefined;
        this.mask = undefined;
        this.selectionGuide = undefined;
        this.background = undefined;
        this.fullText?.clear();
        this.content = [];
    }

    update(dt: number): void {
        if (!this.typingLabel) return;
        this.typingClock += Math.max(0, Math.min(dt, .1));
        while (this.typingLabel && this.typingClock >= this.typingDelay) {
            this.typingClock -= this.typingDelay;
            this.revealNextCharacter();
        }
    }

    private showStep(index: number): void {
        this.node.active = true;
        if (this.background) this.background.active = true;
        this.content.forEach((node, current) => { node.active = current === index; });
        if (index !== 2 && this.finger) this.finger.active = false;
        const label = this.content[index].getComponent(Label);
        if (label) this.startTyping(label);
    }

    private setBlocker(active: boolean): void {
        if (this.blocker) this.blocker.active = active;
    }

    private onAdvanceTap(): void {
        if (this.typingLabel) {
            this.completeTyping();
            return;
        }
        const victory = this.victoryResolve;
        if (victory) {
            this.victoryResolve = undefined;
            this.setBlocker(false);
            victory();
            return;
        }
        if (this.tapMode === 'dismiss') {
            const dismiss = this.dismissCurrent;
            this.dismissCurrent = undefined;
            this.hideGuide();
            dismiss?.();
            return;
        }
        if (this.tapMode === 'selection') {
            this.hideGuide();
            if (this.selectionGuide?.isValid) this.selectionGuide.active = true;
            return;
        }
        if (this.tapMode === 'advance') {
            const advance = this.advance;
            this.advance = undefined;
            this.setBlocker(false);
            advance?.();
        }
    }

    private startTyping(label: Label): void {
        this.stopTyping();
        const full = this.fullText.get(label) ?? label.string;
        this.fullText.set(label, full);
        this.typingCharacters = Array.from(full);
        this.typingIndex = 0;
        this.typingClock = 0;
        this.typingDelay = TYPE_INTERVAL;
        this.typingLabel = label;
        label.string = '';
    }

    private revealNextCharacter(): void {
        const label = this.typingLabel;
        if (!label || !isValid(label, true) || this.typingIndex >= this.typingCharacters.length) {
            this.typingLabel = undefined;
            return;
        }
        const character = this.typingCharacters[this.typingIndex++];
        label.string += character;
        if (this.typingIndex >= this.typingCharacters.length) {
            this.typingLabel = undefined;
            return;
        }
        this.typingDelay = /[，。！？；：\n]/.test(character) ? PUNCTUATION_PAUSE : TYPE_INTERVAL;
    }

    private completeTyping(): void {
        const label = this.typingLabel;
        if (!label) return;
        label.string = this.fullText.get(label) ?? this.typingCharacters.join('');
        this.typingLabel = undefined;
        this.typingCharacters = [];
        this.typingIndex = 0;
        this.typingClock = 0;
        this.typingDelay = TYPE_INTERVAL;
    }

    private stopTyping(): void {
        this.typingLabel = undefined;
        this.typingCharacters = [];
        this.typingIndex = 0;
        this.typingClock = 0;
        this.typingDelay = TYPE_INTERVAL;
    }

    private setLayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) this.setLayer(child, layer);
    }
}
