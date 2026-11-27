import { ViewNodes } from '../binding/ViewNodes';
import { _decorator, Button, Component, EventMouse, EventTouch, game, input, Input, isValid, Label, NodeEventType, ProgressBar, ScrollView, Sprite, SpriteFrame, Vec3, view } from 'cc';
import type { Node as CocosNode } from 'cc';
import type { HeroDefinition } from '../../model/config/PrototypeConfig';
import { HeroProgress, heroCardState } from '../../model/hero/HeroProgress';

export interface HeroCardArt { frames: readonly SpriteFrame[]; levels: readonly SpriteFrame[]; names: readonly SpriteFrame[] }
export interface HeroCardDragHandlers {
    start(point: Vec3, source: CocosNode): void;
    move(point: Vec3): void;
    end(point: Vec3): void;
    cancel(): void;
}

/** Presentation of an authored collection card, with no Inspector node references. */
@_decorator.ccclass('HeroCardView')
export class HeroCardView extends Component {
    private bindings?: ViewNodes;
    private get ui(): ViewNodes { return this.bindings ?? (this.bindings = new ViewNodes(this.node)); }
    private click?: () => void;
    private drag?: HeroCardDragHandlers;
    private longPressTimer?: ReturnType<typeof setTimeout>;
    private touchStart = new Vec3();
    private touchActive = false;
    private longPress = false;
    private ignoreClicksUntil = 0;
    private scrollView?: ScrollView;
    private scrollCancelInnerEvents?: boolean;
    private globalDragInput = false;
    private nativeWxInput = false;
    private readonly pointer = (event: EventTouch | EventMouse): Vec3 => {
        const point = event.getUILocation();
        return new Vec3(point.x, point.y, 0);
    };
    private readonly onTouchStart = (event: EventTouch): void => {
        if (!this.drag || this.touchActive) return;
        const point = this.pointer(event);
        this.touchStart.set(point);
        this.touchActive = true;
        this.longPress = false;
        if (this.scrollView && this.scrollCancelInnerEvents === undefined) {
            this.scrollCancelInnerEvents = this.scrollView.cancelInnerEvents;
            this.scrollView.cancelInnerEvents = false;
        }
        this.longPressTimer = setTimeout(() => {
            this.longPressTimer = undefined;
            if (!this.touchActive || !this.drag) return;
            this.longPress = true;
            // Button dispatches CLICK from its own TOUCH_END before this component's
            // handler runs, so suppress it as soon as the long press is armed.
            this.ignoreClicksUntil = Number.POSITIVE_INFINITY;
            if (this.scrollView) this.scrollView.enabled = false;
            this.bindGlobalDragInput();
            this.drag.start(this.touchStart.clone(), this.node);
        }, 420);
    };
    private readonly onTouchMove = (event: EventTouch): void => {
        if (!this.touchActive || !this.drag) return;
        const point = this.pointer(event);
        if (this.longPress) { this.drag.move(point); return; }
        const dx = point.x - this.touchStart.x, dy = point.y - this.touchStart.y;
        if (dx * dx + dy * dy > 144) this.clearLongPressTimer();
    };
    private readonly onTouchEnd = (event: EventTouch): void => {
        if (!this.touchActive) return;
        this.clearLongPressTimer();
        this.finishLongPress(this.pointer(event));
    };
    private readonly onTouchCancel = (event: EventTouch): void => {
        this.clearLongPressTimer();
        // Opening the modal can cancel the original card's touch. The global
        // mouse/touch listeners remain responsible for finishing the gesture.
        if (!event.simulate && !this.longPress) this.cancelLongPress();
    };
    private readonly onGlobalTouchMove = (event: EventTouch): void => {
        if (!this.touchActive || !this.longPress) return;
        this.drag?.move(this.pointer(event));
    };
    private readonly onGlobalTouchEnd = (event: EventTouch): void => {
        if (!this.touchActive || !this.longPress) return;
        this.finishLongPress(this.pointer(event));
    };
    private readonly onGlobalTouchCancel = (event: EventTouch): void => {
        if (!this.touchActive || !this.longPress) return;
        if (event.simulate) return;
        this.cancelLongPress();
    };
    private readonly onGlobalMouseMove = (event: EventMouse): void => {
        if (!this.touchActive || !this.longPress) return;
        this.drag?.move(this.pointer(event));
    };
    private readonly onGlobalMouseUp = (event: EventMouse): void => {
        if (!this.touchActive || !this.longPress) return;
        this.finishLongPress(this.pointer(event));
    };
    private readonly onDomPointerMove = (event: PointerEvent): void => {
        if (!this.touchActive || !this.longPress) return;
        const point = this.domPointer(event);
        if (point) this.drag?.move(point);
    };
    private readonly onDomPointerUp = (event: PointerEvent): void => {
        if (!this.touchActive || !this.longPress) return;
        const point = this.domPointer(event);
        if (point) this.finishLongPress(point);
    };
    private readonly onWxTouchMove = (event: { touches?: { clientX: number; clientY: number }[] }): void => {
        if (!this.touchActive || !this.longPress) return;
        const touch = event.touches?.[0];
        if (touch) this.drag?.move(this.wxPointer(touch));
    };
    private readonly onWxTouchEnd = (event: {
        touches?: { clientX: number; clientY: number }[];
        changedTouches?: { clientX: number; clientY: number }[];
    }): void => {
        if (!this.touchActive || !this.longPress) return;
        const touch = event.changedTouches?.[0] ?? event.touches?.[0];
        if (touch) this.finishLongPress(this.wxPointer(touch));
    };
    private readonly onWxTouchCancel = (): void => {
        if (!this.touchActive || !this.longPress) return;
        this.cancelLongPress();
    };
    private finishLongPress(point: Vec3): void {
        if (!this.touchActive) return;
        const dragged = this.longPress;
        this.unbindGlobalDragInput();
        if (dragged) {
            this.ignoreClicksUntil = Date.now() + 160;
            this.drag?.end(point);
        }
        if (this.scrollView && !this.scrollView.enabled) this.scrollView.enabled = true;
        this.restoreScrollCancellation();
        this.touchActive = false;
        this.longPress = false;
    }
    private cancelLongPress(): void {
        if (!this.touchActive) return;
        const dragged = this.longPress;
        this.unbindGlobalDragInput();
        if (dragged) {
            this.ignoreClicksUntil = Date.now() + 160;
            this.drag?.cancel();
        }
        if (this.scrollView && !this.scrollView.enabled) this.scrollView.enabled = true;
        this.restoreScrollCancellation();
        this.touchActive = false;
        this.longPress = false;
    }
    private bindGlobalDragInput(): void {
        if (this.globalDragInput) return;
        input.on(Input.EventType.TOUCH_MOVE, this.onGlobalTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onGlobalTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onGlobalTouchCancel, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onGlobalMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onGlobalMouseUp, this);
        if (typeof window !== 'undefined') {
            window.addEventListener('pointermove', this.onDomPointerMove, true);
            window.addEventListener('pointerup', this.onDomPointerUp, true);
        }
        const wx = (globalThis as any).wx;
        if (wx?.onTouchMove && wx?.onTouchEnd) {
            wx.onTouchMove(this.onWxTouchMove);
            wx.onTouchEnd(this.onWxTouchEnd);
            wx.onTouchCancel?.(this.onWxTouchCancel);
            this.nativeWxInput = true;
        }
        this.globalDragInput = true;
    }
    private unbindGlobalDragInput(): void {
        if (!this.globalDragInput) return;
        input.off(Input.EventType.TOUCH_MOVE, this.onGlobalTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onGlobalTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onGlobalTouchCancel, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onGlobalMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.onGlobalMouseUp, this);
        if (typeof window !== 'undefined') {
            window.removeEventListener('pointermove', this.onDomPointerMove, true);
            window.removeEventListener('pointerup', this.onDomPointerUp, true);
        }
        if (this.nativeWxInput) {
            const wx = (globalThis as any).wx;
            wx?.offTouchMove?.(this.onWxTouchMove);
            wx?.offTouchEnd?.(this.onWxTouchEnd);
            wx?.offTouchCancel?.(this.onWxTouchCancel);
            this.nativeWxInput = false;
        }
        this.globalDragInput = false;
    }
    private domPointer(event: PointerEvent): Vec3 | null {
        const canvas = game.canvas;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return null;
        const visible = view.getVisibleSize();
        return new Vec3(
            (event.clientX - rect.left) / rect.width * visible.width,
            (rect.bottom - event.clientY) / rect.height * visible.height,
            0);
    }
    private wxPointer(touch: { clientX: number; clientY: number }): Vec3 {
        const wx = (globalThis as any).wx;
        const info = wx?.getWindowInfo?.() ?? wx?.getSystemInfoSync?.() ?? {};
        const windowWidth = Number(info.windowWidth) || Number(info.screenWidth) || 1;
        const windowHeight = Number(info.windowHeight) || Number(info.screenHeight) || 1;
        const visible = view.getVisibleSize();
        return new Vec3(
            touch.clientX / windowWidth * visible.width,
            visible.height - touch.clientY / windowHeight * visible.height,
            0);
    }
    private restoreScrollCancellation(): void {
        if (!this.scrollView || this.scrollCancelInnerEvents === undefined) return;
        this.scrollView.cancelInnerEvents = this.scrollCancelInnerEvents;
        this.scrollCancelInnerEvents = undefined;
    }
    private readonly onClick = (): void => {
        if (Date.now() >= this.ignoreClicksUntil) this.click?.();
    };
    private clearLongPressTimer(): void {
        if (this.longPressTimer === undefined) return;
        clearTimeout(this.longPressTimer);
        this.longPressTimer = undefined;
    }
    initialize(click: () => void, drag?: HeroCardDragHandlers): void {
        this.dispose(); this.click = click; this.drag = drag;
        let parent = this.node.parent;
        while (parent && !this.scrollView) {
            this.scrollView = parent.getComponent(ScrollView) ?? undefined;
            parent = parent.parent;
        }
        this.node.on(Button.EventType.CLICK, this.onClick, this);
        this.node.on(NodeEventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(NodeEventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(NodeEventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(NodeEventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }
    render(hero: HeroDefinition, entry: HeroProgress, icon: SpriteFrame | null, art?: HeroCardArt, unlocked?: boolean): void {
        const state = heroCardState(hero.id, entry, unlocked);
        const showHero = state.unlocked && !!art;
        if (art) {
            this.ui.at('hero_frame', Sprite).spriteFrame = art.frames[state.frame];
            this.ui.at('hero/lv_bg', Sprite).spriteFrame = art.levels[state.tier - 1];
            this.ui.at('hero/name_bg', Sprite).spriteFrame = art.names[state.tier];
            this.ui.at('hero_lock/name_bg_0', Sprite).spriteFrame = art.names[0];
        }
        this.ui.path('hero').active = showHero;
        this.ui.path('hero_lock').active = !showHero;
        this.ui.at('hero_lock/name_bg_0/Label', Label).string = '？\n？\n？';
        const button = this.getComponent(Button);
        // Locked cards stay clickable so the detail panel can offer fragment unlock.
        if (button) button.interactable = true;
        const portrait = this.ui.at('hero/hero_icon', Sprite); portrait.spriteFrame = icon; portrait.enabled = !!icon;
        const fallback = this.ui.at('hero/hero_icon/Fallback', Label); fallback.string = ''; fallback.node.active = false;
        this.ui.path('hero/name_bg').active = false;
        this.ui.at('hero/name_bg/name', Label).string = '';
        this.ui.at('hero/lv_bg/Label', Label).string = `Lv.${entry.level}`;
        this.ui.path('hero/can_upgrade').active = state.ready;
        this.ui.path('hero/can_not_upgrade').active = !state.ready;
        this.ui.at('hero/fragments/total_fragments', Label).string = String(entry.shards);
        this.ui.at('hero/fragments/next_level_fragments', Label).string = state.max ? '满级' : String(state.required);
        this.ui.path('hero/fragments/total_fragments').active = !state.max;
        this.ui.path('hero/fragments/Slash').active = !state.max;
        this.ui.at('hero/can_not_upgrade/ProgressBar', ProgressBar).progress = state.progress;
    }
    dispose(): void {
        this.clearLongPressTimer();
        this.unbindGlobalDragInput();
        if (!isValid(this.node, true)) return;
        this.node.off(Button.EventType.CLICK, this.onClick, this);
        this.node.off(NodeEventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(NodeEventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(NodeEventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(NodeEventType.TOUCH_CANCEL, this.onTouchCancel, this);
        if (this.scrollView && !this.scrollView.enabled) this.scrollView.enabled = true;
        this.restoreScrollCancellation();
        this.scrollView = undefined;
        this.click = undefined; this.drag = undefined;
    }
    onDestroy(): void { this.dispose(); }
}
