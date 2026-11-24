import { SceneFlow } from '../SceneFlow';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';
import { _decorator, Component, instantiate, isValid, Label, Node, Prefab } from 'cc';
import { GameApp } from '../GameApp';
import { HomeController } from './HomeController';
import { MainPageRouter } from '../main/MainPageRouter';
import { MainShellView, MainPage } from '../../ui/main/MainShellView';
import { HeroesController } from '../heroes/HeroesController';
import { SeasonController } from '../season/SeasonController';
import { ModalHost } from '../../ui/common/ModalHost';
const { ccclass } = _decorator;

/** Scene owns the Canvas; the bundle owns the complete editable HomeView prefab. */
@ccclass('HomeShellController')
export class HomeShellController extends Component {
    private resources?: ResourceScope;
    private router?: MainPageRouter;
    private shell?: MainShellView;
    private selection = 0;
    private currencyOff?: () => void;
    async start(): Promise<void> {
        try {
            const app = GameApp.instance;
            await app.initialize();
            await app.prepareSession();
            if (!isValid(this, true)) return;
            this.resources = SceneFlow.instance.resourcesFor('home');
            const [prefab, topPrefab, modalPrefab] = await Promise.all([this.resources.load(BUNDLES.ui, 'prefabs/main/MainShell', Prefab),
                this.resources.load(BUNDLES.ui, 'prefabs/main/TopNav', Prefab),
                this.resources.load(BUNDLES.ui, 'prefabs/common/ModalLayer', Prefab)]);
            if (!isValid(this, true)) return;
            const view = instantiate(prefab); this.node.addChild(view);
            if (!view.getChildByName('TopNav')) view.addChild(instantiate(topPrefab));
            this.shell = view.getComponent(MainShellView) ?? undefined;
            if (!this.shell) throw new Error('MainShell requires MainShellView');
            this.shell.initialize(page => { void this.select(page); });
            const modalNode = instantiate(modalPrefab); view.addChild(modalNode);
            const modals = modalNode.getComponent(ModalHost);
            if (!modals) throw new Error('ModalLayer requires ModalHost');
            modals.initialize();
            const refreshCurrency = (): void => { if (this.shell && isValid(this.shell, true)) this.shell.currency(app.heroes.snapshot().coins); };
            refreshCurrency(); this.currencyOff = app.heroes.subscribe(refreshCurrency);
            this.router = new MainPageRouter(this.shell.host, app.res, {
                home: { bundle: BUNDLES.ui, path: 'prefabs/home/HomeView', create: async (root, scope) => {
                    const controller = root.getComponent(HomeController);
                    if (!controller) throw new Error('HomeView requires HomeController');
                    controller.navigate = page => this.select(page);
                    controller.mountOverlay = node => {
                        const layer = this.node.layer;
                        const setLayer = (child: Node): void => { child.layer = layer; child.children.forEach(setLayer); };
                        setLayer(node); this.node.addChild(node);
                    };
                    controller.navigationBusy = busy => this.shell?.navigationBusy(busy);
                    controller.report = message => this.shell?.status(message);
                    await controller.initialize(scope, modals);
                    return { destroy: () => controller.dispose() };
                } },
                heroes: { bundle: BUNDLES.heroes, path: 'prefabs/heroes/HeroCollection', create: async (root, scope) => {
                    const controller = root.getComponent(HeroesController);
                    if (!controller) throw new Error('HeroCollection requires HeroesController');
                    await controller.initialize(scope, app.heroes, modals);
                    return { show: () => controller.show(), hide: () => controller.hide(), destroy: () => controller.dispose() };
                } },
                season: { bundle: BUNDLES.seasonContent, path: 'ui/prefabs/season/SeasonView', create: async (root, scope) => {
                    const controller = root.getComponent(SeasonController);
                    if (!controller) throw new Error('SeasonView requires SeasonController');
                    await controller.initialize(scope, app.seasons, app.player.netStars ?? 0, modals);
                    return { show: () => controller.show(), hide: () => controller.hide(), destroy: () => controller.dispose() };
                } },
            });
            await this.select('home');
            if (!isValid(this, true)) return;
            const status = this.node.getChildByName('ShellStatus'); if (status) status.active = false;
        } catch (error) {
            if (!isValid(this, true)) return;
            console.error('[Home shell]', error);
            const label = this.node.getChildByName('ShellStatus')?.getComponent(Label);
            if (label) { label.string = '大厅加载失败，请重新启动。'; label.node.active = true; }
        }
    }
    private async select(page: MainPage): Promise<void> {
        const selection = ++this.selection;
        this.shell?.status('');
        try {
            const changed = await this.router?.show(page);
            if (!isValid(this, true) || selection !== this.selection) return;
            if (changed) { this.shell?.selected(page); this.shell?.status(''); }
        } catch (error) {
            if (isValid(this, true) && selection === this.selection) this.shell?.status(`页面加载失败，可再次点击重试：${String(error)}`);
        }
    }
    onDestroy(): void {
        this.selection++; this.currencyOff?.(); this.currencyOff = undefined;
        try { this.router?.destroy(); } finally { this.shell?.dispose(); this.resources?.dispose(); }
        this.router = undefined; this.shell = undefined; this.resources = undefined;
    }
}
