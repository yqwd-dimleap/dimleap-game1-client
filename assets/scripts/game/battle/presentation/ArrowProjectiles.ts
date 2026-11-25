import { instantiate, Node, Prefab, sp } from 'cc';
import { AttackEvent, ProjectileState } from '../../../model/battle/CombatModel';
import { ProjectileKind, projectilePose, rangedAttack } from '../../../model/battle/CombatTiming';
import { TroopAssets } from './TroopAssets';
import { BATTLE_FEEDBACK } from './BattleFeedbackSettings';

/** Shared atlas, bounded pools, and model-owned flight/landing. No target homing in the view. */
export class ArrowProjectiles {
    private active = new Map<number, Node>();
    private free: Node[] = [];
    private impacts: { node: Node; until: number }[] = [];
    private ids = new Set<number>();
    private playbackRates = new Map<Node, number>();
    private speed = 1;
    constructor(private root: Node, private prefab: Prefab, private assets: TroopAssets, private poolLimit = 128) { }
    private acquire(kind: ProjectileKind, art: NonNullable<ReturnType<TroopAssets['projectileArt']>>,
        impact = false, fitDuration?: number): Node {
        const node = this.free.pop() ?? instantiate(this.prefab);
        if (!node.parent) {
            this.root.addChild(node);
            const setLayer = (n: Node): void => { n.layer = this.root.layer; n.children.forEach(setLayer); }; setLayer(node);
        }
        node.active = true; node.angle = 0;
        const visual = node.getChildByName('SpineVisual')!, skeleton = visual.getComponent(sp.Skeleton)!;
        this.assets.attachBatch(skeleton);
        const { data, clip } = art;
        if (skeleton.skeletonData !== data) skeleton.skeletonData = data;
        const header = (data.skeletonJson as any).skeleton;
        const defaultScale = art.native ? BATTLE_FEEDBACK.troopScale : impact ? .6 : (kind === 'arrow' ? 14 : kind === 'bolt' ? 18 : 22) / header.height;
        const scale = impact ? (art.impactScale ?? art.scale ?? defaultScale) : (art.scale ?? defaultScale);
        visual.setScale(scale, scale, 1);
        const cx = header.x + header.width / 2, cy = header.y + header.height / 2;
        visual.setPosition(impact ? 0 : art.native ? (art.center ? -art.center.x * scale : 0) : (kind === 'arrow' ? cy : -cx) * scale,
            impact ? 0 : art.native ? (art.center ? -art.center.y * scale : 0) : (kind === 'arrow' ? -cx : -cy) * scale);
        const clipDuration = data.getRuntimeData()?.findAnimation(clip)?.duration ?? 0;
        const desiredDuration = impact && art.clip === 'attack' ? fitDuration : impact ? undefined : art.flightDuration;
        const rate = impact && art.impactPlaybackRate
            ? art.impactPlaybackRate
            : desiredDuration && clipDuration > 0 ? clipDuration / desiredDuration : 1;
        this.playbackRates.set(node, rate);
        skeleton.enableBatch = true; skeleton.timeScale = rate * this.speed;
        skeleton.setAnimation(0, clip, !impact);
        return node;
    }
    private release(node: Node): void {
        node.active = false;
        this.playbackRates.delete(node);
        if (this.free.length < this.poolLimit) this.free.push(node); else {
            this.assets.detachBatch(node.getChildByName('SpineVisual')!.getComponent(sp.Skeleton)!); node.destroy();
        }
    }
    impact(events: readonly AttackEvent[], elapsed: number): void {
        for (const event of events) {
            const kind = rangedAttack(event.hero)?.kind;
            if (event.phase !== 'impact' || !kind || this.impacts.length >= 64) continue;
            const art = this.assets.projectileArt(event.hero, kind, true);
            if (!art) continue;
            const node = this.acquire(kind, art, true, event.attackDuration); node.setPosition(event.to.x, event.to.y);
            const duration = art.data.getRuntimeData()?.findAnimation(art.clip)?.duration ?? (kind === 'bolt' ? .8 : .4);
            this.impacts.push({ node, until: elapsed + duration });
        }
    }
    sync(projectiles: readonly ProjectileState[], elapsed = 0, speed = 1): void {
        this.setSpeed(speed);
        this.impacts = this.impacts.filter(impact => {
            if (impact.until > elapsed) return true;
            this.release(impact.node); return false;
        });
        this.ids.clear(); for (const p of projectiles) this.ids.add(p.id);
        for (const [id, node] of this.active) if (!this.ids.has(id)) {
            this.active.delete(id); this.release(node);
        }
        for (const projectile of projectiles) {
            const art = this.assets.projectileArt(projectile.hero, projectile.kind);
            if (!art) continue;
            let node = this.active.get(projectile.id);
            if (!node) { node = this.acquire(projectile.kind, art); this.active.set(projectile.id, node); }
            const pose = projectilePose(projectile);
            node.setPosition(pose.x, pose.y);
            // Arrow and shell clips point up (+Y); the flight tangent is measured from +X.
            node.angle = pose.angle - art.axis;
        }
    }
    setSpeed(speed: number): void {
        if (speed === this.speed) return;
        this.speed = speed;
        for (const node of [...Array.from(this.active.values()), ...this.impacts.map(i => i.node)])
            node.getChildByName('SpineVisual')!.getComponent(sp.Skeleton)!.timeScale =
                (this.playbackRates.get(node) ?? 1) * speed;
    }
    clear(): void {
        for (const node of [...Array.from(this.active.values()), ...this.free, ...this.impacts.map(i => i.node)]) if (node.isValid) {
            const skeleton = node.getChildByName('SpineVisual')?.getComponent(sp.Skeleton);
            if (skeleton) this.assets.detachBatch(skeleton);
            node.destroy();
        }
        this.active.clear(); this.free = []; this.impacts = []; this.ids.clear(); this.playbackRates.clear();
    }
}
