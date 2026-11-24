import { instantiate, isValid, Node, Prefab } from 'cc';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';
import { ModalPresenter } from '../../ui/common/ModalHost';
import { SetUpView } from '../../ui/main/SetUpView';
import { AvatarSetUpView } from '../../ui/main/AvatarSetUpView';
import { NickNameModifyView } from '../../ui/main/NickNameModifyView';
import { GameApp } from '../GameApp';

type Page = 'SetUpView' | 'AvatarSetUpView' | 'NickNameModifyView';
interface Entry { scope: ResourceScope; node?: Node; closed: boolean }

/** Owns dynamically loaded settings modals, drafts and their resource lifetimes. */
export class PlayerSettingsController {
    private entries = new Map<Page, Entry>();
    private disposed = false;
    private readonly profileOff: () => void;
    constructor(private app: GameApp, private modals: ModalPresenter, private report: (message: string) => void) {
        this.profileOff = app.events.on('profile:changed', profile => {
            const entry = this.entries.get('SetUpView'), view = entry?.node?.getComponent(SetUpView);
            if (entry && view) void view.renderPlayer(profile, entry.scope).catch(error => {
                if (!entry.closed) this.report(`头像加载失败：${String(error)}`);
            });
        });
    }
    open(): void { void this.openPage('SetUpView'); }
    private async openPage(page: Page, parent?: Entry): Promise<void> {
        if (this.disposed || this.entries.has(page) || parent?.closed) return;
        const entry: Entry = { scope: this.app.res.createScope(`player-settings:${page}`), closed: false };
        this.entries.set(page, entry);
        const close = (): void => { if (entry.node) this.modals.close(entry.node); };
        try {
            const prefab = await entry.scope.load(BUNDLES.ui, `prefabs/settings/${page}`, Prefab);
            if (this.disposed || entry.closed || parent?.closed) { this.release(page, entry); return; }
            const node = entry.node = instantiate(prefab), profile = this.app.profile;
            if (page === 'SetUpView') {
                const view = node.getComponent(SetUpView);
                if (!view) throw new Error('SetUpView requires SetUpView component');
                view.initialize(close, () => { void this.openPage('AvatarSetUpView', entry); },
                    () => { void this.openPage('NickNameModifyView', entry); });
                void view.renderPlayer(profile, entry.scope).catch(error => { if (!entry.closed) this.report(`头像加载失败：${String(error)}`); });
            } else if (page === 'AvatarSetUpView') {
                const view = node.getComponent(AvatarSetUpView);
                if (!view) throw new Error('AvatarSetUpView requires AvatarSetUpView component');
                view.initialize(profile.avatar, close, async avatar => {
                    const saved = await this.app.updateProfile({ avatarId: avatar });
                    if (saved) close();
                    return saved;
                });
            } else {
                const view = node.getComponent(NickNameModifyView);
                if (!view) throw new Error('NickNameModifyView requires NickNameModifyView component');
                view.initialize(profile.nickname, close, async nickname => {
                    const saved = await this.app.updateProfile({ nickname });
                    if (saved) close();
                    return saved;
                });
            }
            const bounds = node.getChildByName('bg');
            if (!bounds) throw new Error(`${page} requires bg`);
            this.modals.open(node, { bounds, closed: () => this.release(page, entry) });
        } catch (error) {
            const report = !this.disposed && !entry.closed && !parent?.closed;
            this.release(page, entry);
            if (report) this.report(`设置页面加载失败，可再次点击重试：${String(error)}`);
        }
    }
    private release(page: Page, entry: Entry): void {
        if (entry.closed) return;
        entry.closed = true;
        if (this.entries.get(page) === entry) this.entries.delete(page);
        if (entry.node && isValid(entry.node, true)) { entry.node.removeFromParent(); entry.node.destroy(); }
        entry.scope.dispose();
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.profileOff();
        const root = this.entries.get('SetUpView');
        if (root?.node && isValid(root.node, true)) this.modals.close(root.node);
        for (const [page, entry] of this.entries) this.release(page, entry);
    }
}
