import { _decorator, Button, Component, isValid, Label, sp, tween, Tween, Vec3 } from 'cc';
import type { HeroDefinition, HeroId } from '../../model/config/PrototypeConfig';
import { heroStats } from '../../model/hero/HeroProgress';
import { ViewNodes } from '../binding/ViewNodes';

const { ccclass } = _decorator;

@ccclass('HeroLevelUpDetailView')
export class HeroLevelUpDetailView extends Component {
    private ui?: ViewNodes;
    private listeners: (() => void)[] | null = null;
    private preview?: sp.Skeleton;
    private levelUpFx?: sp.Skeleton;
    private previewScale?: Vec3;
    private previewRequest = 0;
    private get nodes(): ViewNodes { return this.ui ?? (this.ui = new ViewNodes(this.node)); }

    initialize(close: () => void): void {
        this.dispose();
        const button = this.node.getChildByPath('bg/btn_sure');
        if (!button?.getComponent(Button)) throw new Error('HeroLevelUpDetail requires bg/btn_sure');
        button.on(Button.EventType.CLICK, close);
        this.levelUpFx = this.nodes.at('bg/levelup_spine', sp.Skeleton);
        this.levelUpFx.node.active = false;
        this.levelUpFx.clearTracks();
        const listeners: (() => void)[] = this.listeners = [];
        listeners.push(() => { if (isValid(button, true)) button.off(Button.EventType.CLICK, close); });
    }

    render(hero: HeroDefinition, previousLevel: number, currentLevel: number): void {
        const before = heroStats(hero.id, previousLevel), after = heroStats(hero.id, currentLevel);
        this.text('bg/bg_frame_3/hero_name', Array.from(hero.name).join('\n'));
        this.text('bg/Node/previous_level', `Lv.${previousLevel}`);
        this.text('bg/Node/current_level', `Lv.${currentLevel}`);
        this.valueWithGrowth('bg/node/item_1', after.hp, after.hp - before.hp);
        this.valueWithGrowth('bg/node/item_2', after.damage, after.damage - before.damage);
        this.text('bg/node/item_3/value', String(after.count));
        this.text('bg/node/item_4/value', String(after.speed));
        const attackRate = after.attackTier === 1
            ? Math.round(after.attackRate * 60)
            : Math.floor(60 / after.attackWait);
        this.text('bg/node/item_5/value', String(attackRate));
        this.text('bg/node/item_6/value',
            after.rangeMode === 'full-field' ? '全场' : after.rangeMode === 'half-field' ? '半场' : String(after.range));
        this.text('bg/node/item_7/value', String(after.cost));
    }

    playEntrance(): void {
        const preview = this.preview ?? this.nodes.at('bg/hero_spine', sp.Skeleton);
        const node = preview.node;
        const base = this.previewScale ?? (this.previewScale = node.scale.clone());
        Tween.stopAllByTarget(node);
        node.setScale(base.x * .72, base.y * .72, 1);
        tween(node).to(.18, { scale: new Vec3(base.x * 1.08, base.y * 1.08, 1) }, { easing: 'quadOut' })
            .to(.12, { scale: base.clone() }, { easing: 'quadIn' })
            .start();
        const levelUp = this.levelUpFx ?? this.nodes.at('bg/levelup_spine', sp.Skeleton);
        this.levelUpFx = levelUp;
        levelUp.clearTracks();
        levelUp.node.active = true;
        levelUp.setCompleteListener(() => { if (isValid(levelUp.node, true)) levelUp.node.active = false; });
        levelUp.setAnimation(0, 'animation', false);
    }

    async loadPreview(hero: HeroId, load: () => Promise<sp.SkeletonData>): Promise<void> {
        const request = ++this.previewRequest;
        const preview = this.preview ?? (this.preview = this.nodes.at('bg/hero_spine', sp.Skeleton));
        preview.clearTracks();
        preview.skeletonData = null;
        try {
            const data = await load();
            if (request !== this.previewRequest || !isValid(this, true) || !this.node.activeInHierarchy) return;
            preview.skeletonData = data;
            const idle = preview.findAnimation('idle') ? 'idle' :
                data.getRuntimeData()?.findAnimation?.('attack')?.name ??
                data.getRuntimeData()?.findAnimation?.('hit')?.name;
            if (!idle) throw new Error(`${hero} 缺少可播放动画`);
            preview.setAnimation(0, idle, true);
        } catch (error) {
            console.warn(`[HeroLevelUpDetail] ${hero} preview failed`, error);
        }
    }

    dispose(): void {
        const listeners = this.listeners;
        this.listeners = null;
        listeners?.splice(0).forEach(off => off());
        if (isValid(this.preview?.node, true)) Tween.stopAllByTarget(this.preview!.node);
        if (isValid(this.levelUpFx, true)) { this.levelUpFx!.clearTracks(); this.levelUpFx!.node.active = false; }
    }

    onDisable(): void {
        this.previewRequest++;
        if (isValid(this.preview, true)) {
            this.preview!.clearTracks();
            this.preview!.skeletonData = null;
        }
        if (isValid(this.levelUpFx, true)) { this.levelUpFx!.clearTracks(); this.levelUpFx!.node.active = false; }
    }

    onDestroy(): void {
        this.previewRequest++;
        this.preview = undefined;
        this.levelUpFx = undefined;
        this.dispose();
    }

    private valueWithGrowth(path: string, value: number, growth: number): void {
        this.text(`${path}/value_node/value`, String(value));
        const add = this.nodes.at(`${path}/value_node/add_value`, Label);
        add.string = `+${Math.max(0, growth)}`;
        add.node.active = growth > 0;
    }

    private text(path: string, value: string): void {
        this.nodes.at(path, Label).string = value;
    }
}
