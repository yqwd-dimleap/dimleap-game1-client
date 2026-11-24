import { RULES } from './BattleRuntime';
import { DEFAULT_BATTLE_RULES } from '../config/BattleRules';

export type BattleTuning = Pick<typeof RULES, 'launchMultiplier' | 'powerCurve' | 'damping' | 'restitution' | 'wallRestitution' |
    'minSpeed' | 'maxSpeed' | 'minDrag' | 'maxDrag' | 'stopSpeed' | 'stopHold' | 'maxShotSeconds' |
    'troopScale' | 'tokenTroopScale' | 'arrowFlightMultiplier'>;
export type TuningKey = keyof BattleTuning;
export type TuningGroup = 'collision' | 'troop';
export interface TuningField { key: TuningKey; label: string; min: number; max: number; step: number; group: TuningGroup; advanced?: boolean }
export const TUNING_FIELDS: ReadonlyArray<TuningField> = [
    { key: 'launchMultiplier', label: '发射速度倍率', min: .5, max: 2.5, step: .05, group: 'collision' },
    { key: 'powerCurve', label: '力度曲线指数', min: .4, max: 2.5, step: .05, group: 'collision' },
    { key: 'damping', label: '滑行阻尼', min: .2, max: 4, step: .05, group: 'collision' },
    { key: 'restitution', label: '底座互撞反弹系数', min: 0, max: 1, step: .02, group: 'collision' },
    { key: 'wallRestitution', label: '墙体反弹系数', min: 0, max: 1, step: .02, group: 'collision' },
    { key: 'minSpeed', label: '最小基础速度 (m/s)', min: 1, max: 20, step: .5, group: 'collision', advanced: true },
    { key: 'maxSpeed', label: '最大基础速度 (m/s)', min: 10, max: 44, step: .5, group: 'collision', advanced: true },
    { key: 'minDrag', label: '起射拉距门槛', min: 4, max: 40, step: 1, group: 'collision', advanced: true },
    { key: 'maxDrag', label: '满力拉距', min: 80, max: 240, step: 5, group: 'collision', advanced: true },
    { key: 'stopSpeed', label: '停稳速度 (m/s)', min: .03, max: .3, step: .01, group: 'collision', advanced: true },
    { key: 'stopHold', label: '持续停稳时间 (秒)', min: .15, max: .8, step: .05, group: 'collision', advanced: true },
    { key: 'maxShotSeconds', label: '超时保护下限 (秒)', min: 3, max: 15, step: .5, group: 'collision', advanced: true },
    { key: 'tokenTroopScale', label: '底座兵种缩放', min: .1, max: 1.5, step: .05, group: 'troop' },
    { key: 'troopScale', label: '战斗兵种缩放', min: .1, max: 1.5, step: .05, group: 'troop' },
    { key: 'arrowFlightMultiplier', label: '弓箭飞行时长倍率', min: .5, max: 3, step: .1, group: 'troop' },
];
export const DEFAULT_TUNING: Readonly<BattleTuning> = Object.freeze(TUNING_FIELDS.reduce((values, field) => {
    values[field.key] = DEFAULT_BATTLE_RULES[field.key]; return values;
}, {} as BattleTuning));
export function tuningFields(group: TuningGroup): readonly TuningField[] { return TUNING_FIELDS.filter(f => f.group === group); }
export function currentTuning(): BattleTuning {
    const values = {} as BattleTuning;
    for (const field of TUNING_FIELDS) values[field.key] = RULES[field.key];
    return values;
}
export function groupTuning(group: TuningGroup, values: BattleTuning = currentTuning()): Partial<BattleTuning> {
    const result: Partial<BattleTuning> = {};
    for (const field of tuningFields(group)) result[field.key] = values[field.key];
    return result;
}
/** Validate the entire patch before touching physics, guides or presentation. */
export function applyTuning(patch: Partial<BattleTuning>): BattleTuning {
    const next = { ...currentTuning(), ...patch };
    if (Object.keys(patch).some(key => !TUNING_FIELDS.some(field => field.key === key))) throw new Error('未知调参项');
    for (const field of TUNING_FIELDS) {
        const value = next[field.key];
        if (!Number.isFinite(value) || value < field.min || value > field.max) throw new Error(`${field.label}范围：${field.min}–${field.max}`);
    }
    if (next.minSpeed >= next.maxSpeed) throw new Error('最小速度必须小于最大速度');
    if (next.minDrag >= next.maxDrag) throw new Error('起射拉距必须小于满力拉距');
    Object.assign(RULES, next); return currentTuning();
}

/** Version 3 migrates persisted tuning while aligning battle troop scale to the new runtime default. */
export class BattleTuningStore {
    private readonly key = 'runestone.battle.tuning.v3';
    constructor(private storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }) {}
    restore(): boolean {
        try {
            const raw = this.storage.getItem(this.key);
            if (raw) {
                if (raw.length > 4096) return false;
                const data = JSON.parse(raw);
                if (data?.schema !== 3 || !this.validGroup(data.collision, 'collision') || !this.validGroup(data.troop, 'troop')) return false;
                applyTuning({ ...DEFAULT_TUNING, ...data.collision, ...data.troop }); return true;
            }
            const rawV2 = this.storage.getItem('runestone.battle.tuning.v2');
            if (rawV2) {
                if (rawV2.length > 4096) return false;
                const data = JSON.parse(rawV2);
                if (data?.schema !== 2 || !this.validGroup(data.collision, 'collision') || !this.validGroup(data.troop, 'troop')) return false;
                const migrated = {
                    schema: 3,
                    collision: data.collision,
                    troop: { ...data.troop, troopScale: DEFAULT_TUNING.troopScale },
                };
                applyTuning({ ...DEFAULT_TUNING, ...migrated.collision, ...migrated.troop });
                try { this.storage.setItem(this.key, JSON.stringify(migrated)); } catch { /* keep the safe migrated values in memory */ }
                return true;
            }
            const legacy = this.storage.getItem('runestone.battle.tuning.v1');
            if (!legacy || legacy.length > 2048) return false;
            const data = JSON.parse(legacy);
            if (data?.schema !== 1 || !data.values || typeof data.values !== 'object' || Array.isArray(data.values)) return false;
            const oldKeys = ['launchMultiplier', 'powerCurve', 'damping', 'restitution', 'wallRestitution', 'tokenTroopScale', 'troopScale', 'arrowFlightMultiplier'];
            if (Object.keys(data.values).some(key => !oldKeys.includes(key))) return false;
            const migrated: Partial<BattleTuning> = {};
            for (const f of TUNING_FIELDS.filter(f => oldKeys.includes(f.key))) {
                const value = data.values[f.key];
                if (value === undefined && f.group === 'troop') continue;
                if (typeof value !== 'number' || !Number.isFinite(value) || value < f.min || value > f.max) return false;
                if (f.group === 'troop') migrated[f.key] = value;
            }
            migrated.troopScale = DEFAULT_TUNING.troopScale;
            const next = { ...DEFAULT_TUNING, ...migrated };
            applyTuning(next);
            const saved = { schema: 3, collision: groupTuning('collision', next), troop: groupTuning('troop', next) };
            try { this.storage.setItem(this.key, JSON.stringify(saved)); } catch { /* keep the safe migrated values in memory */ }
            return true;
        } catch { return false; }
    }
    private validGroup(value: unknown, group: TuningGroup): boolean {
        return !!value && typeof value === 'object' && !Array.isArray(value) &&
            Object.entries(value).every(([key, v]) => typeof v === 'number' && Number.isFinite(v) &&
                tuningFields(group).some(f => f.key === key && v >= f.min && v <= f.max));
    }
    save(group?: TuningGroup): boolean {
        try {
            let saved = { schema: 3, collision: groupTuning('collision', DEFAULT_TUNING), troop: groupTuning('troop', DEFAULT_TUNING) };
            if (group) {
                const raw = this.storage.getItem(this.key);
                if (raw) {
                    const data = JSON.parse(raw);
                    if (data?.schema !== 3 || !this.validGroup(data.collision, 'collision') || !this.validGroup(data.troop, 'troop')) return false;
                    saved = data;
                } else {
                    // Preserve migrated legacy visuals when collision is saved for the first time.
                    const rawLegacy = this.storage.getItem('runestone.battle.tuning.v1');
                    if (rawLegacy) {
                        const data = JSON.parse(rawLegacy);
                        for (const f of tuningFields('troop')) {
                            const v = data?.schema === 1 ? data.values?.[f.key] : undefined;
                            if (typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max) saved.troop[f.key] = v;
                        }
                    }
                }
                saved[group] = groupTuning(group);
            } else { saved.collision = groupTuning('collision'); saved.troop = groupTuning('troop'); }
            this.storage.setItem(this.key, JSON.stringify(saved)); return true;
        } catch { return false; }
    }
}
