import { _decorator, Component, isValid, Prefab, screen, SpriteFrame, sp } from 'cc';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';
import { HeroCollectionPanel } from '../../ui/heroes/HeroCollectionPanel';
import { DEPLOYABLE_HERO_IDS } from '../../model/config/PrototypeConfig';
import { HERO_ICON_PATHS } from '../../model/hero/HeroPortraits';
import { HeroProgressStore } from '../../model/hero/HeroProgress';
import type { ModalPresenter } from '../../ui/common/ModalHost';
import type { HeroCardArt } from '../../ui/heroes/HeroCardView';
import { loadHeroCardFrame } from '../../ui/heroes/HeroCardFrame';
import { BATTLE_TROOP_PATHS, combatBundleForAssetPath } from '../battle/BattleContent';
import { GM_VISIBLE } from '../../core/Gm';

/** Adapts the existing collection UI to a sibling main page. */
@_decorator.ccclass('HeroesController')
export class HeroesController extends Component {
    private panel?: HeroCollectionPanel;
    private resources?: ResourceScope;
    private modals?: ModalPresenter;
    private disposed = false;
    private readonly relayout = (): void => { this.panel?.layout(); };

    onEnable(): void {
        screen.on('window-resize', this.onWindowResize, this);
    }

    onDisable(): void {
        screen.off('window-resize', this.onWindowResize, this);
        this.unschedule(this.relayout);
    }

    private onWindowResize(): void {
        this.unschedule(this.relayout);
        this.scheduleOnce(this.relayout);
    }

    async initialize(resources: ResourceScope, store: HeroProgressStore, modals: ModalPresenter): Promise<void> {
        this.resources = resources;
        this.modals = modals;
        const [card, lineup, replace, presentation] = await Promise.all([
            resources.load(BUNDLES.heroes, 'prefabs/heroes/HeroCard', Prefab, undefined, 'critical'),
            resources.load(BUNDLES.heroes, 'prefabs/heroes/GoBattleHeroCard', Prefab, undefined, 'critical'),
            resources.load(BUNDLES.heroes, 'prefabs/heroes/HeroReplace', Prefab, undefined, 'normal'),
            this.loadPresentation(resources),
        ]);
        if (this.disposed || !isValid(this, true)) throw new Error('Heroes page was destroyed while loading');
        const panel = this.panel = new HeroCollectionPanel(this.node, store, {
            card,
            lineup,
            replace,
            icons: [],
            preview: id => resources.load(combatBundleForAssetPath(BATTLE_TROOP_PATHS[id]), BATTLE_TROOP_PATHS[id],
                sp.SkeletonData, undefined, 'normal'),
            loadOverlays: async () => {
                const [select, detail, levelUp] = await Promise.all([
                    resources.load(BUNDLES.heroes, 'prefabs/heroes/HeroSelect', Prefab, undefined, 'normal'),
                    resources.load(BUNDLES.heroes, 'prefabs/heroes/HeroDetail', Prefab, undefined, 'normal'),
                    resources.load(BUNDLES.heroes, 'prefabs/heroes/HeroLevelUpDetail', Prefab, undefined, 'normal'),
                ]);
                return { select, detail, levelUp };
            },
        }, modals);
        panel.setVisualAssets(presentation.icons, presentation.cardArt);
        const heroGMButton = this.node.getChildByName('btn_hero_gm');
        if (heroGMButton) heroGMButton.active = false;
        if (GM_VISIBLE) console.warn('[Heroes] HeroBattleGM is excluded from production bundles');
        // Interaction overlays are secondary to the visible roster and stay off the entry path.
        this.scheduleOnce(() => {
            if (this.disposed || this.panel !== panel) return;
            void panel.warmOverlays().catch(error => console.warn('[Heroes] optional interaction UI load failed:', error));
        }, 0);
    }
    private async loadPresentation(resources: ResourceScope): Promise<{ icons: (SpriteFrame | null)[]; cardArt?: HeroCardArt }> {
        const icons = await Promise.all(DEPLOYABLE_HERO_IDS.map(async id => {
            const path = HERO_ICON_PATHS[id];
            if (!path) return null;
            try {
                return await resources.load(BUNDLES.heroes, path, SpriteFrame, undefined, 'background');
            } catch (error) {
                console.warn(`[Heroes] portrait failed for ${id}:`, error);
                return null;
            }
        }));
        let cardArt: HeroCardArt | undefined;
        try {
            cardArt = await this.loadCardArt(resources);
        } catch (error) {
            console.warn('[Heroes] optional card art load failed:', error);
        }
        return { icons, cardArt };
    }
    private async loadCardArt(resources: ResourceScope): Promise<HeroCardArt> {
        const [frames, levels, names] = await Promise.all([
            Promise.all(([0, 1, 2, 3] as const).map(frame => loadHeroCardFrame(resources, frame))),
            Promise.all([1, 2, 3].map(tier => resources.load(BUNDLES.heroes, `textures/view/lv_bg_${tier}/spriteFrame`, SpriteFrame, undefined, 'background'))),
            Promise.all([0, 1, 2, 3].map(tier => resources.load(BUNDLES.heroes, `textures/view/name_bg_${tier}/spriteFrame`, SpriteFrame, undefined, 'background'))),
        ]);
        return { frames, levels, names };
    }
    show(): void {
        this.panel?.layout();
        this.panel?.refresh();
    }
    hide(): void { this.panel?.hide(); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.panel?.destroy();
        this.panel = undefined;
        this.resources = undefined;
        this.modals = undefined;
    }
    onDestroy(): void { this.dispose(); }
}
