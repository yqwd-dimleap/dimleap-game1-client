import { HeroId, HEROES, RULES, Team, isDeployableHero } from '../config/PrototypeConfig';

/** Each side gets six points. Cards may be reused on later turns while points remain. */
export class DeploymentBudget {
    readonly remaining = [RULES.actionPoints, RULES.actionPoints];
    readonly used: HeroId[][] = [[], []];
    readonly lineups: (HeroId | null)[][];
    constructor(blue: readonly (HeroId | null)[], red: readonly (HeroId | null)[]) {
        this.lineups = [blue, red].map(lineup => lineup.slice(0, 5).map(id => id && isDeployableHero(id) ? id : null));
    }
    canAfford(team: Team, hero: HeroId): boolean {
        return this.lineups[team].includes(hero) && !!HEROES[hero] && HEROES[hero].cost <= this.remaining[team];
    }
    canAffordAny(team: Team, hand: readonly HeroId[]): boolean {
        return hand.some(hero => this.canAfford(team, hero));
    }
    available(team: Team): HeroId[] {
        return this.lineups[team].filter((id): id is HeroId => !!id && this.canAfford(team, id));
    }
    select(team: Team, hero: HeroId): boolean {
        if (!this.available(team).includes(hero)) return false;
        this.remaining[team] -= HEROES[hero].cost; this.used[team].push(hero); return true;
    }
    get complete(): boolean { return !this.available(0).length && !this.available(1).length; }
    next(after: Team): Team | null {
        const opponent: Team = after === 0 ? 1 : 0;
        return this.available(opponent).length ? opponent : this.available(after).length ? after : null;
    }
}
