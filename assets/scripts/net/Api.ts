import { HttpOptions, Platform, PlatformRequestError } from '../sdk/Platform';

export interface ErrorEnvelope {
    code?: string;
    message?: string;
    requestId?: string;
}

export class ApiError extends Error {
    constructor(readonly statusCode: number, readonly code: string, message: string, readonly requestId?: string) {
        super(message);
        this.name = 'ApiError';
    }
}

/** Fastify-facing HTTP port; the server owns routes and returns a { data } envelope. */
export class Api {
    private token = '';
    constructor(private platform: Platform, private baseUrl: string) {}

    setToken(token: string | undefined): void { this.token = token ?? ''; }

    async request<T>(path: string, options: HttpOptions = { method: 'GET' }): Promise<T> {
        if (!this.baseUrl) throw new Error('尚未配置 Fastify API 地址');
        if (!/^\/[a-zA-Z0-9/_?=&.%-]*$/.test(path)) throw new Error('Invalid API path');
        const url = this.baseUrl.replace(/\/$/, '') + path;
        const method = options.method;
        const started = Date.now();
        try {
            const response = await this.platform.request<{ data?: T } & ErrorEnvelope>(url, {
                ...options,
                headers: {
                    ...(options.headers ?? {}),
                    ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
                },
            });
            console.info(`[Api] ${method} ${url} ${Date.now() - started}ms`);
            return response.data as T;
        } catch (error) {
            if (error instanceof PlatformRequestError) {
                const body = error.response as ErrorEnvelope | null;
                const message = body?.message ?? `服务器请求失败（${error.statusCode}）`;
                console.warn(`[Api] ${method} ${url} ${Date.now() - started}ms failed ${error.statusCode} ${body?.code ?? ''} ${message}`);
                throw new ApiError(error.statusCode, body?.code ?? `HTTP_${error.statusCode}`, message, body?.requestId);
            }
            console.warn(`[Api] ${method} ${url} ${Date.now() - started}ms error ${String(error)}`);
            throw error;
        }
    }
}
