import { sys } from 'cc';
import { Api, ApiError } from './Api';
import type { CloudBootstrap } from './CloudTypes';
import type { Platform } from '../sdk/Platform';

const AUTH_KEY = 'runestone.auth.v2';
const DEVICE_KEY = 'runestone.device.v2';

interface LoginResponse { token: string; playerId: string; expiresIn: number }

/** Owns platform login, cached JWT and one automatic relogin after a 401. */
export class CloudClient {
    private token = '';
    constructor(readonly api: Api, private platform: Platform) {}

    get cachedToken(): string { return this.token; }

    async bootstrap(): Promise<CloudBootstrap> {
        return this.request<CloudBootstrap>('/player/bootstrap');
    }

    async request<T>(path: string, options: { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown } = { method: 'GET' }, retry = true): Promise<T> {
        if (!this.token) this.token = this.restoreToken();
        this.api.setToken(this.token);
        if (!this.token) await this.login();
        try {
            return await this.api.request<T>(path, options);
        } catch (error) {
            if (retry && error instanceof ApiError && error.statusCode === 401) {
                this.clearToken();
                await this.login();
                return this.request<T>(path, options, false);
            }
            throw error;
        }
    }

    async login(): Promise<LoginResponse> {
        const provider = this.platform.kind;
        const body = provider === 'web'
            ? { provider: 'dev', devId: this.deviceId() }
            : { provider, code: (await this.platform.login()).code };
        const response = await this.api.request<LoginResponse>('/auth/login', { method: 'POST', body });
        this.token = response.token;
        this.api.setToken(this.token);
        try { sys.localStorage.setItem(this.authKey, this.token); } catch (error) { console.warn('[Cloud] token cache failed', error); }
        return response;
    }

    clearToken(): void {
        this.token = '';
        this.api.setToken(undefined);
        try { sys.localStorage.removeItem(this.authKey); } catch { /* best effort */ }
    }

    private restoreToken(): string {
        try { return sys.localStorage.getItem(this.authKey) ?? ''; } catch { return ''; }
    }

    private get authKey(): string { return `${AUTH_KEY}.${this.platform.kind}`; }

    private deviceId(): string {
        const key = `${DEVICE_KEY}.${this.platform.kind}`;
        let value = '';
        try { value = sys.localStorage.getItem(key) ?? ''; } catch { /* regenerate below */ }
        if (!value) {
            value = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
            try { sys.localStorage.setItem(key, value); } catch (error) { console.warn('[Cloud] device cache failed', error); }
        }
        return value;
    }
}
