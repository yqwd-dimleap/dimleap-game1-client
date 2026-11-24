import { Node, sp, UITransform, isValid } from 'cc';
import { Point } from '../../../model/config/PrototypeConfig';
import { TroopAssets } from './TroopAssets';

type Kind = 'collision' | 'reinforcement';
interface Entry { node: Node; skeleton: sp.Skeleton; kind: Kind; elapsed: number; duration: number }

/** Short lived deployment effects share their data and reuse a bounded set of nodes. */
export class DeploymentEffects {
    private active: Entry[] = [];
    private free: Entry[] = [];
    private contacts: Point[] = [];
    private speed = 1;
    constructor(private root: Node, private assets: TroopAssets) {}
    collision(point: Point): void {
        // Contact manifolds are recycled by Box2D. Copy coordinates now; spawn after the callback.
        if (this.contacts.length < 32) this.contacts.push({ x: point.x, y: point.y });
    }
    reinforce(point: Point): void { this.play('reinforcement', point); }
    private play(kind: Kind, point: Point): void {
        if (this.active.length >= 48) return;
        let entry = this.free.pop();
        if (!entry) {
            const node = new Node('DeploymentEffect'); node.layer = this.root.layer;
            node.addComponent(UITransform).setContentSize(1, 1); this.root.addChild(node);
            const skeleton = node.addComponent(sp.Skeleton);
            skeleton.setAnimationCacheMode(sp.Skeleton.AnimationCacheMode.SHARED_CACHE);
            skeleton.enableBatch = true; this.assets.attachBatch(skeleton);
            entry = { node, skeleton, kind, elapsed: 0, duration: 0 };
        }
        const { node, skeleton } = entry;
        node.active = false; node.name = kind === 'collision' ? 'CollisionSpark' : 'ReinforcementEffect';
        node.setPosition(point.x, point.y); node.setScale(1, 1, 1); node.angle = 0;
        const data = kind === 'collision' ? this.assets.collision : this.assets.reinforcement;
        if (skeleton.skeletonData !== data) skeleton.skeletonData = data;
        node.active = true;
        skeleton.timeScale = this.speed;
        skeleton.setAnimation(0, kind === 'collision' ? 'animation' : 'luodi', false);
        entry.kind = kind; entry.elapsed = 0;
        entry.duration = kind === 'collision' ? this.assets.collisionDuration : this.assets.reinforcementDuration;
        this.active.push(entry);
    }
    step(dt: number): void {
        if (this.speed === 0) return;
        this.active = this.active.filter(entry => {
            entry.elapsed += Math.max(0, dt) * this.speed;
            if (entry.elapsed + 1e-7 < entry.duration) return true;
            entry.node.active = false; this.free.push(entry); return false;
        });
        for (const point of this.contacts) this.play('collision', point);
        this.contacts.length = 0;
    }
    setSpeed(speed: number): void {
        this.speed = speed;
        for (const entry of this.active) entry.skeleton.timeScale = speed;
    }
    clear(): void {
        this.contacts.length = 0;
        for (const entry of this.active) { entry.node.active = false; this.free.push(entry); }
        this.active.length = 0;
    }
    destroy(): void {
        for (const entry of [...this.active, ...this.free]) {
            this.assets.detachBatch(entry.skeleton);
            // Scene children can already be destroyed before MatchController.onDestroy runs.
            if (isValid(entry.node, true)) entry.node.destroy();
        }
        this.contacts.length = this.active.length = this.free.length = 0;
    }
}
