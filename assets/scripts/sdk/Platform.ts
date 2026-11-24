export type PlatformKind = 'web' | 'wx' | 'tt';
export interface HttpOptions { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown; headers?: Record<string, string> }
export class PlatformRequestError extends Error {
    constructor(readonly statusCode: number, readonly response: unknown) {
        super(`HTTP ${statusCode}`);
        this.name = 'PlatformRequestError';
    }
}
export interface Platform {
    readonly kind: PlatformKind;
    login(): Promise<{ code: string }>;
    request<T>(url: string, options: HttpOptions): Promise<T>;
}
export interface MiniGameHost {
    login(options: { success: (result: { code?: string }) => void; fail: (error: unknown) => void }): void;
    request(options: { url: string; method: string; data?: unknown; header: Record<string, string>; timeout: number;
        success: (result: { statusCode: number; data: unknown }) => void; fail: (error: unknown) => void }): void;
}
export abstract class MiniGamePlatform implements Platform {
    abstract readonly kind: 'wx' | 'tt';
    constructor(private host: MiniGameHost) {}
    login(): Promise<{ code: string }> {
        return new Promise((resolve, reject) => this.host.login({
            success: result => result.code ? resolve({ code: result.code }) : reject(new Error('Platform login returned no code')),
            fail: reject,
        }));
    }
    request<T>(url: string, options: HttpOptions): Promise<T> {
        return new Promise<T>((resolve, reject) => this.host.request({ url, method: options.method, data: options.body,
            header: { 'content-type': 'application/json', ...options.headers }, timeout: 15000,
            success: response => response.statusCode >= 200 && response.statusCode < 300
                ? resolve(response.data as T) : reject(new PlatformRequestError(response.statusCode, response.data)), fail: reject }));
    }
}
