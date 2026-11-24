import { drawBattleHand } from '../../../model/battle/BattleMatch';
import { HEROES, RULES, bonusAt, isDeployableHero } from '../../../model/config/PrototypeConfig';
import type { HeroId, Point, Team } from '../../../model/battle/types';
import { insideArena, settledTokenPosition, shotWaitLimit, dragFromShot, Shot } from '../../../model/battle/ThrowMath';
import { aimStage } from '../../../model/battle/BattleFraming';
import type { BattleSession } from '../BattleSession';
import type { TokenBody } from '../physics/TokenBody';
import { DEBUG } from 'cc/env';

export interface DeploymentPorts {
    clearAim(resetPouch?: boolean): void;
    cameraMoving(): boolean;
    updateIngress(): void;
    pullLimit(): number;
    aim(dx: number, dy: number): void;
    finishShot(): void;
    beginCombat(): void;
    frame(stage: ReturnType<typeof aimStage> | 'overview'): void;
    spawnPoint(): Point;
    spawnToken(team: Team, hero: HeroId, point: Point, live: boolean): TokenBody;
    botPlan(available: HeroId[]): Shot & { hero: HeroId };
    label(key: string, text: string): void;
    refreshHud(): void;
    cancelInput(): void;
    blocked(): boolean;
    launch(token: TokenBody, shot: Shot): void;
    reinforce(point: Point): void;
    prepareTurn(): void;
    showCannotTurn(team: Team): void;
    hideCannotTurn(): void;
    introReady(): boolean;
    snapshot(): object;
}
/** Per-base bonus settlement and whole-shot turn switching, independent of scene assembly. */
export class DeploymentController {
    private resting = new Map<TokenBody, number>();
    constructor(private state: BattleSession, private ports: DeploymentPorts) {}
    update(dt: number): boolean {
        if (this.state.phase !== 'settling') this.resting.clear();
        if (this.state.phase === 'overview') {
            this.state.timer += dt;
            if (this.ports.introReady()) this.ports.prepareTurn();
        } else if (this.state.phase === 'framing' && !this.ports.cameraMoving() && !this.state.pending?.baseAppearing) {
            this.state.phase = this.state.mode === 'battle' && this.state.turn === 1 ? 'ai' : 'ready';
            this.state.timer = 0; this.ports.refreshHud();
        } else if (this.state.phase === 'cannot-turn') {
            this.state.timer += dt;
            if (this.ports.introReady()) {
                this.ports.hideCannotTurn();
                const next = this.state.budget.next(this.state.turn);
                if (next === null) { this.endDeployment(); return true; }
                this.state.turn = next;
                this.prepareTurn();
            }
        }
        if (this.state.phase === 'settling') {
            this.state.timer += dt;
            this.ports.updateIngress();
            let quiet = true;
            let bonusChanged = false;
            for (const token of this.state.tokens) if (token.launched) {
                const before = token.displayedBonus;
                token.refreshBonus(true, 'loss-only');
                const still = token.body.linearVelocity.length() < RULES.stopSpeed && Math.abs(token.body.angularVelocity) < RULES.stopAngularSpeed;
                quiet = quiet && still;
                const previous = this.resting.get(token) ?? 0;
                const held = still ? previous + dt : 0;
                this.resting.set(token, held);
                if (previous < RULES.stopHold && held >= RULES.stopHold && token.enteredArena && insideArena(token.node.position)) {
                    token.stop();
                    const added = token.refreshBonus(true);
                    if (added > 0) this.ports.reinforce(token.node.position);
                    token.settleBase();
                }
                bonusChanged = bonusChanged || token.displayedBonus !== before;
            }
            if (bonusChanged) this.ports.refreshHud();
            this.state.quiet = quiet ? this.state.quiet + dt : 0;
            if (this.state.quiet >= RULES.stopHold || this.state.timer >= this.state.shotDeadline) this.ports.finishShot();
        } else if (this.state.phase === 'ai') {
            this.state.timer += dt;
            if (this.state.lastBotPlan && this.state.timer >= 0.35) {
                const drag = dragFromShot(this.state.lastBotPlan, this.ports.pullLimit()), t = Math.min(1, (this.state.timer - 0.35) / 0.45);
                this.ports.aim(drag.x * t, drag.y * t);
                if (t === 1) { this.ports.clearAim(false); this.fire(this.state.lastBotPlan); }
            }
        } else if (this.state.phase === 'transition') {
            this.state.timer += dt;
            if (this.state.timer >= 1.2) this.ports.beginCombat();
            return true;
        }
        return this.state.phase !== 'combat' && this.state.phase !== 'finishing';
    }
    prepareTurn(): void {
        this.ports.clearAim(); this.ports.hideCannotTurn();
        this.state.selected = null; this.state.pending = null; this.state.lastBotPlan = null;
        this.state.quiet = 0; this.state.timer = 0;
        if (this.state.mode === 'lab' && this.state.tokens.length >= RULES.labTokenLimit) {
            this.state.phase = 'result'; this.ports.label('status', '试验场已满，点击重置继续'); this.ports.refreshHud(); return;
        }
        if (this.state.mode === 'battle' && !this.state.budget.available(this.state.turn).length) {
            this.state.hand = [];
            this.state.phase = 'cannot-turn';
            this.ports.showCannotTurn(this.state.turn);
            this.ports.refreshHud();
            return;
        }
        const available = this.availableCards();
        if (this.state.mode === 'battle' && this.state.turn === 1) {
            const plan = this.ports.botPlan(available);
            if (!this.state.budget.select(this.state.turn, plan.hero)) throw new Error('Invalid bot card');
            this.state.selected = plan.hero;
            this.state.pending = this.ports.spawnToken(this.state.turn, plan.hero, this.ports.spawnPoint(), false);
            this.ports.frame(aimStage(this.state.turn)); this.state.phase = 'framing';
            this.ports.label('status', `敌方选卡：${HEROES[plan.hero].name} · 消耗 ${HEROES[plan.hero].cost} 点`);
            this.state.lastBotPlan = plan;
        } else {
            this.state.hand = drawBattleHand(available);
            this.ports.frame('overview'); this.state.phase = 'selecting';
            this.ports.label('status', this.state.turn === 0 ? '你的回合 · 请选择一张英雄卡' : '试验场红方 · 请选择英雄卡');
            this.ports.label('guide', this.state.mode === 'lab' ? '试验场不消耗行动值，可重复试投' : '选卡立即扣除行动点；后续回合可重复选择同一英雄');
        }
        this.ports.refreshHud();
    }
    availableCards(): HeroId[] {
        return this.state.mode === 'battle' ? this.state.budget.available(this.state.turn) : this.state.budget.lineups[0].filter((h): h is HeroId => !!h && isDeployableHero(h));
    }
    selectHero(hero: HeroId): void {
        if (this.state.phase !== 'selecting' || this.ports.blocked() || !this.availableCards().includes(hero) || (this.state.mode === 'battle' && !this.state.hand.includes(hero))) return;
        if (this.state.mode === 'battle' && !this.state.budget.select(this.state.turn, hero)) return;
        this.state.selected = hero; this.ports.cancelInput();
        this.state.pending = this.ports.spawnToken(this.state.turn, hero, this.ports.spawnPoint(), false);
        this.ports.frame(aimStage(this.state.turn)); this.state.phase = 'framing'; this.state.timer = 0;
        this.ports.label('status', `${HEROES[hero].name} 已就位${this.state.mode === 'battle' ? ` · 消耗 ${HEROES[hero].cost} 点行动值` : ''}`);
        this.ports.label('guide', '按住弹弓中的文字 Token，向后拖拽并松手发射'); this.ports.refreshHud();
    }
    endDeployment(): void {
        this.ports.hideCannotTurn();
        this.state.phase = 'transition'; this.state.timer = 0;
        this.ports.label('status', '双方已无可部署卡牌 · 准备转化部队'); this.ports.refreshHud();
    }
    fire(shot: Shot): void {
        if (!this.state.pending) return;
        const token = this.state.pending; this.state.pending = null;
        this.resting.clear();
        // Release immediately places the base below the environment; physics ingress is independent.
        this.state.lastShot = shot; this.ports.launch(token, shot);
        if (DEBUG) console.info('[Prototype] shot', JSON.stringify({team: this.state.turn, hero: token.hero, origin: token.snapshot(), ...shot}));
        this.state.phase = 'settling'; this.state.timer = 0; this.state.quiet = 0;
        this.state.shotDeadline = shotWaitLimit(this.movingSpeedEnvelope());
        this.ports.label('status', `${this.state.turn === 0 ? '蓝方' : '红方'}投掷 · 等待停稳`);
        this.ports.label('guide', `发射力度 ${Math.round(shot.power * 100)}% · 离区即减兵，每个底座停稳后独立增兵`);
        this.ports.refreshHud();
    }
    movingSpeedEnvelope(): number {
        let energy = 0;
        for (const token of this.state.tokens) if (token.launched) {
            const speed = token.body?.linearVelocity?.length() ?? (this.state.lastShot ? Math.hypot(this.state.lastShot.vx, this.state.lastShot.vy) : 0);
            energy += speed * speed;
        }
        return Math.sqrt(energy);
    }
    finishShot(): void {
        // End the turn only after all bases settle; repair outside bases before their final bonus.
        this.resting.clear();
        for (const token of this.state.tokens) if (token.launched) token.stop();
        const launched = this.state.tokens.filter(token => token.launched);
        const occupied: Point[] = launched.filter(token => insideArena(token.node.position)).map(token => ({
            x: token.node.position.x, y: token.node.position.y,
        }));
        for (const token of launched) {
            const from = token.node.position;
            if (!insideArena(from)) {
                const to = settledTokenPosition(from, occupied);
                if (DEBUG) console.info('[Prototype] settled-boundary-fix', JSON.stringify({ id: token.id, from: { x: from.x, y: from.y }, to }));
                token.settleInArena(to); occupied.push(to);
            } else if (!token.enteredArena) token.settleInArena(from);
        }
        for (const token of this.state.tokens) if (token.launched) {
            const added = token.refreshBonus(true);
            if (added > 0) this.ports.reinforce(token.node.position);
        }
        for (const token of this.state.tokens) if (token.launched) token.settleBase();
        const snapshot = this.state.tokens.filter(token => token.launched && token.enteredArena).map(token => token.snapshot());
        const bonuses = [0, 0]; for (const token of snapshot) bonuses[token.team] += bonusAt(token, this.state.zones);
        this.state.latestOutcome = `停稳：蓝方 +${bonuses[0]}，红方 +${bonuses[1]}`;
        if (DEBUG) console.info('[Prototype] settled', JSON.stringify(this.ports.snapshot()));
        this.ports.label('guide', `${this.state.latestOutcome} · 每枚 Token 独立按中心点判区`);
        this.state.turn = this.state.turn === 0 ? 1 : 0;
        this.ports.prepareTurn();
    }
}
