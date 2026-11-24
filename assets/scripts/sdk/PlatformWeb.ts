import { HttpOptions, Platform, PlatformRequestError } from './Platform';
export class PlatformWeb implements Platform {
    readonly kind = 'web' as const;
    login(): Promise<{ code: string }> { return Promise.reject(new Error('浏览器原型使用本地游客，无平台登录凭证')); }
    async request<T>(url: string, options: HttpOptions): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(url, { method: options.method, signal: controller.signal,
                headers: { 'content-type': 'application/json', ...options.headers },
                body: options.body === undefined ? undefined : JSON.stringify(options.body) });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new PlatformRequestError(response.status, body);
            }
            return await response.json() as T;
        } finally { clearTimeout(timeout); }
    }
}
