import type { Team } from './types';

export type RoundWinner = Team | 'draw';
/** Keep the finished battlefield visible before opening the authored round-settlement panel. */
export const ROUND_SETTLEMENT_DELAY = 1;
export interface RoundResolution {
    round: number;
    winner: RoundWinner;
    replay: boolean;
    score: readonly [number, number];
    seriesWinner: Team | null;
    seriesComplete: boolean;
}

/** Remaining lives at the start of the round just resolved, for settlement presentation only. */
export function livesBeforeRound(
    remaining: readonly [number, number],
    winner: RoundWinner,
): readonly [number, number] {
    return [
        Math.min(2, remaining[0] + (winner === 1 ? 1 : 0)),
        Math.min(2, remaining[1] + (winner === 0 ? 1 : 0)),
    ];
}

/** Best-of-three series. A draw replays the same round and never consumes a decisive round. */
export class BattleSeries {
    private round = 1;
    private wins: [number, number] = [0, 0];
    private firstTeam: Team = 0;

    constructor(firstTeam?: Team) {
        this.firstTeam = firstTeam ?? (Math.random() < 0.5 ? 0 : 1);
    }

    get currentRound(): number { return this.round; }
    get startingTeam(): Team { return (this.round % 2 === 1 ? this.firstTeam : (this.firstTeam === 0 ? 1 : 0)); }
    get score(): readonly [number, number] { return [this.wins[0], this.wins[1]]; }
    get lives(): readonly [number, number] { return [2 - this.wins[1], 2 - this.wins[0]]; }
    get complete(): boolean { return this.wins[0] >= 2 || this.wins[1] >= 2; }
    get winner(): Team | null { return this.wins[0] >= 2 ? 0 : this.wins[1] >= 2 ? 1 : null; }

    reset(firstTeam: Team = Math.random() < 0.5 ? 0 : 1): void {
        this.round = 1;
        this.wins = [0, 0];
        this.firstTeam = firstTeam;
    }

    record(winner: RoundWinner): RoundResolution {
        const round = this.round;
        if (winner === 'draw') {
            return { round, winner, replay: true, score: this.score, seriesWinner: null, seriesComplete: false };
        }
        this.wins[winner]++;
        const seriesWinner = this.winner;
        const seriesComplete = seriesWinner !== null;
        if (!seriesComplete) this.round++;
        return { round, winner, replay: false, score: this.score, seriesWinner, seriesComplete };
    }
}
