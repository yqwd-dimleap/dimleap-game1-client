import { GameTables } from '../config/GameTables';

/** Rank thresholds and repeating king stars come exclusively from rank_config. */
export function playerRank(netStars: number, tables = GameTables.current): {
    title: string; art: number; king: boolean; stars: number; slots: number;
} {
    const value = Math.max(0, Number.isFinite(netStars) ? Math.floor(netStars) : 0);
    const rank = tables.rank(value), row = rank.row;
    // level_1..11 and title_bg_1..11 follow the table's eleven distinct rank families.
    const families = [...new Set(Object.values(tables.ranks).sort((a, b) => a.min_stars - b.min_stars).map(r => r.name))];
    const king = !!row.is_repeating;
    return { title: rank.name, art: families.indexOf(row.name) + 1, king,
        stars: king ? row.repeat_start + Math.floor((value - row.min_stars) / row.stars_per_division) : value - row.min_stars,
        slots: king ? 0 : row.stars_per_division };
}
