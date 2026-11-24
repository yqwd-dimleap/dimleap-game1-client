import { DEFAULT_BATTLE_RULES } from '../../../model/config/BattleRules';
import type { BattleRules } from '../../../model/config/BattleRules';
import type { AttackEvent, CombatModel } from '../../../model/battle/CombatModel';

/** Fixed-step budget and finishing time. The renderer consumes every step's events exactly once. */
export class CombatRunner {
    accumulator = 0;
    simulationMs = 0;
    droppedSeconds = 0;
    finishingTime = 0;
    private rules: Readonly<BattleRules> = DEFAULT_BATTLE_RULES;
    constructor(private clock: () => number = () => Date.now()) {}
    reset(rules: Readonly<BattleRules>): void {
        this.rules = rules;
        this.accumulator = this.simulationMs = this.droppedSeconds = this.finishingTime = 0;
    }
    advance(model: CombatModel, dt: number, fast: boolean, lab: boolean, consume: (events: readonly AttackEvent[], elapsed: number) => void): boolean {
        const step = this.rules.combatStep;
        this.accumulator += dt * (fast ? 2 : 1);
        let steps = 0;
        const begin = this.clock();
        while (this.accumulator >= step && model.winner === null && (!lab || steps < 2)) {
            model.step(step); this.accumulator -= step; steps++;
            consume(model.events, model.elapsed);
        }
        if (steps) this.simulationMs = this.simulationMs * .8 + (this.clock() - begin) / steps * .2;
        if (lab && this.accumulator >= step) {
            const dropped = Math.floor(this.accumulator / step) * step;
            this.accumulator -= dropped; this.droppedSeconds += dropped;
        }
        return model.winner !== null;
    }
    finish(dt: number, fast: boolean, deathDuration: number): boolean {
        this.finishingTime += dt * (fast ? 2 : 1);
        return this.finishingTime >= deathDuration;
    }
}
