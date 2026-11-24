import { _decorator, Button, Color, Component, Graphics, Label, Node, Prefab, Toggle, UIOpacity, UITransform, instantiate, isValid, sp } from 'cc';
import { ResourceScope } from '../../../core/ResourceScope';
import { BUNDLES } from '../../../core/Bundles';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import { HEROES, HERO_IDS, HeroId } from '../../../model/config/PrototypeConfig';
import { heroStats } from '../../../model/hero/HeroProgress';
import { attackTiming, rangedAttack } from '../../../model/battle/CombatTiming';
import { CombatModel, UnitState } from '../../../model/battle/CombatModel';
import { TroopAssets } from './TroopAssets';
import { TroopSpineView } from './TroopSpineView';
import { ArrowProjectiles } from './ArrowProjectiles';
import {
    BATTLE_FEEDBACK, ENEMY_OUTLINE_SCALE_LIMIT, HIT_OPACITY_LIMIT, TROOP_SCALE_LIMIT, feedbackValue,
} from './BattleFeedbackSettings';

interface TargetHud { root: Node; bar: Graphics }
interface DamagePopup { node: Node; opacity: UIOpacity; age: number; startX: number; startY: number }

/** Isolated attack preview using the same model, Spine view and projectiles as real battles. */
@_decorator.ccclass('HeroBattleGMPanel')
export class HeroBattleGMPanel extends Component {
    private ui!: ViewNodes;
    private scope?: ResourceScope;
    private assets = new TroopAssets();
    private arrows?: ArrowProjectiles;
    private actor!: TroopSpineView;
    private target!: TroopSpineView;
    private targets: TroopSpineView[] = [];
    private targetHp: number[] = [];
    private targetMaxHp: number[] = [];
    private targetDead: boolean[] = [];
    private targetHuds: TargetHud[] = [];
    private healthHudRoot?: Node;
    private damageRoot?: Node;
    private damagePopups: DamagePopup[] = [];
    private model?: CombatModel;
    private selected: HeroId = 'swordsman';
    private facing = 1;
    private enemy = false;
    private loop = true;
    private ready = false;
    private disposed = false;
    private paused = false;
    private accumulator = 0;
    private serial = -1;
    private launched = false;
    private previewScale = BATTLE_FEEDBACK.troopScale;
    private hitOpacity = BATTLE_FEEDBACK.hitOpacity;
    private enemyOutlineScale = BATTLE_FEEDBACK.enemyOutlineScale;
    private listeners: (() => void)[] = [];

    async initialize(scope: ResourceScope, close: () => void): Promise<void> {
        this.scope = scope; this.ui = new ViewNodes(this.node);
        this.cloneButton('ScaleDown', 'HitOpacityDown', -90, -400, '受击 -');
        this.cloneButton('ScaleUp', 'HitOpacityUp', 90, -400, '受击 +');
        this.cloneButton('ScaleDown', 'EnemyOutlineDown', -180, -450, '描边 -');
        this.cloneButton('ScaleUp', 'EnemyOutlineUp', 180, -450, '描边 +');
        this.bindToggle('Toggle_1', BATTLE_FEEDBACK.healthBars, checked => {
            BATTLE_FEEDBACK.healthBars = checked;
            if (this.healthHudRoot) this.healthHudRoot.active = checked;
            this.updateTargetHuds();
        });
        this.bindToggle('Toggle_2', BATTLE_FEEDBACK.damageValues, checked => {
            BATTLE_FEEDBACK.damageValues = checked;
            if (this.damageRoot) this.damageRoot.active = checked;
        });
        const bind = (path: string, action: () => void, required = true): boolean => {
            const node = required ? this.ui.path(path) : this.node.getChildByPath(path);
            if (!node) return false;
            node.on(Button.EventType.CLICK, action);
            this.listeners.push(() => { if (isValid(node, true)) node.off(Button.EventType.CLICK, action); });
            return true;
        };
        bind('Close', close);
        let heroButtons = 0;
        HERO_IDS.forEach((id, i) => {
            if (bind(`btn_hero_${i + 1}`, () => { this.selected = id; this.replay(); }, false)) heroButtons++;
        });
        if (heroButtons < HERO_IDS.length)
            console.warn(`[HeroBattleGM] ${HERO_IDS.length - heroButtons} hero button(s) are not authored; remaining heroes can still be tested after adding their buttons.`);
        bind('Replay', () => this.replay());
        bind('Direction', () => { this.facing *= -1; this.replay(); });
        bind('Team', () => { this.enemy = !this.enemy; this.replay(); });
        bind('Loop', () => { this.loop = !this.loop; this.ui.at('Loop/name', Label).string = this.loop ? '循环：开' : '循环：关'; this.replay(); });
        bind('ScaleDown', () => this.changePreviewScale(-.05));
        bind('ScaleUp', () => this.changePreviewScale(.05));
        bind('HitOpacityDown', () => this.changeHitOpacity(-.05), false);
        bind('HitOpacityUp', () => this.changeHitOpacity(.05), false);
        bind('EnemyOutlineDown', () => this.changeEnemyOutlineScale(-ENEMY_OUTLINE_SCALE_LIMIT.step), false);
        bind('EnemyOutlineUp', () => this.changeEnemyOutlineScale(ENEMY_OUTLINE_SCALE_LIMIT.step), false);
        this.status('正在加载攻击测试资源…');
        try {
            const [, prefab] = await Promise.all([this.assets.load(scope, HERO_IDS), scope.load(BUNDLES.battle, 'prefabs/ArrowProjectile', Prefab)]);
            if (this.disposed || !isValid(this, true)) return;
            this.actor = this.ui.at('hero_attack', TroopSpineView);
            this.target = this.ui.at('Target', TroopSpineView);
            this.targets = [this.target];
            this.ensureTargets(3);
            this.ensureTargetHuds(3);
            this.assets.setEnemyOutlineScale(this.enemyOutlineScale);
            this.arrows = new ArrowProjectiles(this.ui.path('Effects'), prefab, this.assets);
            this.ready = true; this.replay();
        } catch (error) {
            if (!this.disposed && isValid(this, true)) { this.status(`资源加载失败：${String(error)}`); this.assets.destroy(); }
        }
    }
    private cloneButton(sourceName: string, name: string, x: number, y: number, text: string): void {
        const source = this.node.getChildByName(sourceName);
        if (!source) return;
        const node = instantiate(source);
        node.name = name;
        node.setPosition(x, y, 0);
        this.node.addChild(node);
        const label = node.getChildByName('Label')?.getComponent(Label);
        if (label) label.string = text;
    }
    private bindToggle(name: string, checked: boolean, onChanged: (checked: boolean) => void): void {
        const toggle = this.ui.at(name, Toggle);
        toggle.setIsCheckedWithoutNotify(checked);
        const changed = (): void => onChanged(toggle.isChecked);
        toggle.node.on(Toggle.EventType.TOGGLE, changed);
        this.listeners.push(() => { if (isValid(toggle.node, true)) toggle.node.off(Toggle.EventType.TOGGLE, changed); });
    }
    private ensureTargets(count: number): void {
        const parent = this.target.node.parent;
        if (!parent) return;
        while (this.targets.length < count) {
            const node = new Node(`Target_${this.targets.length + 1}`);
            node.layer = this.target.node.layer;
            parent.addChild(node);
            node.setSiblingIndex(this.target.node.getSiblingIndex() + this.targets.length);
            node.addComponent(UITransform);
            node.addComponent(sp.Skeleton);
            this.targets.push(node.addComponent(TroopSpineView));
        }
        this.targets.forEach((view, index) => { view.node.active = index < count; });
    }
    private ensureTargetHuds(count: number): void {
        if (!this.healthHudRoot) {
            this.healthHudRoot = new Node('TargetHealthHud');
            this.healthHudRoot.layer = this.node.layer;
            this.node.addChild(this.healthHudRoot);
        }
        if (!this.damageRoot) {
            this.damageRoot = new Node('DamageValues');
            this.damageRoot.layer = this.node.layer;
            this.node.addChild(this.damageRoot);
        }
        while (this.targetHuds.length < count) {
            const root = new Node(`Health_${this.targetHuds.length + 1}`);
            root.layer = this.node.layer;
            this.healthHudRoot.addChild(root);
            const barNode = new Node('Bar');
            barNode.layer = this.node.layer;
            root.addChild(barNode);
            barNode.addComponent(UITransform).setContentSize(26, 4);
            const bar = barNode.addComponent(Graphics);
            this.targetHuds.push({ root, bar });
        }
        this.targetHuds.forEach((hud, index) => { hud.root.active = index < count && BATTLE_FEEDBACK.healthBars; });
        this.healthHudRoot.active = BATTLE_FEEDBACK.healthBars;
        this.damageRoot.active = BATTLE_FEEDBACK.damageValues;
    }
    private status(text: string): void { this.ui.at('Status', Label).string = text; }
    private replay(): void {
        if (!this.ready || this.disposed) return;
        this.arrows!.clear(); this.accumulator = 0; this.serial = -1; this.launched = false;
        this.clearDamagePopups();
        const stats = heroStats(this.selected, 1);
        const ranged = rangedAttack(this.selected);
        const targetCount = ranged ? 3 : 1;
        this.ensureTargets(targetCount);
        const gap = ranged ? Math.min(300, stats.range * .8) : Math.min(200, stats.range * .8);
        const make = (id: number, hero: HeroId, x: number, hp = 1e9): UnitState => ({
            id, hero, team: id === 1 ? 0 : 1,
            x, y: -200, level: 1, hp, maxHp: hp, cooldown: id === 1 ? 0 : 1e9,
            action: 'idle', attackSerial: 0, attackUntil: id === 1 ? 0 : 1e9, facingX: id === 1 ? this.facing : -this.facing
        });
        const units = [make(1, this.selected, -this.facing * gap / 2)];
        const targetMaxHp = Math.max(300, Math.ceil(stats.damage * 12));
        for (let index = 0; index < targetCount; index++) {
            const column = Math.floor(index / 2);
            const target = make(index + 2, 'shield', this.facing * (gap / 2 + column * 58), targetMaxHp);
            target.y = -200 + (index - (targetCount - 1) / 2) * 58;
            units.push(target);
        }
        this.model = new CombatModel([], [], { units, bounds: { x: 330, y: 350, centerY: -200 } });
        this.actor.configure(this.selected, this.assets, 'idle', this.facing, false, true, true);
        this.actor.setTeam(this.enemy ? 1 : 0, this.assets);
        this.actor.node.setPosition(units[0].x, units[0].y);
        this.targetHp = units.slice(1).map(unit => unit.hp);
        this.targetMaxHp = units.slice(1).map(unit => unit.maxHp);
        this.targetDead = units.slice(1).map(() => false);
        this.targets.forEach((view, index) => {
            if (index >= targetCount) return;
            const target = units[index + 1];
            view.configure('shield', this.assets, 'idle', -this.facing, false, true, true);
            view.setTeam(this.enemy ? 0 : 1, this.assets);
            view.node.setPosition(target.x, target.y);
        });
        this.ensureTargetHuds(targetCount);
        this.updateTargetHuds();
        this.ui.at('Direction/name', Label).string = this.facing > 0 ? '方向：向右' : '方向：向左';
        this.ui.at('Team/name', Label).string = this.enemy ? '阵营：红方' : '阵营：蓝方';
        this.applyPreviewScale();
        this.renderScaleInfo(stats.range);
        const cadence = ranged ? `攻击后等待 ${stats.attackWait.toFixed(1)} 秒` : `攻速 ${stats.attackRate.toFixed(1)} 次/秒`;
        const targets = ranged ? ` · 分散目标 ${targetCount}` : '';
        this.status(`${HEROES[this.selected].name} · ${ranged ? '远程攻击 / 弹体命中' : '近战攻击 / 连续挥砍'} · 攻击范围 ${Math.round(stats.range)} · ${cadence}${targets} · 参数同步实战`);
        this.setPaused(this.paused);
    }
    update(dt: number): void {
        if (!this.ready || this.disposed || this.paused || !this.model) return;
        this.accumulator += Math.min(.1, dt);
        while (this.accumulator >= .02) {
            const unit = this.model.units[0];
            if (!this.loop && this.launched) unit.cooldown = 1e9;
            this.model.step(.02); this.accumulator -= .02;
            this.syncTargets();
            if (this.model.events.some(e => e.phase === 'attack' && e.attackerId === 1)) this.launched = true;
            this.arrows!.impact(this.model.events, this.model.elapsed);
            const attack = unit.action === 'attack', serial = unit.attackSerial ?? 0;
            this.actor.setFacing(unit.facingX ?? this.facing);
            const config = HEROES[unit.hero];
            if (attack) this.actor.play('attack',
                attackTiming(unit.hero, config.attackTier, config.attackRate, config.attackWait).duration,
                serial !== this.serial);
            else if (unit.action === 'walk') this.actor.play('walk');
            else if (rangedAttack(unit.hero)) this.actor.play('idle');
            else this.actor.wait();
            this.serial = serial;
            this.actor.node.setPosition(unit.x, unit.y);
            this.arrows!.sync(this.model.projectiles, this.model.elapsed);
        }
        this.updateDamagePopups(dt);
        if (this.model.winner !== null && this.loop) this.replay();
    }
    private syncTargets(): void {
        if (!this.model) return;
        this.targets.forEach((view, index) => {
            const unit = this.model!.units[index + 1];
            if (!unit) return;
            const previousHp = this.targetHp[index] ?? unit.hp;
            if (unit.hp < previousHp) {
                const damage = Math.max(0, previousHp - unit.hp);
                if (damage > 0) this.spawnDamageValue(index, unit, damage);
                if (unit.hp <= 0 && !this.targetDead[index]) {
                    view.playDeath();
                    this.targetDead[index] = true;
                } else if (unit.hp > 0) view.playHit(this.hitOpacity);
            }
            this.targetHp[index] = unit.hp;
            this.updateTargetHud(index, unit);
            view.node.setPosition(unit.x, unit.y);
            if (unit.hp <= 0) return;
            if (unit.action === 'attack') {
                const config = HEROES[unit.hero];
                view.play('attack', attackTiming(unit.hero, config.attackTier, config.attackRate, config.attackWait).duration, true);
            } else if (unit.action === 'walk') view.play('walk');
            else view.play('idle');
            view.setPlaybackScale(1);
        });
    }
    private updateTargetHuds(): void {
        if (!this.model) return;
        this.targets.forEach((_view, index) => {
            const unit = this.model!.units[index + 1];
            if (unit) this.updateTargetHud(index, unit);
        });
    }
    private updateTargetHud(index: number, unit: UnitState): void {
        const hud = this.targetHuds[index];
        if (!hud) return;
        const maxHp = this.targetMaxHp[index] ?? unit.maxHp;
        const ratio = Math.max(0, Math.min(1, unit.hp / Math.max(1, maxHp)));
        hud.root.setPosition(unit.x, unit.y + 110 * this.previewScale, 0);
        hud.root.active = BATTLE_FEEDBACK.healthBars && unit.hp > 0;
        if (!hud.root.active) return;
        hud.bar.clear();
        hud.bar.fillColor = new Color(15, 23, 31, 255);
        hud.bar.roundRect(-13, -2, 26, 4, 2);
        hud.bar.fill();
        if (ratio > 0) {
            hud.bar.fillColor = new Color(99, 220, 199, 255);
            hud.bar.roundRect(-12, -1, 24 * ratio, 2, 1);
            hud.bar.fill();
        }
    }
    private spawnDamageValue(index: number, unit: UnitState, damage: number): void {
        if (!BATTLE_FEEDBACK.damageValues || !this.damageRoot || damage <= 0) return;
        const node = new Node(`Damage_${this.model?.elapsed.toFixed(2) ?? '0'}`);
        node.layer = this.node.layer;
        this.damageRoot.addChild(node);
        const x = unit.x, y = unit.y + 112 * this.previewScale;
        node.setPosition(x, y, 0);
        node.addComponent(UITransform).setContentSize(140, 42);
        const label = node.addComponent(Label);
        label.string = `-${Math.max(1, Math.round(damage))}`;
        label.fontSize = 26;
        label.lineHeight = 32;
        label.isBold = true;
        label.color = new Color(255, 224, 72, 255);
        label.enableOutline = true;
        label.outlineColor = new Color(92, 28, 15, 255);
        label.outlineWidth = 2;
        const opacity = node.addComponent(UIOpacity);
        this.damagePopups.push({ node, opacity, age: 0, startX: x, startY: y });
    }
    private updateDamagePopups(dt: number): void {
        for (let index = this.damagePopups.length - 1; index >= 0; index--) {
            const popup = this.damagePopups[index];
            popup.age += dt;
            const progress = Math.min(1, popup.age / .7);
            if (progress >= 1 || !isValid(popup.node, true)) {
                if (isValid(popup.node, true)) popup.node.destroy();
                this.damagePopups.splice(index, 1);
                continue;
            }
            popup.node.setPosition(popup.startX, popup.startY + 34 * progress, 0);
            popup.opacity.opacity = Math.round(255 * (1 - progress));
        }
    }
    private clearDamagePopups(): void {
        for (const popup of this.damagePopups) if (isValid(popup.node, true)) popup.node.destroy();
        this.damagePopups.length = 0;
    }
    setPaused(paused: boolean): void {
        this.paused = paused; this.accumulator = 0;
        this.actor?.setPlaybackScale(paused ? 0 : 1);
        for (const target of this.targets) target.setPlaybackScale(paused ? 0 : 1);
        this.arrows?.setSpeed(paused ? 0 : 1);
    }
    private changePreviewScale(delta: number): void {
        this.previewScale = feedbackValue(this.previewScale + delta, BATTLE_FEEDBACK.troopScale, TROOP_SCALE_LIMIT);
        BATTLE_FEEDBACK.troopScale = this.previewScale;
        this.applyPreviewScale();
        this.renderScaleInfo(heroStats(this.selected, 1).range);
    }
    private changeHitOpacity(delta: number): void {
        this.hitOpacity = feedbackValue(this.hitOpacity + delta, BATTLE_FEEDBACK.hitOpacity, HIT_OPACITY_LIMIT);
        BATTLE_FEEDBACK.hitOpacity = this.hitOpacity;
        this.targets.forEach((view, index) => {
            const unit = this.model?.units[index + 1];
            if (view.node.active && unit && unit.hp > 0) view.playHit(this.hitOpacity, true);
        });
        this.renderScaleInfo(heroStats(this.selected, 1).range);
    }
    private changeEnemyOutlineScale(delta: number): void {
        this.enemyOutlineScale = feedbackValue(this.enemyOutlineScale + delta,
            BATTLE_FEEDBACK.enemyOutlineScale, ENEMY_OUTLINE_SCALE_LIMIT);
        this.assets.setEnemyOutlineScale(this.enemyOutlineScale);
        this.renderScaleInfo(heroStats(this.selected, 1).range);
    }
    private applyPreviewScale(): void {
        this.actor?.node.setScale(this.previewScale, this.previewScale, 1);
        for (const target of this.targets) target.node.setScale(this.previewScale, this.previewScale, 1);
    }
    private renderScaleInfo(range: number): void {
        const scaleInfo = this.ui.path('ScaleInfo')?.getComponent(Label);
        if (scaleInfo) scaleInfo.string =
            `缩放：${this.previewScale.toFixed(2)} · 红方描边：${this.enemyOutlineScale.toFixed(2)}× · 受击：${Math.round(this.hitOpacity * 100)}% · 范围：${Math.round(range)}`;
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.ready = false;
        this.listeners.splice(0).forEach(off => off()); this.arrows?.clear(); this.clearDamagePopups(); this.model = undefined;
        // Clear native references before releasing the independent resource scope.
        for (const visual of this.node.getComponentsInChildren(TroopSpineView)) visual.enabled = false;
        for (const skeleton of this.node.getComponentsInChildren(sp.Skeleton)) { this.assets.detachBatch(skeleton); skeleton.clearTracks(); skeleton.skeletonData = null; }
        this.assets.destroy(); this.scope?.dispose();
    }
    onDestroy(): void { this.dispose(); }
}
