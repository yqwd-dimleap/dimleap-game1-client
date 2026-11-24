import { RULES, ZONES } from '../../model/config/PrototypeConfig';
import type { HeroId, Zone, Team } from '../../model/battle/types';
import { DeploymentBudget } from '../../model/battle/DeploymentBudget';
import { STARTER_LINEUP } from '../../model/hero/HeroProgress';
import type { Shot } from '../../model/battle/ThrowMath';
import type { CombatObstacle } from '../../model/battle/CombatCollision';
import type { TokenBody } from './physics/TokenBody';

export type BattlePhase = 'loading' | 'building' | 'overview' | 'selecting' | 'framing' | 'ready' | 'settling' | 'ai' | 'cannot-turn' | 'transition' | 'combat' | 'finishing' | 'result';
export type BattleMode = 'lab' | 'battle';
/** Per-scene state shared by the deployment coordinator, combat runner and presentation adapter. */
export class BattleSession {
    phase: BattlePhase = 'loading';
    mode: BattleMode = 'battle';
    mapId = '';
    zones: readonly Zone[] = ZONES;
    obstacles: readonly CombatObstacle[] = [];
    tokens: TokenBody[] = [];
    pending: TokenBody | null = null;
    turn: Team = 0;
    selected: HeroId | null = null;
    hand: HeroId[] = [];
    budget = new DeploymentBudget(STARTER_LINEUP, STARTER_LINEUP);
    timer = 0;
    quiet = 0;
    lastBotPlan: Shot | null = null;
    lastShot: Shot | null = null;
    shotDeadline = RULES.maxShotSeconds;
    latestOutcome = '';
}
