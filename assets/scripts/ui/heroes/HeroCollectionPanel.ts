import { Button, instantiate, isValid, Node, Prefab, SpriteFrame, UITransform, sp } from 'cc';
import { HeroId, DEPLOYABLE_HERO_IDS } from '../../model/config/PrototypeConfig';
import { HeroProgressStore, heroStats } from '../../model/hero/HeroProgress';
import { HeroCardArt, HeroCardView } from './HeroCardView';
import { LineupHeroCardView } from './LineupHeroCardView';
import { HeroDetailView } from './HeroDetailView';
import { HeroLevelUpDetailView } from './HeroLevelUpDetailView';
import { HeroSelectView } from './HeroSelectView';
import type { ModalPresenter } from '../common/ModalHost';

export interface HeroOverlayPrefabs {
    select: Prefab;
    detail: Prefab;
    levelUp: Prefab;
}

export interface HeroCollectionAssets {
    card: Prefab;
    lineup: Prefab;
    icons: (SpriteFrame | null)[];
    cardArt?: HeroCardArt;
    preview: (id: HeroId) => Promise<sp.SkeletonData>;
    loadOverlays: () => Promise<HeroOverlayPrefabs>;
}

/** Owns instances of the authored templates, while the store owns saved progression. */
export class HeroCollectionPanel {
    private selected: HeroId | null = null;
    private cards: HeroCardView[] = [];
    private slots: { node: Node; card: LineupHeroCardView }[] = [];
    private listeners: (() => void)[] = [];
    private owned: Node[] = [];
    private selectionNode?: Node;
    private detailNode?: Node;
    private levelUpNode?: Node;
    private selection?: HeroSelectView;
    private detail?: HeroDetailView;
    private levelUp?: HeroLevelUpDetailView;
    private preview?: HeroCardView;
    private overlays?: Promise<HeroOverlayPrefabs>;
    private openRequest = 0;
    private message = '';
    private disposed = false;
    private actionPending = false;

    constructor(readonly node: Node, private store: HeroProgressStore,
        private assets: HeroCollectionAssets, private modals: ModalPresenter) {
        const content = node.getChildByPath('ScrollView/view/content');
        if (!content) throw new Error('HeroCollection requires ScrollView/view/content');
        this.bindUnlockControls();
        DEPLOYABLE_HERO_IDS.forEach((id, i) => {
            const card = instantiate(assets.card);
            content.addChild(card);
            this.owned.push(card);
            card.name = `Card_${id}`;
            card.setPosition(-270 + i % 4 * 180, -128 - Math.floor(i / 4) * 240);
            const view = card.getComponent(HeroCardView);
            if (!view) throw new Error('HeroCard requires HeroCardView');
            view.initialize(() => this.open(id, card));
            this.cards.push(view);
        });
        content.getComponent(UITransform)!.setContentSize(750,
            Math.max(900, Math.ceil(DEPLOYABLE_HERO_IDS.length / 4) * 240));
        for (let i = 0; i < 5; i++) {
            const slot = node.getChildByPath(`shangzhen_node/Lineup${i + 1}`);
            if (!slot) throw new Error(`Missing lineup slot ${i + 1}`);
            const card = instantiate(assets.lineup);
            slot.addChild(card);
            this.owned.push(card);
            card.setPosition(0, 0);
            const view = card.getComponent(LineupHeroCardView);
            if (!view) throw new Error('GoBattleHeroCard requires LineupHeroCardView');
            this.slots.push({ node: card, card: view });
            const click = (): void => {
                const id = this.store.snapshot().lineup[i];
                if (id) this.open(id, slot);
            };
            slot.on(Button.EventType.CLICK, click);
            this.listeners.push(() => { if (isValid(slot, true)) slot.off(Button.EventType.CLICK, click); });
        }
        this.refresh();
    }

    private bindUnlockControls(): void {
        for (const name of ['btn_test_open', 'btn_test_close']) {
            const button = this.node.getChildByName(name);
            // Cloud progression is the only authority; legacy all-unlock controls are retired.
            if (button) button.active = false;
        }
    }

    setVisualAssets(icons: (SpriteFrame | null)[], cardArt: HeroCardArt): void {
        if (this.disposed) return;
        this.assets.icons = icons;
        this.assets.cardArt = cardArt;
        this.refresh();
    }

    warmOverlays(): Promise<HeroOverlayPrefabs> {
        if (!this.overlays) this.overlays = this.assets.loadOverlays();
        return this.overlays;
    }

    private open(id: HeroId, anchor: Node): void {
        void this.openAsync(id, anchor);
    }

    private async openAsync(id: HeroId, anchor: Node): Promise<void> {
        if (this.disposed) return;
        const request = ++this.openRequest;
        this.hide();
        this.selected = id;
        this.message = '';
        this.refresh();
        try {
            const overlays = await this.warmOverlays();
            if (this.disposed || request !== this.openRequest || this.selected !== id || !isValid(anchor, true)) return;
            this.ensureOverlayInstances(overlays);
            if (!this.selectionNode) return;
            this.modals.open(this.selectionNode, {
                anchor,
                bounds: this.selectionNode.getChildByName('bg') ?? undefined,
            });
            this.refresh();
        } catch (error) {
            if (!this.disposed && request === this.openRequest) {
                this.selected = null;
                this.refresh();
                console.warn('[Heroes] selection UI load failed:', error);
            }
        }
    }

    private ensureOverlayInstances(prefabs: HeroOverlayPrefabs): void {
        if (this.selection || this.detail) return;
        const selectionNode = this.selectionNode = instantiate(prefabs.select);
        this.node.addChild(selectionNode);
        this.owned.push(selectionNode);
        selectionNode.active = false;
        const selection = this.selection = selectionNode.getComponent(HeroSelectView) ?? undefined;
        if (!selection) throw new Error('HeroSelect requires HeroSelectView');
        selection.initialize(() => this.openDetail(), () => { void this.act('select'); }, () => { void this.act('remove'); });
        const preview = instantiate(this.assets.card);
        selectionNode.addChild(preview);
        this.owned.push(preview);
        preview.setPosition(0, 0);
        preview.setSiblingIndex(1);
        const previewButton = preview.getComponent(Button);
        if (previewButton) previewButton.interactable = false;
        this.preview = preview.getComponent(HeroCardView) ?? undefined;

        const detailNode = this.detailNode = instantiate(prefabs.detail);
        this.node.addChild(detailNode);
        this.owned.push(detailNode);
        detailNode.active = false;
        const detail = this.detail = detailNode.getComponent(HeroDetailView) ?? undefined;
        if (!detail) throw new Error('HeroDetail requires HeroDetailView');
        detail.initialize(() => this.modals.close(detailNode), () => { void this.upgradeSelected(); });

        const levelUpNode = this.levelUpNode = instantiate(prefabs.levelUp);
        this.node.addChild(levelUpNode);
        this.owned.push(levelUpNode);
        levelUpNode.active = false;
        const levelUp = this.levelUp = levelUpNode.getComponent(HeroLevelUpDetailView) ?? undefined;
        if (!levelUp) throw new Error('HeroLevelUpDetail requires HeroLevelUpDetailView');
        levelUp.initialize(() => this.modals.close(levelUpNode));
        this.refresh();
    }

    private openDetail(): void {
        if (!this.selected || !this.detailNode || !this.detail || this.disposed) return;
        if (this.levelUpNode) this.modals.close(this.levelUpNode);
        const bounds = this.detailNode.getChildByName('bg');
        if (!bounds) return;
        this.modals.open(this.detailNode, { bounds });
        const id = this.selected;
        void this.detail.loadPreview(() => this.assets.preview(id));
    }

    private async upgradeSelected(): Promise<void> {
        if (!this.selected || this.disposed || this.actionPending) return;
        const id = this.selected, previousLevel = this.store.level(id), wasUnlocked = this.store.isUnlocked(id);
        this.actionPending = true;
        const result = wasUnlocked ? await this.store.upgrade(id) : await this.store.unlock(id);
        this.actionPending = false;
        if (this.disposed || this.selected !== id) return;
        this.message = result.message;
        this.refresh();
        if (result.ok && wasUnlocked && this.store.level(id) > previousLevel) this.showLevelUp(id, previousLevel, this.store.level(id));
    }

    private showLevelUp(id: HeroId, previousLevel: number, currentLevel: number): void {
        const levelUpNode = this.levelUpNode, levelUp = this.levelUp;
        if (!levelUpNode || !levelUp) return;
        const hero = heroStats(id, currentLevel);
        levelUp.render(hero, previousLevel, currentLevel);
        const bounds = levelUpNode.getChildByName('bg') ?? undefined;
        this.modals.open(levelUpNode, {
            bounds,
            closed: () => {
                const selected = this.selected;
                if (selected) void this.detail?.loadPreview(() => this.assets.preview(selected));
            },
        });
        levelUp.playEntrance();
        void levelUp.loadPreview(id, () => this.assets.preview(id));
    }

    private async act(action: 'select' | 'remove'): Promise<void> {
        if (!this.selected || this.disposed || this.actionPending) return;
        this.actionPending = true;
        const result = await this.store[action](this.selected);
        this.actionPending = false;
        if (this.disposed) return;
        this.message = result.message;
        this.refresh();
        if (result.ok) this.hide();
    }

    refresh(): void {
        if (this.disposed) return;
        const progress = this.store.snapshot();
        DEPLOYABLE_HERO_IDS.forEach((id, i) => {
            this.cards[i].render(heroStats(id, progress.heroes[id].level), progress.heroes[id],
                this.assets.icons[i] ?? null, this.assets.cardArt);
        });
        progress.lineup.forEach((id, i) => {
            const slot = this.slots[i];
            slot.node.active = !!id;
            if (id) slot.card.render(id, progress.heroes[id].level,
                this.assets.icons[DEPLOYABLE_HERO_IDS.indexOf(id)] ?? null);
        });
        if (!this.selected) return;
        const id = this.selected;
        const icon = this.assets.icons[DEPLOYABLE_HERO_IDS.indexOf(id)] ?? null;
        this.selection?.render(progress.lineup.includes(id), progress.lineup.includes(null));
        this.preview?.render(heroStats(id, progress.heroes[id].level), progress.heroes[id], icon, this.assets.cardArt);
        this.detail?.render(heroStats(id, progress.heroes[id].level), progress.heroes[id], progress.coins, this.message);
    }

    hide(): void {
        if (this.levelUpNode) this.modals.close(this.levelUpNode);
        if (this.detailNode) this.modals.close(this.detailNode);
        if (this.selectionNode) this.modals.close(this.selectionNode);
        this.selected = null;
    }

    destroy(): void {
        if (this.disposed) return;
        this.openRequest++;
        this.hide();
        this.disposed = true;
        this.listeners.splice(0).forEach(off => off());
        this.cards.forEach(card => card.dispose());
        this.preview?.dispose();
        this.selection?.dispose();
        this.detail?.dispose();
        this.levelUp?.dispose();
        this.owned.splice(0).forEach(node => { if (isValid(node, true)) node.destroy(); });
        this.cards = [];
        this.slots = [];
        this.overlays = undefined;
    }
}
