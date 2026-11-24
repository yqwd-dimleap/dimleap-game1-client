import { _decorator, Component, Node, UIOpacity, UITransform, isValid, sp } from 'cc';
import { HeroId, RULES, Team } from '../../../model/config/PrototypeConfig';
import { rangedAttack } from '../../../model/battle/CombatTiming';
import { TroopAssets } from './TroopAssets';
import { BATTLE_FEEDBACK, DEFAULT_HIT_OPACITY } from './BattleFeedbackSettings';
const { ccclass } = _decorator;

const HIT_FADE_SECONDS = .7;

@ccclass('TroopSpineView')
export class TroopSpineView extends Component {
    private skeleton!: sp.Skeleton;
    private attackFx?: sp.Skeleton;
    private opacity?: UIOpacity;
    private hitFade = 0;
    private hitMinOpacity = DEFAULT_HIT_OPACITY;
    private speed = 1;
    private clipScale = 1;
    private current = '';
    private held = false;
    private direction = 1;
    private turnDirection = 0;
    private turnSeconds = 0;
    private turnDistance = 0;
    private hero?: HeroId;
    private team?: Team;
    private requested: 'idle' | 'walk' | 'attack' = 'idle';
    private requestedDuration?: number;
    private cached = false;
    private batched = true;
    private displayRole: 'combat' | 'token' = 'combat';
    private arrivalScale = 1;
    private dying = false;
    private assets!: TroopAssets;
    setDisplayRole(role: 'combat' | 'token'): void {
        this.displayRole = role; this.applyDisplayScale();
    }
    applyDisplayScale(): void {
        const scale = this.displayRole === 'token' ? RULES.tokenTroopScale : BATTLE_FEEDBACK.troopScale;
        this.node.setScale(scale * this.arrivalScale, scale * this.arrivalScale, 1);
    }
    setArrivalScale(scale: number): void { this.arrivalScale = scale; this.applyDisplayScale(); }
    onEnable(): void {
        if (this.dying) return;
        // Waiting tokens configure while inactive, before Skeleton has created its runtime data.
        if (this.hero) {
            const held = this.held;
            this.current = ''; this.play(this.requested, this.requestedDuration);
            if (held) this.holdPose();
        }
    }
    setTeam(team: Team, assets: TroopAssets): void {
        if (team === this.team || !this.hero || !this.skeleton) return;
        this.team = team;
        this.skeleton.customMaterial = team === 1 ? assets.enemyMaterial(this.hero) : null;
    }
    configure(hero: HeroId, assets: TroopAssets, initial: 'idle' | 'walk' = 'idle', facingX = 1,
        cached = false, batch = true, reset = false): void {
        const same = this.hero === hero;
        // Apply before the early return too; never derive size from pose/weapon bounds.
        this.applyDisplayScale();
        if (same && this.cached === cached && this.batched === batch && !reset && !this.dying) return;
        this.clearAttackEffect();
        this.resetHitOpacity();
        this.dying = false; this.assets = assets;
        this.cached = cached; this.batched = batch;
        this.hero = hero;
        this.direction = 1;
        this.team = undefined;
        this.skeleton = this.getComponent(sp.Skeleton)!;
        assets.attachBatch(this.skeleton);
        this.skeleton.enableBatch = batch;
        this.skeleton.setAnimationCacheMode(cached ? sp.Skeleton.AnimationCacheMode.SHARED_CACHE : sp.Skeleton.AnimationCacheMode.REALTIME);
        if (!same || this.skeleton.skeletonData !== assets.get(hero)) this.skeleton.skeletonData = assets.get(hero);
        this.setFacing(facingX);
        this.current = ''; this.play(initial);
    }
    setFacing(x: number): void {
        // Directional exports keep glyphs readable. Near-vertical motion retains its last side.
        if (Number.isFinite(x) && Math.abs(x) > .05) this.direction = x < 0 ? -1 : 1;
        this.turnDirection = 0; this.turnSeconds = 0; this.turnDistance = 0;
    }
    setMovementFacing(x: number, deltaX: number, dt: number): void {
        // Short avoidance steps and nearly vertical travel must not restart left/right clips.
        const candidate = Number.isFinite(x) && Math.abs(x) >= .2 ? Math.sign(x) : 0;
        if (!candidate || candidate === this.direction || Math.abs(deltaX) < .001) {
            this.turnDirection = 0; this.turnSeconds = 0; this.turnDistance = 0;
            return;
        }
        if (candidate !== this.turnDirection) {
            this.turnDirection = candidate; this.turnSeconds = 0; this.turnDistance = 0;
        }
        this.turnSeconds += dt; this.turnDistance += Math.abs(deltaX);
        if (this.turnSeconds + 1e-6 >= .12 && this.turnDistance >= 4) this.setFacing(candidate);
    }
    play(requested: 'idle' | 'walk' | 'attack', duration?: number, restart = false): void {
        if (this.dying) return;
        this.requested = requested; this.requestedDuration = duration;
        this.held = false;
        // B_huopaoche exports its left-facing clips as the base names and right-facing clips with suffix 2.
        const useSecondClip = this.hero === 'huopaoche' ? this.direction > 0 : this.direction < 0;
        const directional = useSecondClip ? `${requested}2` : requested;
        // Stable clips are the hot path for a large army: avoid repeated native animation lookups.
        if (this.current === directional && !restart) {
            const speed = this.clipScale * this.speed;
            if (this.skeleton.timeScale !== speed) this.skeleton.timeScale = speed;
            return;
        }
        if (!this.skeleton?.findAnimation('idle')) return;
        const animation = this.skeleton.findAnimation(directional) ? directional
            : this.skeleton.findAnimation(requested) ? requested : 'idle';
        if (this.current === animation && !restart) {
            this.skeleton.timeScale = this.clipScale * this.speed;
            return;
        }
        const clip = this.skeleton.findAnimation(animation);
        this.clipScale = duration && clip ? clip.duration / duration : 1;
        this.skeleton.timeScale = this.clipScale * this.speed;
        const previous = this.current;
        const walkingTurn = previous.startsWith('walk') && animation.startsWith('walk');
        const oldEntry = walkingTurn && !this.skeleton.isAnimationCached() ? this.skeleton.getCurrent(0) : null;
        const oldDuration = oldEntry?.animation?.duration ?? 0;
        const phase = oldDuration > 0 ? (oldEntry!.trackTime % oldDuration) / oldDuration : 0;
        // Blend locomotion and attacks on the same side. A new attack still starts at time zero,
        // so its windup and arrow release stay aligned with the combat rules.
        if (previous && previous !== animation &&
            ((previous.endsWith('2') === animation.endsWith('2') &&
                ((previous.startsWith('walk') && requested === 'attack') || (previous.startsWith('attack') && requested === 'walk'))) ||
                (rangedAttack(this.hero!) && previous.startsWith('attack') && requested === 'idle')) &&
            !this.skeleton.isAnimationCached()) {
            this.skeleton.setMix(previous, animation, Math.min(.06, (duration ?? .3) * .2) * this.clipScale);
        }
        this.current = animation;
        const entry = this.skeleton.setAnimation(0, animation, requested !== 'attack');
        if (walkingTurn && entry && clip) entry.trackTime = phase * clip.duration;
        if (requested === 'attack') this.playAttackEffect(animation); else this.clearAttackEffect();
    }
    private playAttackEffect(animation: string): void {
        const data = this.assets.attackEffect(this.hero!);
        if (!data) return;
        if (!this.attackFx) {
            const node = new Node('AttackEffect'); node.layer = this.node.layer;
            this.node.addChild(node); node.addComponent(UITransform);
            this.attackFx = node.addComponent(sp.Skeleton); this.attackFx.enableBatch = true;
            this.assets.attachBatch(this.attackFx);
        }
        const fx = this.attackFx; fx.node.active = true;
        if (fx.skeletonData !== data) fx.skeletonData = data;
        fx.setCompleteListener(() => { if (isValid(fx.node, true)) fx.node.active = false; });
        const clip = fx.findAnimation(animation) ? animation : 'attack';
        // Liu Bei has one symmetric effect; only directional artwork with a missing left variant mirrors.
        fx.node.setScale(animation.endsWith('2') && clip !== animation ? -1 : 1, 1, 1);
        fx.timeScale = this.clipScale * this.speed; fx.setAnimation(0, clip, false);
    }
    private clearAttackEffect(): void {
        if (isValid(this.attackFx, true)) { this.attackFx!.clearTracks(); this.attackFx!.node.active = false; }
    }
    playHit(minimumOpacity = BATTLE_FEEDBACK.hitOpacity, restart = false): void {
        if (this.dying || (!restart && this.hitFade > 0)) return;
        const opacity = this.getComponent(UIOpacity) ?? this.addComponent(UIOpacity);
        if (!opacity) return;
        this.opacity = opacity;
        this.hitMinOpacity = Math.max(0, Math.min(1, minimumOpacity));
        this.hitFade = HIT_FADE_SECONDS;
        opacity.opacity = Math.round(this.hitMinOpacity * 255);
    }
    private resetHitOpacity(): void {
        this.hitFade = 0;
        if (this.opacity) this.opacity.opacity = 255;
    }
    update(dt: number): void {
        if (this.hitFade <= 0 || !this.opacity) return;
        this.hitFade = Math.max(0, this.hitFade - dt * Math.max(0, this.speed));
        const progress = 1 - this.hitFade / HIT_FADE_SECONDS;
        const minimum = Math.round(this.hitMinOpacity * 255);
        this.opacity.opacity = Math.round(minimum + (255 - minimum) * progress);
    }
    playDeath(): number {
        if (!this.dying) {
            this.clearAttackEffect();
            this.resetHitOpacity();
            this.dying = true; this.held = false; this.clipScale = 1; this.current = '';
            this.skeleton.customMaterial = null;
            this.skeleton.setAnimationCacheMode(sp.Skeleton.AnimationCacheMode.SHARED_CACHE);
            this.skeleton.skeletonData = this.assets.death;
            this.skeleton.timeScale = this.speed;
            this.skeleton.setAnimation(0, 'animation', false);
        }
        return this.assets.deathDuration;
    }
    holdPose(): void {
        this.held = true;
        if (this.skeleton) this.skeleton.timeScale = 0;
        if (this.attackFx) this.attackFx.timeScale = 0;
    }
    wait(): void {
        // Waiting for a path is not a pause: finish the hopping walk cycle or the
        // current non-looping swing naturally instead of freezing it halfway through.
        this.held = false;
        if (this.skeleton) this.skeleton.timeScale = this.clipScale * this.speed;
    }
    setPlaybackScale(speed: number): void {
        this.speed = speed;
        const value = this.held ? 0 : this.clipScale * speed;
        if (this.skeleton && this.skeleton.timeScale !== value) this.skeleton.timeScale = value;
        if (this.attackFx) this.attackFx.timeScale = value;
    }
    onDisable(): void { this.clearAttackEffect(); this.resetHitOpacity(); }
    onDestroy(): void {
        if (this.attackFx) this.assets?.detachBatch(this.attackFx);
        if (this.skeleton) this.assets?.detachBatch(this.skeleton);
    }
}
