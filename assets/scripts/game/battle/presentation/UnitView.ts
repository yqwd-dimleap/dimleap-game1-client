import { _decorator, Component, Graphics, Color, Label, Node, ProgressBar, UIOpacity, UITransform, isValid } from 'cc';
import { TEAM_COLORS } from '../../../ui/theme/BattleTheme';
import { UnitState } from '../../../model/battle/CombatModel';
import { attackTiming, rangedAttack } from '../../../model/battle/CombatTiming';
import { HEROES } from '../../../model/config/PrototypeConfig';
import { TroopAssets } from './TroopAssets';
import { TroopSpineView } from './TroopSpineView';
import { reorderUnitNodes } from './UnitDepthOrder';
import { BATTLE_FEEDBACK } from './BattleFeedbackSettings';
const { ccclass } = _decorator;

interface DamagePopup { node: Node; opacity: UIOpacity; age: number }

@ccclass('UnitView')
export class UnitView extends Component {
    private lastHp = -1;
    private attackSerial = -1;
    private visual!: TroopSpineView;
    private unitId = 0;
    private attackDuration?: number;
    private sample?: { x: number; time: number };
    private deathStarted?: number;
    private deathDuration = 0;
    private damageRoot?: Node;
    private damagePopups: DamagePopup[] = [];
    static sortByDepth(views: Iterable<UnitView>, bulk = false, target: UnitView[] = []): void {
        // Unit roots are ground positions: draw higher Y first, then the foreground at lower Y.
        target.length = 0;
        for (const view of views) target.push(view);
        const sorted = target.sort((a, b) => b.node.position.y - a.node.position.y || a.unitId - b.unitId);
        if (bulk && reorderUnitNodes(sorted.map(view => view.node))) return;
        sorted.forEach((view, index) => { if (view.node.getSiblingIndex() !== index) view.node.setSiblingIndex(index); });
    }
    configure(unit: UnitState, assets: TroopAssets, cached = false, batch = true, privateDetails = true): void {
        this.unitId = unit.id;
        const config = HEROES[unit.hero];
        this.attackDuration = attackTiming(unit.hero, config.attackTier, config.attackRate, config.attackWait).duration;
        this.lastHp = -1; this.attackSerial = -1; this.details = privateDetails;
        this.sample = undefined;
        this.deathStarted = undefined; this.deathDuration = 0;
        this.clearDamagePopups();
        const ring = this.node.getChildByName('TeamRing');
        const healthNode = this.node.getChildByName('Health');
        if (ring) ring.active = privateDetails;
        if (healthNode) healthNode.active = privateDetails && BATTLE_FEEDBACK.healthBars;
        this.visual = this.node.getChildByName('SpineVisual')!.getComponent(TroopSpineView)!;
        this.visual.configure(unit.hero, assets, 'walk', unit.facingX ?? 1, cached, batch, true);
        this.visual.setTeam(unit.team, assets);
        const g = privateDetails ? this.node.getChildByName('TeamRing')!.getComponent(Graphics)! : null;
        if (g) {
        g.clear(); g.fillColor = new Color(0, 0, 0, 65); g.ellipse(0, -12, 18, 7); g.fill();
        g.strokeColor = new Color().fromHEX(TEAM_COLORS[unit.team]); g.lineWidth = 2; g.ellipse(0, -12, 18, 7); g.stroke();
        }
        this.sync(unit, 1, 0);
    }
    sync(unit: UnitState, speed = 1, elapsed = 0): void {
        const previousHp = this.lastHp;
        if (unit.hp <= 0) {
            this.lastHp = unit.hp;
            this.clearDamagePopups();
            if (this.deathStarted === undefined) {
                this.deathStarted = elapsed; this.node.setPosition(unit.x, unit.y);
                this.deathDuration = this.visual.playDeath();
                for (const name of ['TeamRing', 'Health']) {
                    const detail = this.node.getChildByName(name); if (detail) detail.active = false;
                }
            }
            this.visual.setPlaybackScale(speed);
            this.node.active = elapsed - this.deathStarted + 1e-8 < this.deathDuration;
            return;
        }
        this.node.active = true;
        this.node.setPosition(unit.x, unit.y); this.visual.setPlaybackScale(speed);
        const healthNode = this.node.getChildByName('Health');
        if (healthNode) healthNode.active = this.details && BATTLE_FEEDBACK.healthBars;
        if (!BATTLE_FEEDBACK.damageValues) this.clearDamagePopups();
        if (previousHp >= 0 && unit.hp < previousHp) {
            this.visual.playHit();
            if (this.details && BATTLE_FEEDBACK.damageValues)
                this.spawnDamageValue(previousHp - unit.hp);
        }
        this.lastHp = unit.hp;
        const attack = unit.action === 'attack', serial = unit.attackSerial ?? 0;
        // Lock the direction for the entire swing; a new attack can choose a different side.
        const walking = unit.action === 'walk';
        if (attack && serial !== this.attackSerial) this.visual.setFacing(unit.facingX ?? 0);
        else if (walking) {
            if (!this.sample) this.visual.setFacing(unit.facingX ?? 0);
            else if (elapsed > this.sample.time) this.visual.setMovementFacing(unit.facingX ?? 0,
                unit.x - this.sample.x, elapsed - this.sample.time);
        } else this.visual.setMovementFacing(0, 0, 0);
        if (!this.sample) this.sample = { x: unit.x, time: elapsed };
        else { this.sample.x = unit.x; this.sample.time = elapsed; }
        const config = HEROES[unit.hero];
        const duration = this.attackDuration ??
            attackTiming(unit.hero, config.attackTier, config.attackRate, config.attackWait).duration;
        if (attack || walking) this.visual.play(attack ? 'attack' : 'walk', attack ? duration : undefined, attack && serial !== this.attackSerial);
        else if (rangedAttack(unit.hero)) this.visual.play('idle');
        else this.visual.wait();
        this.attackSerial = serial;
        if (!this.details || unit.hp === previousHp) return;
        const health = healthNode!.getComponent(ProgressBar)!;
        health.progress = unit.hp / unit.maxHp;
        if (health.barSprite) health.barSprite.color = new Color().fromHEX(TEAM_COLORS[unit.team]);
    }
    update(dt: number): void {
        for (let index = this.damagePopups.length - 1; index >= 0; index--) {
            const popup = this.damagePopups[index];
            popup.age += dt;
            const progress = Math.min(1, popup.age / .7);
            if (progress >= 1 || !isValid(popup.node, true)) {
                if (isValid(popup.node, true)) popup.node.destroy();
                this.damagePopups.splice(index, 1);
                continue;
            }
            popup.node.setPosition(0, 68 + 34 * progress, 0);
            popup.opacity.opacity = Math.round(255 * (1 - progress));
        }
    }
    private spawnDamageValue(damage: number): void {
        if (!(damage > 0)) return;
        if (!this.damageRoot) {
            this.damageRoot = new Node('DamageValues');
            this.damageRoot.layer = this.node.layer;
            this.node.addChild(this.damageRoot);
        }
        const node = new Node('DamageValue');
        node.layer = this.node.layer;
        this.damageRoot.addChild(node);
        node.setPosition(0, 68, 0);
        node.addComponent(UITransform).setContentSize(140, 42);
        const label = node.addComponent(Label);
        label.string = `-${Math.max(1, Math.round(damage))}`;
        label.fontSize = 24;
        label.lineHeight = 30;
        label.isBold = true;
        label.color = new Color(255, 224, 72, 255);
        label.enableOutline = true;
        label.outlineColor = new Color(92, 28, 15, 255);
        label.outlineWidth = 2;
        const opacity = node.addComponent(UIOpacity);
        this.damagePopups.push({ node, opacity, age: 0 });
    }
    private clearDamagePopups(): void {
        for (const popup of this.damagePopups) if (isValid(popup.node, true)) popup.node.destroy();
        this.damagePopups.length = 0;
    }
    private details = true;
}
