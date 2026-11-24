import { Camera, EventTouch, Node, UITransform, Vec3 } from 'cc';
import { Point } from '../../../model/config/PrototypeConfig';

export class ThrowInput {
    private touchId: number | null = null;
    private origin: Point | null = null;
    private transform: UITransform;
    private surface: Node;
    constructor(private board: Node, private begin: (p: Point) => Point | null,
        private move: (dx: number, dy: number) => void,
        private end: (dx: number, dy: number) => void,
        private cancelCallback: () => void, private camera?: Camera, surface?: Node) {
        this.transform = board.getComponent(UITransform)!;
        // Capture on the full view: pulling beyond the board must still release a shot.
        this.surface = surface ?? board.parent!;
        this.surface.on(Node.EventType.TOUCH_START, this.onStart, this);
        // One node owns the gesture; UI-claimed touches do not reach global Input.
        // The UI dispatcher consumes claimed touches before the global Input dispatcher.
        this.surface.on(Node.EventType.TOUCH_MOVE, this.onMove, this);
        this.surface.on(Node.EventType.TOUCH_END, this.onEnd, this);
        this.surface.on(Node.EventType.TOUCH_CANCEL, this.onCancel, this);
    }
    private point(e: EventTouch): Point {
        if (this.camera) {
            const p = e.getLocation();
            return this.transform.convertToNodeSpaceAR(this.camera.screenToWorld(new Vec3(p.x, p.y, 0)));
        }
        const p = e.getUILocation();
        return this.transform.convertToNodeSpaceAR(new Vec3(p.x, p.y, 0));
    }
    private onStart(e: EventTouch): void {
        if (this.touchId !== null) return;
        const origin = this.begin(this.point(e));
        if (!origin) return;
        this.origin = origin; this.touchId = e.getID();
    }
    private onMove(e: EventTouch): void {
        if (e.getID() !== this.touchId || !this.origin) return;
        const p = this.point(e); this.move(this.origin.x - p.x, this.origin.y - p.y);
    }
    private onEnd(e: EventTouch): void {
        if (e.getID() !== this.touchId || !this.origin) return;
        const p = this.point(e), origin = this.origin;
        this.touchId = null; this.origin = null;
        this.end(origin.x - p.x, origin.y - p.y);
    }
    private onCancel(e: EventTouch): void { if (e.getID() === this.touchId) this.cancel(); }
    cancel(): void { this.touchId = null; this.origin = null; this.cancelCallback(); }
    destroy(): void {
        // Scene children may already be destroyed. Disposal must not call UI callbacks.
        this.touchId = null; this.origin = null;
        if (!this.surface.isValid) return;
        this.surface.off(Node.EventType.TOUCH_START, this.onStart, this);
        this.surface.off(Node.EventType.TOUCH_MOVE, this.onMove, this);
        this.surface.off(Node.EventType.TOUCH_END, this.onEnd, this);
        this.surface.off(Node.EventType.TOUCH_CANCEL, this.onCancel, this);
    }
}
