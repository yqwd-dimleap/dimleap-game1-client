import { _decorator, Component, isValid, Node, UITransform, Vec3, sp } from 'cc';
import type { HeroId } from '../../model/config/PrototypeConfig';

interface ReplaceSlot {
    root: Node;
    highlight?: Node;
    hero: sp.Skeleton;
    point: sp.Skeleton;
    replace: sp.Skeleton;
}

const SLOT_HOVER_PADDING_X = 4;
const SLOT_HOVER_PADDING_Y = 8;
const FOLLOW_OFFSET_Y = 48;
const SLOT_HERO_SIZE = { width: 104, height: 126 } as const;
const SELECTED_HERO_SIZE = { width: 118, height: 138 } as const;

/** Drives the authored HeroReplace prefab without owning progression data. */
@_decorator.ccclass('HeroReplaceView')
export class HeroReplaceView extends Component {
    private slots: ReplaceSlot[] = [];
    private selectedRoot!: Node;
    private selectedHero!: sp.Skeleton;
    private dragArrow!: sp.Skeleton;
    private loadHero?: (id: HeroId) => Promise<sp.SkeletonData>;
    private selectedId?: HeroId;
    private source = new Vec3();
    private pointer = new Vec3();
    private hovered = -1;
    private request = 0;

    initialize(loadHero: (id: HeroId) => Promise<sp.SkeletonData>): void {
        this.dispose();
        this.loadHero = loadHero;
        this.slots = Array.from({ length: 5 }, (_, index) => {
            const number = index + 1;
            const root = this.required(`shangzhen_node/Lineup${number}`);
            const highlight = root.getChildByName('select_hightlight');
            const hero = this.required(`shangzhen_node/Lineup${number}/hero_ani_${number}`).getComponent(sp.Skeleton)!;
            const point = this.required(`shangzhen_node/Lineup${number}/point_ani_${number}`).getComponent(sp.Skeleton)!;
            const replace = this.required(`shangzhen_node/Lineup${number}/replace_ani_${number}`).getComponent(sp.Skeleton)!;
            point.setAnimation(0, 'animation', true);
            replace.setAnimation(0, 'animation', true);
            if (highlight) highlight.active = false;
            return { root, highlight: highlight ?? undefined, hero, point, replace };
        });
        const selectedNode = this.node.getChildByName('selected_hero_ani')
            ?? this.required('selected_hero_node/selected_hero_ani');
        const dragNode = this.node.getChildByName('drag_hero_ani')
            ?? this.required('selected_hero_node/drag_hero_ani');
        this.selectedRoot = selectedNode;
        this.selectedHero = selectedNode.getComponent(sp.Skeleton)!;
        this.dragArrow = dragNode.getComponent(sp.Skeleton)!;
        this.hide();
    }

    show(id: HeroId, lineup: readonly (HeroId | null)[], pointer: Vec3, source: Vec3): void {
        const request = ++this.request;
        this.selectedId = id;
        this.source.set(source);
        this.pointer.set(pointer);
        this.hovered = -1;
        this.selectedRoot.active = true;
        this.selectedHero.node.active = false;
        this.selectedHero.skeletonData = null;
        this.playDragArrow();
        this.slots.forEach((slot, index) => {
            if (slot.highlight) slot.highlight.active = false;
            slot.hero.skeletonData = null;
            slot.hero.node.active = false;
            slot.point.node.active = true;
            slot.replace.node.active = false;
            slot.point.setAnimation(0, 'animation', true);
            this.loadSlotHero(slot, lineup[index], request);
        });
        this.loadInto(this.selectedHero, id, SELECTED_HERO_SIZE, request);
        this.updatePointer(pointer);
    }

    moveTo(pointer: Vec3): void {
        if (!this.selectedId) return;
        const dx = pointer.x - this.pointer.x, dy = pointer.y - this.pointer.y;
        if (dx * dx + dy * dy > 16) this.hideDragArrow();
        this.pointer.set(pointer);
        this.updatePointer(pointer);
    }

    get targetIndex(): number { return this.hovered; }

    hide(): void {
        this.request++;
        this.selectedId = undefined;
        this.hovered = -1;
        this.selectedRoot.active = false;
        this.selectedHero.skeletonData = null;
        this.selectedHero.node.active = false;
        this.hideDragArrow();
        for (const slot of this.slots) {
            if (slot.highlight) slot.highlight.active = false;
            slot.hero.skeletonData = null;
            slot.hero.node.active = false;
            slot.point.node.active = true;
            slot.replace.node.active = false;
        }
    }

    private updatePointer(pointer: Vec3): void {
        const hovered = this.slotAt(pointer);
        this.setHovered(hovered);
        const target = hovered >= 0 && this.slots[hovered]
            ? new Vec3(this.slots[hovered].root.worldPosition.x, this.slots[hovered].root.worldPosition.y, 0)
            : new Vec3(pointer.x, pointer.y + FOLLOW_OFFSET_Y, 0);
        const transform = this.selectedRoot.parent?.getComponent(UITransform);
        if (!transform) return;
        const display = transform.convertToNodeSpaceAR(target);
        const source = transform.convertToNodeSpaceAR(this.source);
        this.selectedRoot.setPosition(display);
        this.dragArrow.node.setPosition(source.x - display.x, source.y - display.y, 0);
    }

    private slotAt(pointer: Vec3): number {
        let best = -1, bestScore = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.slots.length; index++) {
            const slot = this.slots[index];
            const transform = slot.root.getComponent(UITransform);
            if (!transform) continue;
            const local = transform.convertToNodeSpaceAR(pointer);
            const score = Math.max(
                Math.abs(local.x) / (transform.width / 2 + SLOT_HOVER_PADDING_X),
                Math.abs(local.y) / (transform.height / 2 + SLOT_HOVER_PADDING_Y));
            if (score <= 1 && score < bestScore) { best = index; bestScore = score; }
        }
        return best;
    }

    private setHovered(index: number): void {
        if (index === this.hovered) return;
        this.hovered = index;
        this.slots.forEach((slot, slotIndex) => {
            const selected = slotIndex === index;
            if (slot.highlight) slot.highlight.active = selected;
            slot.point.node.active = !selected;
            slot.replace.node.active = selected;
            if (selected) slot.replace.setAnimation(0, 'animation', true);
        });
    }

    private loadSlotHero(slot: ReplaceSlot, id: HeroId | null, request: number): void {
        if (!id) return;
        void this.loadInto(slot.hero, id, SLOT_HERO_SIZE, request);
    }

    private playDragArrow(): void {
        this.dragArrow.setCompleteListener(this.onDragArrowComplete);
        this.dragArrow.node.active = true;
        this.dragArrow.setAnimation(0, 'animation', false);
    }

    private readonly onDragArrowComplete = (): void => {
        this.hideDragArrow();
    };

    private hideDragArrow(): void {
        this.dragArrow.setCompleteListener(() => {});
        this.dragArrow.node.active = false;
    }

    private async loadInto(skeleton: sp.Skeleton, id: HeroId, size: { width: number; height: number }, request: number): Promise<void> {
        try {
            const data = await this.loadHero?.(id);
            if (!data || request !== this.request || !isValid(skeleton, true)) return;
            skeleton.skeletonData = data;
            this.fit(skeleton, data, size);
            skeleton.node.active = true;
            skeleton.setAnimation(0, data.getRuntimeData()?.findAnimation('idle') ? 'idle' : 'attack', true);
        } catch (error) {
            console.warn(`[HeroReplace] ${id} spine load failed`, error);
        }
    }

    private fit(skeleton: sp.Skeleton, data: sp.SkeletonData, size: { width: number; height: number }): void {
        const header = (data.skeletonJson as any)?.skeleton;
        const width = Number(header?.width), height = Number(header?.height);
        if (!(width > 0) || !(height > 0)) { skeleton.node.setScale(.6, .6, 1); return; }
        const scale = Math.min(size.width / width, size.height / height);
        const x = Number(header.x), y = Number(header.y);
        skeleton.node.setScale(scale, scale, 1);
        skeleton.node.setPosition(-(x + width / 2) * scale, -(y + height / 2) * scale, 0);
    }

    private required(path: string): Node {
        const node = this.node.getChildByPath(path);
        if (!node) throw new Error(`HeroReplace missing ${path}`);
        return node;
    }

    dispose(): void {
        this.request++;
        this.loadHero = undefined;
        this.selectedId = undefined;
        if (this.dragArrow?.isValid) this.hideDragArrow();
        this.selectedRoot = undefined!;
        this.selectedHero = undefined!;
        this.dragArrow = undefined!;
        this.slots = [];
        this.hovered = -1;
    }

    onDestroy(): void { this.dispose(); }
}
