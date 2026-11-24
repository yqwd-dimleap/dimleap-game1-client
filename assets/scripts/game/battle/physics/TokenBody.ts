import { _decorator, Component, RigidBody2D, CircleCollider2D, Vec2, Label, Color, UITransform, UIOpacity, instantiate, Node } from 'cc';
import { Deployment, HeroId, HEROES, Point, RULES, Team, Zone, ZONES, zoneAt } from '../../../model/config/PrototypeConfig';
import { insideArena } from '../../../model/battle/ThrowMath';
import { TroopAssets } from '../presentation/TroopAssets';
import { TroopSpineView } from '../presentation/TroopSpineView';
import { deploymentTroopCount, heroStats } from '../../../model/hero/HeroProgress';
import { TokenBaseView } from '../presentation/TokenBaseView';
const { ccclass } = _decorator;
const BONUS_COLOR = new Color().fromHEX('#52FF56');
const NORMAL_COLOR = new Color().fromHEX('#FFFFFF');
const GAIN_COLOR = new Color().fromHEX('#52FF56');
const LOSS_COLOR = new Color().fromHEX('#FF4D4D');

@ccclass('TokenBody')
export class TokenBody extends Component {
    static readonly boardScale = 1;
    id = 0;
    team: Team = 0;
    hero: HeroId = 'shield';
    level = 1;
    zones: readonly Zone[] = ZONES;
    launched = false;
    enteredArena = false;
    private shownCount = -1;
    private bonusZoneId?: string;
    private troopVisuals: TroopSpineView[] = [];
    private assets!: TroopAssets;
    private baseView!: TokenBaseView;
    private bonusNode!: Node;
    private bonusLabel!: Label;
    private initialCount = 0;
    private readonly probe: Deployment = { id: 0, team: 0, hero: 'shield', level: 1, x: 0, y: 0 };
    private exiting = false;
    private playbackScale = 1;
    private countChange?: { label: Label; opacity: UIOpacity; elapsed: number; direction: number };
    private arrivals = new Map<TroopSpineView, { x: number; y: number; elapsed: number; delay: number }>();
    get baseAppearing(): boolean { return this.baseView.appearing; }
    get baseState(): string { return this.baseView.state; }
    get displayedBonus(): number { return Math.max(0, this.shownCount - this.initialCount); }
    get displayedZoneId(): string | undefined { return this.bonusZoneId; }
    get body(): RigidBody2D { return this.getComponent(RigidBody2D)!; }
    get moving(): boolean {
        const body = this.body;
        return this.launched && !!body &&
            (body.linearVelocity.length() > RULES.stopSpeed ||
                Math.abs(body.angularVelocity) > RULES.stopAngularSpeed);
    }
    configure(id: number, team: Team, hero: HeroId, live: boolean, assets: TroopAssets): void {
        this.id = id; this.team = team; this.hero = hero; this.launched = live; this.enteredArena = live && insideArena(this.node.position);
        this.assets = assets; this.shownCount = -1;
        const base = this.node.getChildByName('Board')!;
        this.baseView = new TokenBaseView(base, assets.tokenBase, team, live);
        base.setScale(TokenBody.boardScale, TokenBody.boardScale, 1);
        const glyph = this.node.getChildByName('Glyph')!.getComponent(Label)!;
        glyph.string = HEROES[hero].glyph; glyph.fontSize = 36; glyph.isBold = true;
        glyph.color = new Color().fromHEX('#33261B');
        glyph.node.active = false;
        this.bonusNode = this.node.getChildByName('Bonus')!;
        this.bonusLabel = this.bonusNode.getComponent(Label)!;
        this.initialCount = heroStats(this.hero, this.level).count;
        if (!this.troopVisuals.length) this.troopVisuals.push(this.baseView.troopRoot.getChildByName('SpineVisual')!.getComponent(TroopSpineView)!);
        for (const visual of this.troopVisuals) this.configureVisual(visual);
        const body = this.body;
        body.linearDamping = RULES.damping; body.angularDamping = 3;
        body.fixedRotation = true; body.bullet = true; body.gravityScale = 0;
        const collider = this.getComponent(CircleCollider2D)!;
        collider.radius = RULES.tokenRadius; collider.offset = new Vec2();
        collider.restitution = RULES.restitution; collider.group = 1;
        body.enabled = live; collider.enabled = live;
        this.refreshBonus();
    }
    launch(vx: number, vy: number): void {
        this.setMountAngle(0);
        this.launched = true; this.enteredArena = insideArena(this.node.position);
        // Collider.group updates existing Box2D fixture filters; RigidBody.group alone does not.
        this.getComponent(CircleCollider2D)!.group = this.enteredArena ? 1 : 4;
        this.body.enabled = true;
        this.getComponent(CircleCollider2D)!.enabled = true;
        this.body.wakeUp(); this.body.linearVelocity = new Vec2(vx, vy);
    }
    /** Rotate the base around its visual centre; the hero and physics stay upright. */
    setMountAngle(degrees: number): void {
        this.baseView.setAngle(degrees);
    }
    update(dt: number): void {
        this.baseView?.step(dt);
        for (const [visual, arrival] of this.arrivals) {
            arrival.elapsed += Math.max(0, Math.min(dt, .1)) * this.playbackScale;
            // Match the reinforcement clip's impact at ~0.433 seconds, with a small stagger.
            const elapsed = Math.max(0, arrival.elapsed - arrival.delay);
            const t = Math.min(1, elapsed / .4333);
            let height = 150 * (1 - t * t);
            if (elapsed >= .4333) {
                // Two diminishing hops soften the landing without changing the base's physics.
                const rebound = elapsed - .4333;
                const small = rebound >= .24;
                const hop = Math.min(1, (small ? rebound - .24 : rebound) / (small ? .16 : .24));
                height = (small ? 4 : 18) * 4 * hop * (1 - hop);
            }
            visual.node.setPosition(arrival.x, arrival.y + height, 0);
            visual.setArrivalScale(1 + .9 * (1 - t));
            if (elapsed >= .4333 + .24 + .16) this.arrivals.delete(visual);
        }
        const change = this.countChange;
        if (change?.label.node.active) {
            change.elapsed += Math.max(0, Math.min(dt, .1)) * this.playbackScale;
            const t = Math.min(1, change.elapsed / .9);
            const total = this.bonusNode.position;
            change.label.node.setPosition(total.x, total.y - 34 + change.direction * 20 * t, 0);
            const scale = change.elapsed < .12 ? .75 + .45 * (1 - (1 - change.elapsed / .12) ** 2)
                : 1 + .2 * (1 - Math.min(1, (change.elapsed - .12) / .12));
            change.label.node.setScale(scale, scale, 1);
            change.opacity.opacity = 255 * Math.min(1, (1 - t) / .3);
            if (t === 1) change.label.node.active = false;
        }
        if (this.exiting && this.baseView.state === 'hidden') this.node.active = false;
    }
    setPlaybackScale(speed: number): void { this.playbackScale = speed; this.baseView?.setSpeed(speed); }
    settleBase(): void { if (this.enteredArena) this.baseView.land(); }
    beginCombat(): void {
        this.body.enabled = false; this.getComponent(CircleCollider2D)!.enabled = false;
        this.arrivals.clear();
        if (this.countChange) this.countChange.label.node.active = false;
        this.exiting = true; this.baseView.disappear();
        this.bonusNode.active = false;
    }
    applyTuning(): void {
        this.body.linearDamping = RULES.damping;
        const collider = this.getComponent(CircleCollider2D)!;
        if (collider.restitution !== RULES.restitution) {
            collider.restitution = RULES.restitution;
            if (collider.enabledInHierarchy) collider.apply();
        }
    }
    updateIngress(): void {
        if (!this.launched || this.enteredArena || !insideArena(this.node.position)) return;
        this.enteredArena = true; this.getComponent(CircleCollider2D)!.group = 1;
    }
    settleInArena(point: Point): void {
        const p = this.node.position;
        if (p.x !== point.x || p.y !== point.y) this.node.setPosition(point.x, point.y, p.z);
        this.enteredArena = true;
        const collider = this.getComponent(CircleCollider2D)!;
        if (collider.group !== 1) collider.group = 1;
        this.stop();
    }
    stop(): void {
        // RigidBody2D keeps this vector and writes back into it on the next read.
        this.body.linearVelocity = new Vec2(0, 0); this.body.angularVelocity = 0;
        this.body.sleep();
    }
    snapshot(): Deployment {
        return { id: this.id, team: this.team, hero: this.hero, level: this.level, x: this.node.position.x, y: this.node.position.y };
    }
    refreshBonus(animate = false, policy: 'all' | 'loss-only' = 'all'): number {
        const position = this.node.position, probe = this.probe;
        probe.id = this.id; probe.team = this.team; probe.hero = this.hero; probe.level = this.level;
        probe.x = position.x; probe.y = position.y;
        const count = this.launched ? deploymentTroopCount(probe, this.zones) : this.initialCount;
        // Leaving a zone removes troops immediately; passing through one never grants troops.
        if (policy === 'loss-only' && count >= this.shownCount) return 0;
        const hasBonus = count > this.initialCount;
        this.bonusZoneId = hasBonus ? zoneAt(position, this.zones)?.id : undefined;
        if (count === this.shownCount) return 0;
        this.bonusLabel.color = hasBonus ? BONUS_COLOR : NORMAL_COLOR;
        const previous = this.shownCount;
        const delta = animate && previous >= 0 ? count - previous : 0;
        const added = Math.max(0, delta);
        this.shownCount = count;
        this.arrivals.clear();
        for (const visual of this.troopVisuals) visual.setArrivalScale(1);
        // Keep extra views for later zone changes; changing a bonus never churns Skeleton instances.
        while (this.troopVisuals.length < count) {
            const copy = instantiate(this.troopVisuals[0].node);
            copy.name = `SpineSoldier_${this.troopVisuals.length + 1}`;
            this.baseView.troopRoot.addChild(copy);
            const visual = copy.getComponent(TroopSpineView)!;
            this.configureVisual(visual); this.troopVisuals.push(visual);
        }
        const columns = Math.min(3, count), rows = Math.ceil(count / columns);
        // A single row sits higher so the artwork, rather than its feet, centres on the base.
        const groundY = rows === 1 ? -10 : -24;
        this.troopVisuals.forEach((visual, index) => {
            visual.node.active = index < count;
            if (index >= count) return;
            const row = Math.floor(index / columns), rowCount = Math.min(columns, count - row * columns);
            // Ground positions stay inside the base. Back rows draw first, with upright artwork.
            const x = (index % columns - (rowCount - 1) / 2) * 28;
            const y = groundY + (rows - 1 - row) * Math.min(18, 48 / Math.max(1, rows - 1));
            visual.node.setPosition(x, y, 0);
            if (added > 0 && index >= previous) {
                this.arrivals.set(visual, { x, y, elapsed: 0, delay: (index - previous) * .035 });
                visual.node.setPosition(x, y + 150, 0); visual.setArrivalScale(1.9);
            }
            visual.node.setSiblingIndex(this.baseView.troopRoot.children.length - 1);
        });
        this.bonusLabel.string = `${count}`;
        this.bonusLabel.node.setSiblingIndex(this.node.children.length - 1);
        if (delta !== 0) this.showCountChange(delta);
        else if (!animate && this.countChange) this.countChange.label.node.active = false;
        return added;
    }
    private showCountChange(delta: number): void {
        if (!this.countChange) {
            // Reuse the authored count label's font and outline; one transient node per base.
            const node = instantiate(this.bonusNode);
            node.name = 'CountChange'; this.node.addChild(node);
            node.getComponent(UITransform)!.setContentSize(160, 56);
            const label = node.getComponent(Label)!;
            label.fontSize = 32; label.lineHeight = 40; label.enableWrapText = false;
            const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
            this.countChange = { label, opacity, elapsed: 0, direction: 1 };
        }
        const change = this.countChange, total = this.bonusNode.position;
        change.label.string = delta > 0 ? `+${delta}` : `${delta}`;
        change.label.color = delta > 0 ? GAIN_COLOR : LOSS_COLOR;
        change.elapsed = 0; change.direction = delta > 0 ? 1 : -1;
        change.opacity.opacity = 255; change.label.node.setScale(.75, .75, 1);
        change.label.node.setPosition(total.x, total.y - 34, 0);
        change.label.node.setSiblingIndex(this.node.children.length - 1); change.label.node.active = true;
    }
    private configureVisual(visual: TroopSpineView): void {
        visual.setDisplayRole('token');
        visual.configure(this.hero, this.assets, 'idle', 1, true, true);
        visual.setTeam(this.team, this.assets);
    }
}
