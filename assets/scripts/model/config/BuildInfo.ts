/** Compiled client identity; update together with the release configuration. */
export const CLIENT_VERSION = '0.2.0-prototype';

function parseVersion(value: string): { core: number[]; pre: string[] } {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
    if (!match) throw new Error('版本号格式无效');
    const core = match.slice(1, 4).map(Number), pre = match[4] ? match[4].split('.') : [];
    if (core.some(n => !Number.isSafeInteger(n)) || pre.some(s => /^\d+$/.test(s) && (!Number.isSafeInteger(Number(s)) || /^0\d/.test(s))))
        throw new Error('版本号格式无效');
    return { core, pre };
}

export function compareVersions(a: string, b: string): number {
    const left = parseVersion(a), right = parseVersion(b);
    for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1;
    if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
    for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
        const l = left.pre[i], r = right.pre[i];
        if (l === undefined || r === undefined) return l === undefined ? -1 : 1;
        if (l === r) continue;
        const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
        if (ln && rn) return Number(l) > Number(r) ? 1 : -1;
        if (ln !== rn) return ln ? -1 : 1;
        return l > r ? 1 : -1;
    }
    return 0;
}

export function assertCompatibleVersion(client: string, config: { version: string; minimumClientVersion: string }): void {
    if (compareVersions(config.version, config.minimumClientVersion) < 0) throw new Error('启动配置的最低版本高于发布版本');
    if (compareVersions(client, config.minimumClientVersion) < 0) throw new Error('客户端版本过低，请更新小游戏后重试');
    if (compareVersions(client, config.version) !== 0) throw new Error('客户端与启动配置版本不一致，请重新打开小游戏');
}
