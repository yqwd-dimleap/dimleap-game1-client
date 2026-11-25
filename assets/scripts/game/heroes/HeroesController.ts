import { _decorator, Button, Component, instantiate, isValid, Node, Prefab, SpriteFrame, sp } from 'cc';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';
import { HeroCollectionPanel } from '../../ui/heroes/HeroCollectionPanel';
import { DEPLOYABLE_HERO_IDS } from '../../model/config/PrototypeConfig';
import { HERO_ICON_PATHS } from '../../model/hero/HeroPortraits';
import { HeroProgressStore } from '../../model/hero/HeroProgress';
import type { ModalPresenter } from '../../ui/common/ModalHost';
import type { HeroCardArt } from '../../ui/heroes/HeroCardView';
import { loadHeroCardFrame } from '../../ui/heroes/HeroCardFrame';
import { BATTLE_TROOP_PATHS } from '../battle/BattleContent';
import { HeroBattleGMPanel } from '../battle/presentation/HeroBattleGMPanel';
import { GameApp } from '../GameApp';
import { GM_VISIBLE } from '../../core/Gm';

interface HeroGMInstance {
    node: Node;
    panel: HeroBattleGMPanel;
    scope: ResourceScope;
}

/** Adapts the existing collection UI to a sibling main page. */
@_decorator.ccclass('HeroesController')
export class HeroesController extends Component {
    private panel?: HeroCollectionPanel;
    private resources?: ResourceScope;
    private modals?: ModalPresenter;
    private heroGMButton?: Node;
    private heroGM?: HeroGMInstance;
    private heroGMOpening = false;
    private heroGMOpenRequest = 0;
    private disposed = false;
    private readonly openHeroGMClick = (): void => { void this.openHeroGM(); };
    async initialize(resources: ResourceScope, store: HeroProgressStore, modals: ModalPresenter): Promise<void> {
        this.resources = resources;
        this.modals = modals;
        const [card, lineup] = await Promise.all([
            resources.load(BUNDLES.heroes, 'prefabs/heroes/HeroCard', Prefab, undefined, 'critical'),
            resources.load(BUNDLES.heroes, 'prefabs/heroes/GoBattleHeroCard', Prefab, undefined, 'critical'),
        ]);
        if (this.disposed || !isValid(this, true)) throw new Error('Heroes page was destroyed while loading');
        const panel = this.panel = new HeroCollectionPanel(this.node, store, {
            card,
            lineup,
            icons: [],
            preview: id => resources.load(BUNDLES.combatContent, BATTLE_TROOP_PATHS[id], sp.SkeletonData, undefined, 'normal'),
            loadOverlays: async () => {
                const [select, detail, levelUp] = await Promise.all([
                    resources.load(BUNDLES.heroes, 'prefabs/heroes/HeroSelect', Prefab, undefined, 'normal'),
                    resources.load(BUNDLES.heroes, 'prefabs/heroes/HeroDetail', Prefab, undefined, 'normal'),
                    resources.load(BUNDLES.heroes, 'prefabs/heroes/HeroLevelUpDetail', Prefab, undefined, 'normal'),
                ]);
                return { select, detail, levelUp };
            },
        }, modals);
        const heroGMButton = this.node.getChildByName('btn_hero_gm');
        if (heroGMButton && GM_VISIBLE) {
            heroGMButton.on(Button.EventType.CLICK, this.openHeroGMClick);
            this.heroGMButton = heroGMButton;
        } else if (heroGMButton) {
            heroGMButton.active = false;
        } else if (GM_VISIBLE) {
            console.warn('[Heroes] HeroCollection is missing btn_hero_gm');
        }
        // The authored page and default card art are already visible. Load portraits,
        // tier art and interaction overlays after the first frame, off the entry path.
        this.scheduleOnce(() => {
            if (this.disposed || this.panel !== panel) return;
            void Promise.all([
                Promise.all(DEPLOYABLE_HERO_IDS.map(id =>
                    HERO_ICON_PATHS[id] ? resources.load(BUNDLES.heroes, HERO_ICON_PATHS[id]!, SpriteFrame, undefined, 'background') : Promise.resolve(null))),
                this.loadCardArt(resources),
            ]).then(([icons, cardArt]) => {
                if (!this.disposed && this.panel === panel) panel.setVisualAssets(icons, cardArt);
            }).catch(error => console.warn('[Heroes] optional card art load failed:', error));
            void panel.warmOverlays().catch(error => console.warn('[Heroes] optional interaction UI load failed:', error));
        }, 0);
    }
    private async loadCardArt(resources: ResourceScope): Promise<HeroCardArt> {
        const [frames, levels, names] = await Promise.all([
            Promise.all(([0, 1, 2, 3] as const).map(frame => loadHeroCardFrame(resources, frame))),
            Promise.all([1, 2, 3].map(tier => resources.load(BUNDLES.heroes, `textures/view/lv_bg_${tier}/spriteFrame`, SpriteFrame, undefined, 'background'))),
            Promise.all([0, 1, 2, 3].map(tier => resources.load(BUNDLES.heroes, `textures/view/name_bg_${tier}/spriteFrame`, SpriteFrame, undefined, 'background'))),
        ]);
        return { frames, levels, names };
    }
    private async openHeroGM(): Promise<void> {
        if (!GM_VISIBLE) return;
        const resources = this.resources, modals = this.modals;
        if (this.disposed || !resources || !modals || this.heroGM || this.heroGMOpening) return;
        const request = ++this.heroGMOpenRequest;
        this.heroGMOpening = true;
        let created: HeroGMInstance | undefined;
        try {
            const prefab = await resources.load(BUNDLES.battleUi, 'prefabs/HeroBattleGM', Prefab);
            if (this.disposed || request !== this.heroGMOpenRequest || !isValid(this, true) || resources.disposed) return;
            const scope = GameApp.instance.res.createScope('gm:hero-attacks:heroes');
            const node = instantiate(prefab);
            this.setUILayer(node, this.node.layer);
            const panel = node.getComponent(HeroBattleGMPanel);
            if (!panel) {
                node.destroy();
                scope.dispose();
                throw new Error('HeroBattleGM requires HeroBattleGMPanel');
            }
            created = { node, panel, scope };
            this.heroGM = created;
            modals.open(node, { closed: () => this.cleanupHeroGM(created!) });
            await panel.initialize(scope, () => this.closeHeroGM());
        } catch (error) {
            console.warn('[Heroes] Hero attack GM failed to open', error);
            if (created && this.heroGM === created) {
                this.modals?.close(created.node);
                if (this.heroGM === created) this.cleanupHeroGM(created);
            }
        } finally {
            if (request === this.heroGMOpenRequest) this.heroGMOpening = false;
        }
    }
    private closeHeroGM(): void {
        this.heroGMOpenRequest++;
        this.heroGMOpening = false;
        const current = this.heroGM;
        if (!current) return;
        if (this.modals) this.modals.close(current.node);
        if (this.heroGM === current) this.cleanupHeroGM(current);
    }
    private cleanupHeroGM(instance: HeroGMInstance): void {
        if (this.heroGM !== instance) return;
        this.heroGM = undefined;
        if (isValid(instance.panel, true)) instance.panel.dispose();
        if (isValid(instance.node, true)) instance.node.destroy();
        instance.scope.dispose();
    }
    private setUILayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) this.setUILayer(child, layer);
    }
    show(): void { this.panel?.refresh(); }
    hide(): void { this.closeHeroGM(); this.panel?.hide(); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.closeHeroGM();
        if (this.heroGMButton && isValid(this.heroGMButton, true))
            this.heroGMButton.off(Button.EventType.CLICK, this.openHeroGMClick);
        this.heroGMButton = undefined;
        this.panel?.destroy();
        this.panel = undefined;
        this.resources = undefined;
        this.modals = undefined;
    }
    onDestroy(): void { this.dispose(); }
}
