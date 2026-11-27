import { ViewNodes } from '../binding/ViewNodes';
import { GameTables } from '../../model/config/GameTables';
import { _decorator, Button, Color, Component, isValid, Label, ProgressBar, Sprite, sp } from 'cc';
import type { HeroDefinition } from '../../model/config/PrototypeConfig';
import { HeroProgress, heroStats, heroGrowth, heroCardState, upgradeCost, unlockCost } from '../../model/hero/HeroProgress';

const ENABLED_COLOR = new Color(255, 255, 255, 255);
const DISABLED_COLOR = new Color(145, 145, 145, 255);

@_decorator.ccclass('HeroDetailView')
export class HeroDetailView extends Component {
    private bindings?: ViewNodes;
    private get ui(): ViewNodes { return this.bindings ?? (this.bindings = new ViewNodes(this.node)); }
    private listeners: (() => void)[] = [];
    private preview?: sp.Skeleton;
    private previewRequest = 0;
    initialize(close: () => void, upgrade: () => void): void {
        this.dispose();
        for (const [path, click] of [['bg/btn_close', close], ['bg/btn_upgrade', upgrade]] as const) {
            const node = this.node.getChildByPath(path);
            if (!node?.getComponent(Button)) throw new Error(`HeroDetail requires ${path}`);
            node.on(Button.EventType.CLICK, click);
            this.listeners.push(() => { if (isValid(node, true)) node.off(Button.EventType.CLICK, click); });
        }
    }
    render(hero: HeroDefinition, entry: HeroProgress, coins: number, message: string): void {
        this.text('bg/bg_name/name', hero.name);
        this.text('bg/item4/lv', entry.unlocked ? `Lv.${entry.level}` : '未解锁');
        this.text('bg/item1/tier_name', GameTables.current.hero(hero.id).tier_name);
        this.text('bg/Description', hero.description);
        const base = heroStats(hero.id, 1), growth = heroGrowth(hero.id, entry.level);
        const range = base.rangeMode === 'full-field' ? '全场' : base.rangeMode === 'half-field' ? '半场' : String(base.range);
        // Display the same cadence family the combat model uses for each attack tier.
        const attackRate = base.attackTier === 1
            ? String(Math.round(base.attackRate * 60))
            : String(Math.floor(60 / base.attackWait));
        const values = [String(base.hp), String(base.damage), String(base.count), String(base.speed), attackRate, range, String(base.cost)];
        values.forEach((value, i) => this.text(this.statValuePath(i + 1), value));
        [growth.hp, growth.damage].forEach((value, i) => {
            const label = this.ui.at(`${this.statItemPath(i + 1)}/value_node/add_value`, Label);
            label.string = `+${value}`; label.node.active = entry.level > 1;
        });
        const state = heroCardState(hero.id, entry), cost = upgradeCost(entry.level), max = state.max;
        const locked = !entry.unlocked, unlockFragments = unlockCost(hero.id);
        this.ui.path('bg/can_upgrade').active = state.ready;
        this.ui.path('bg/can_not_upgrade').active = !state.ready;
        this.ui.at('bg/can_not_upgrade/ProgressBar', ProgressBar).progress = state.progress;
        this.text('bg/fragments/total_fragments', String(entry.shards));
        this.text('bg/fragments/next_level_fragments', locked ? String(unlockFragments) : max ? '满级' : String(state.required));
        this.ui.path('bg/fragments/total_fragments').active = locked || !max;
        this.ui.path('bg/fragments/Slash').active = locked || !max;
        this.text('bg/btn_upgrade/upgrade_gold', locked ? `碎片 x${unlockFragments}` : max ? '' : `x${cost.coins}`);
        this.ui.path('bg/btn_upgrade/upgrade_gold').active = locked || !max;
        this.ui.path('bg/btn_upgrade/gold_icon').active = !locked && !max;
        this.text('bg/Cost', locked
            ? `碎片 ${entry.shards}/${unlockFragments}  ·  解锁后可上阵`
            : `碎片 ${entry.shards}/${max ? '—' : cost.shards}  ·  金币 ${coins}${max ? '' : `/${cost.coins}`}`);
        this.text('bg/Status', message);
        this.text('bg/btn_upgrade/Label', locked ? '解锁' : max ? '已满级' : '升级');
        const canUpgrade = locked
            ? entry.shards >= unlockFragments
            : !max && entry.shards >= cost.shards && coins >= cost.coins;
        this.setUpgradeButtonState(canUpgrade);
    }
    async loadPreview(load: () => Promise<sp.SkeletonData>): Promise<void> {
        const request = ++this.previewRequest;
        const preview = this.preview ?? (this.preview = this.ui.at('bg/spine_bg/hero_spine', sp.Skeleton));
        preview.clearTracks(); preview.skeletonData = null;
        try {
            const data = await load();
            if (request !== this.previewRequest || !isValid(this, true) || !this.node.activeInHierarchy) return;
            preview.skeletonData = data;
            if (!preview.findAnimation('idle')) throw new Error('英雄预览缺少 idle 动画');
            preview.setAnimation(0, 'idle', true);
        } catch (error) {
            if (request === this.previewRequest && isValid(this, true) && this.node.activeInHierarchy)
                this.text('bg/Status', `动画加载失败，可关闭详情后重试：${String(error)}`);
        }
    }
    private text(path: string, value: string): void { this.ui.at(path, Label).string = value; }
    private setUpgradeButtonState(enabled: boolean): void {
        const button = this.ui.at('bg/btn_upgrade', Button);
        button.interactable = enabled;
        const color = enabled ? ENABLED_COLOR : DISABLED_COLOR;
        this.ui.at('bg/btn_upgrade', Sprite).color = color;
        this.ui.at('bg/btn_upgrade/Label', Label).color = color;
        this.ui.at('bg/btn_upgrade/gold_icon', Sprite).color = color;
        this.ui.at('bg/btn_upgrade/upgrade_gold', Label).color = color;
    }
    private statItemPath(index: number): string { return `bg/bg3/item_${index}`; }
    private statValuePath(index: number): string {
        return index <= 2 ? `${this.statItemPath(index)}/value_node/value` : `${this.statItemPath(index)}/value`;
    }
    dispose(): void { this.listeners?.splice(0).forEach(off => off()); }
    onDisable(): void {
        this.previewRequest++;
        if (isValid(this.preview, true)) { this.preview!.clearTracks(); this.preview!.skeletonData = null; }
    }
    onDestroy(): void { this.previewRequest++; this.preview = undefined; this.dispose(); }
}
