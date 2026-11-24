import { MiniGameHost, Platform } from './Platform';
import { PlatformWX } from './PlatformWX';
import { PlatformTT } from './PlatformTT';
import { PlatformWeb } from './PlatformWeb';
export function createPlatform(): Platform {
    const hosts = globalThis as unknown as { wx?: MiniGameHost; tt?: MiniGameHost };
    if (hosts.tt) return new PlatformTT(hosts.tt);
    if (hosts.wx) return new PlatformWX(hosts.wx);
    return new PlatformWeb();
}
