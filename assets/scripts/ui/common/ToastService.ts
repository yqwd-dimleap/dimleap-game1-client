import type { ToastLayer } from './ToastLayer';

/**
 * Application-wide Toast entry point. The visual host may be rebuilt after a
 * scene transition; messages raised while no host is mounted are kept for it.
 */
export class ToastService {
    private static readonly singleton = new ToastService();
    private host?: ToastLayer;
    private pending?: string;

    static show(message: string): void {
        ToastService.singleton.show(message);
    }

    static dismiss(): void {
        ToastService.singleton.dismiss();
    }

    static register(host: ToastLayer): void {
        ToastService.singleton.register(host);
    }

    static unregister(host: ToastLayer): void {
        ToastService.singleton.unregister(host);
    }

    private show(message: string): void {
        const text = message?.trim() ?? '';
        if (!text) {
            this.dismiss();
            return;
        }
        if (!this.host) {
            this.pending = text;
            return;
        }
        this.pending = undefined;
        this.host.show(text);
    }

    private dismiss(): void {
        this.pending = undefined;
        this.host?.hide();
    }

    private register(host: ToastLayer): void {
        this.host = host;
        const pending = this.pending;
        this.pending = undefined;
        if (pending) host.show(pending);
    }

    private unregister(host: ToastLayer): void {
        if (this.host === host) this.host = undefined;
    }
}
