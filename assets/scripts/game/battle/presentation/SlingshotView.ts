import { _decorator, Component, Graphics, Color, Vec2, Vec3, UITransform, sp } from 'cc';
import type { Point } from '../../../model/battle/types';
import { TEAM_COLORS } from '../../../ui/theme/BattleTheme';
import { slingAim, slingRecoil } from '../../../model/battle/SlingshotMotion';
const { ccclass, property, executeInEditMode } = _decorator;

@ccclass('SlingshotView')
@executeInEditMode
export class SlingshotView extends Component {
    @property team = 0;
    private pouch = new Vec2();
    private skeleton?: sp.Skeleton;
    private track?: sp.spine.TrackEntry;
    private bones: sp.spine.Bone[] = [];
    private animated: { bone: sp.spine.Bone; rest: number[]; full: number[] }[] = [];
    private restSocket = new Vec2();
    private stretch = 0;
    private aimAngle = 0;
    private recoilTime = -1;
    private recoilStretch = 0;
    private recoilAngle = 0;
    get spineDriven(): boolean { return !!this.node.getChildByName('shotSpine'); }
    bind(data: sp.SkeletonData): void {
        const skeleton = this.node.getChildByName('shotSpine')?.getComponent(sp.Skeleton);
        if (!skeleton) throw new Error(`${this.node.name} requires shotSpine`);
        this.skeleton = undefined; this.track = undefined; this.bones = []; this.animated = [];
        skeleton.skeletonData = data; this.ensureSpine(); this.reset();
    }
    onLoad(): void { this.redraw(); }
    onEnable(): void { this.redraw(); }
    onRestore(): void { this.redraw(); }
    pull(offset: Point): void { this.pouch.set(offset.x, offset.y); this.redraw(); }
    reset(): void {
        this.recoilTime = -1; this.stretch = 0; this.aimAngle = 0;
        if (this.spineDriven) {
            this.ensureSpine(); this.pose(0);
            this.skeleton!.setAnimation(0, 'idle', true); this.track = undefined;
            this.skeleton!.timeScale = 1; this.skeleton!.paused = false;
        }
        else this.pull({ x: 0, y: 0 });
    }
    /** World coordinates are read from the actual animated string centre (bone2). */
    restWorldPosition(): Vec3 {
        if (!this.spineDriven) return this.node.worldPosition.clone();
        this.ensureSpine();
        return this.skeleton!.node.getComponent(UITransform)!.convertToWorldSpaceAR(
            new Vec3(this.restSocket.x, this.restSocket.y));
    }
    /** Centre of a hero base mounted just inside the rotating string. */
    mountedWorldPosition(halfHeight: number, rest = false): Vec3 {
        if (!this.spineDriven) {
            return this.node.getComponent(UITransform)!.convertToWorldSpaceAR(new Vec3(0, this.team === 0 ? halfHeight : -halfHeight));
        }
        this.ensureSpine();
        const socket = this.skeleton!.findBone('bone2')!;
        const x = rest ? this.restSocket.x : socket.worldX;
        const y = rest ? this.restSocket.y : socket.worldY;
        const angle = (rest ? 0 : this.aimAngle) * Math.PI / 180;
        return this.skeleton!.node.getComponent(UITransform)!.convertToWorldSpaceAR(
            new Vec3(x - Math.sin(angle) * halfHeight, y + Math.cos(angle) * halfHeight));
    }
    aimPull(pull: Point, limit: number): Vec3 {
        this.ensureSpine(); this.recoilTime = -1;
        // RedSlingshotEx is authored with a 180-degree node rotation.
        const localPull = this.team === 0 ? pull : { x: -pull.x, y: -pull.y };
        const aim = slingAim(localPull, limit); this.aimAngle = aim.angle; this.stretch = aim.stretch;
        this.pose(this.stretch);
        const socket = this.skeleton!.findBone('bone2')!;
        return this.skeleton!.node.getComponent(UITransform)!.convertToWorldSpaceAR(new Vec3(socket.worldX, socket.worldY));
    }
    release(): void {
        if (!this.spineDriven) { this.reset(); return; }
        this.recoilStretch = this.stretch; this.recoilAngle = this.aimAngle; this.recoilTime = 0;
    }
    stepRecoil(dt: number): void {
        if (this.recoilTime < 0) return;
        this.recoilTime += dt;
        this.aimAngle = this.recoilAngle * Math.exp(-8 * this.recoilTime);
        this.pose(slingRecoil(this.recoilStretch, this.recoilTime));
        if (this.recoilTime >= .65) this.reset();
    }
    snapshot(): object { return { spine: this.spineDriven, angle: this.aimAngle, stretch: this.stretch, recoil: this.recoilTime }; }
    private ensureSpine(): void {
        if (this.skeleton) return;
        const s = this.node.getChildByName('shotSpine')?.getComponent(sp.Skeleton);
        if (!s?.skeletonData || !s.findAnimation('attack') || !s.findAnimation('idle')) throw new Error(`${this.node.name} requires idle/attack Spine`);
        s.setAnimationCacheMode(sp.Skeleton.AnimationCacheMode.REALTIME);
        this.skeleton = s;
        const data = s.skeletonData.skeletonJson as any;
        this.bones = data.bones.map((b: { name: string }) => {
            const bone = s.findBone(b.name); if (!bone) throw new Error(`Launcher bone missing: ${b.name}`); return bone;
        });
        for (const name of ['bone', 'zong', 'bone2']) if (!s.findBone(name)) throw new Error(`Launcher bone missing: ${name}`);
        s.timeScale = 0; s.paused = false; s.setToSetupPose();
        const track = s.setAnimation(0, 'attack', false);
        if (!track) throw new Error('Launcher must use real-time animation');
        track.mixDuration = 0; this.track = track;
        const read = (b: sp.spine.Bone): number[] => [b.x, b.y, b.rotation, b.scaleX, b.scaleY];
        track.trackTime = 0; s.updateAnimation(0);
        const socket = s.findBone('bone2')!;
        this.restSocket.set(socket.worldX, socket.worldY);
        this.animated = Object.keys(data.animations.attack.bones).map(name => {
            const bone = s.findBone(name)!; return { bone, rest: read(bone), full: [] };
        });
        track.trackTime = track.animation.duration; s.updateAnimation(0);
        for (const entry of this.animated) entry.full = read(entry.bone);
        this.pose(0);
    }
    private pose(value: number): void {
        const s = this.skeleton!;
        if (!this.track) {
            this.track = s.setAnimation(0, 'attack', false) ?? undefined;
            if (!this.track) throw new Error('Launcher attack track missing');
            this.track.mixDuration = 0;
        }
        const track = this.track;
        s.timeScale = 0; s.paused = false; s.setToSetupPose();
        track.trackTime = Math.max(0, value) * track.animation.duration; s.updateAnimation(0);
        // A small signed extension of the exported linear pull gives the released string
        // a forward overshoot, without editing the source animation or stretching its node.
        if (value < 0) for (const { bone: b, rest: r, full: f } of this.animated) {
            const v = r.map((x, i) => x + (f[i] - x) * value);
            [b.x, b.y, b.rotation, b.scaleX, b.scaleY] = v;
        }
        // The circular mount (zongaaaa/nuy23) stays fixed. Rotate the stock and
        // weighted bow/string together around it, preserving the source rig and scale.
        for (const name of ['bone', 'zong']) {
            const b = s.findBone(name)!; b.rotation = b.data.rotation + this.aimAngle;
        }
        for (const b of this.bones) b.updateWorldTransform();
        s.paused = true;
    }
    private redraw(): void {
        const body = this.node.getChildByName('Body')?.getComponent(Graphics);
        const bands = this.node.getChildByName('Bands')?.getComponent(Graphics);
        if (!body || !bands) return;
        const sign = this.team === 0 ? -1 : 1;
        const color = new Color().fromHEX(TEAM_COLORS[this.team]);
        body.clear(); body.lineWidth = 16; body.strokeColor = new Color(64, 79, 81);
        body.moveTo(-54, 0); body.lineTo(-32, sign * 38); body.lineTo(0, sign * 58);
        body.lineTo(32, sign * 38); body.lineTo(54, 0); body.stroke();
        body.lineWidth = 6; body.strokeColor = color;
        for (const x of [-54, 54]) { body.moveTo(x, -9); body.lineTo(x, 9); body.stroke(); }
        body.fillColor = color; body.circle(0, sign * 58, 7); body.fill();
        bands.clear(); bands.lineWidth = 5; bands.strokeColor = new Color(237, 214, 154);
        bands.moveTo(-54, 0); bands.lineTo(this.pouch.x, this.pouch.y);
        bands.lineTo(54, 0); bands.stroke();
        bands.fillColor = new Color(129, 101, 67);
        bands.roundRect(this.pouch.x - 15, this.pouch.y - 8, 30, 16, 5); bands.fill();
    }
}
