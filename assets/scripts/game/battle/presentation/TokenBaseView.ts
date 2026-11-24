import { Node, sp } from 'cc';
import { Team } from '../../../model/config/PrototypeConfig';
import { TOKEN_BASE_CLIPS } from './TokenBaseConfig';
type BaseClip = typeof TOKEN_BASE_CLIPS[number];

/** Presentation only: its animated scale never changes the token's Box2D body. */
export class TokenBaseView {
    private readonly skeleton: sp.Skeleton;
    private readonly mount: Node;
    private readonly troops: Node;
    private clip: BaseClip;
    private elapsed = 0;
    private started = false;
    private landed = false;
    private speed = 1;
    private angle = 0;
    private hidden = false;
    private durations = new Map<BaseClip, number>();
    private bornUsesMount = false;
    private readonly skin: string;
    constructor(private readonly node: Node, data: sp.SkeletonData, team: Team, placed = false) {
        this.skeleton = node.getComponent(sp.Skeleton)!;
        this.mount = node.getChildByName('BoneMount')!;
        this.troops = this.mount?.getChildByName('Troops')!;
        if (!this.skeleton || !this.mount || !this.troops) throw new Error('HeroToken/Board requires Spine and BoneMount/Troops');
        this.clip = placed ? 'idle2' : 'born'; this.landed = placed;
        this.skeleton.setAnimationCacheMode(sp.Skeleton.AnimationCacheMode.REALTIME);
        this.skeleton.enableBatch = true;
        this.skeleton.skeletonData = data;
        this.skin = team === 0 ? 'lan' : 'hong';
        this.skeleton.paused = true;
        // Current artwork animates bone15 during born; future exports may key the requested mount directly.
        this.bornUsesMount = !!(data.skeletonJson as any)?.animations?.born?.bones?.bone?.scale;
    }
    get troopRoot(): Node { return this.troops; }
    get state(): string { return this.hidden ? 'hidden' : this.clip; }
    get appearing(): boolean { return this.clip === 'born' && !this.hidden; }
    setAngle(degrees: number): void {
        this.angle = degrees; this.node.angle = degrees;
        // The base rotates with the bow; the existing upright troop presentation is retained.
        this.troops.angle = -degrees;
    }
    setSpeed(speed: number): void { this.speed = speed; }
    land(): void {
        if (this.landed || this.clip === 'xiaoshi' || this.hidden) return;
        this.landed = true; this.change('luodi');
    }
    disappear(): void {
        if (this.clip === 'xiaoshi' || this.hidden) return;
        // Combat troops replace these views immediately; only the base plays the exit effect.
        this.troops.active = false; this.change('xiaoshi');
    }
    step(dt: number): void {
        if (this.hidden) return;
        if (!this.started) {
            // Tokens configure while inactive. Runtime bones exist after the child Skeleton enables.
            if (!this.node.activeInHierarchy) return;
            for (const clip of TOKEN_BASE_CLIPS) {
                const animation = this.skeleton.findAnimation(clip);
                if (!animation) throw new Error(`底座动画缺失：${clip}`);
                this.durations.set(clip, animation.duration);
            }
            if (!this.skeleton.findBone('bone') || !this.skeleton.findBone('bone15')) throw new Error('底座缺少 root/bone 或 bone15');
            this.skeleton.setSkin(this.skin);
            this.skeleton.sockets = [new sp.Skeleton.SpineSocket('root/bone', this.mount)];
            this.started = true; this.play();
        }
        let remaining = Math.max(0, Math.min(dt, .1)) * this.speed;
        // Consume a one-shot's remaining time before advancing its idle, including at x2 speed.
        while (remaining > 0 && !this.hidden) {
            const once = this.clip === 'born' || this.clip === 'luodi' || this.clip === 'xiaoshi';
            const duration = this.durations.get(this.clip)!;
            const delta = once ? Math.min(remaining, Math.max(0, duration - this.elapsed)) : remaining;
            this.advance(delta); this.elapsed += delta; remaining -= delta;
            if (!once || this.elapsed + 1e-7 < duration) break;
            if (this.clip === 'xiaoshi') {
                this.hidden = true; this.node.active = false;
            } else this.change(this.clip === 'born' ? 'idle' : 'idle2');
        }
        this.syncMount();
    }
    private change(clip: BaseClip): void {
        this.clip = clip; this.elapsed = 0;
        if (this.started) this.play();
    }
    private play(): void {
        this.skeleton.clearTracks(); this.skeleton.setToSetupPose();
        const entry = this.skeleton.setAnimation(0, this.clip, this.clip === 'idle' || this.clip === 'idle2');
        if (entry) entry.mixDuration = 0;
        this.advance(0); this.syncMount();
    }
    private advance(dt: number): void {
        // One clock owns animation and mount updates. The engine's later Spine pass stays paused.
        this.skeleton.paused = false;
        this.skeleton.updateAnimation(dt);
        this.skeleton.paused = true;
    }
    private syncMount(): void {
        // Creator synchronizes the authored root/bone socket after component updates.
        const birth = this.clip === 'born' && !this.bornUsesMount ? this.skeleton.findBone('bone15') : null;
        this.troops.setScale(birth ? birth.scaleX / birth.data.scaleX : 1,
            birth ? birth.scaleY / birth.data.scaleY : 1, 1);
        this.troops.angle = -this.angle;
    }
}
