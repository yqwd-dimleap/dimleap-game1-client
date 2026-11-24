import { ViewNodes } from '../binding/ViewNodes';
import { _decorator, Button, Component, isValid, Label, ProgressBar, Sprite, SpriteFrame } from 'cc';
import type { HeroDefinition } from '../../model/config/PrototypeConfig';
import { HeroProgress, heroCardState } from '../../model/hero/HeroProgress';

export interface HeroCardArt { frames: readonly SpriteFrame[]; levels: readonly SpriteFrame[]; names: readonly SpriteFrame[] }

/** Presentation of an authored collection card, with no Inspector node references. */
@_decorator.ccclass('HeroCardView')
export class HeroCardView extends Component {
    private bindings?: ViewNodes;
    private get ui(): ViewNodes { return this.bindings ?? (this.bindings = new ViewNodes(this.node)); }
    private click?: () => void;
    initialize(click: () => void): void {
        this.dispose(); this.click = click;
        this.node.on(Button.EventType.CLICK, click);
    }
    render(hero: HeroDefinition, entry: HeroProgress, icon: SpriteFrame | null, art?: HeroCardArt, unlocked?: boolean): void {
        const state = heroCardState(hero.id, entry, unlocked);
        const showHero = state.unlocked && !!art;
        if (art) {
            this.ui.at('hero_frame', Sprite).spriteFrame = art.frames[state.frame];
            this.ui.at('hero/lv_bg', Sprite).spriteFrame = art.levels[state.tier - 1];
            this.ui.at('hero/name_bg', Sprite).spriteFrame = art.names[state.tier];
            this.ui.at('hero_lock/name_bg_0', Sprite).spriteFrame = art.names[0];
        }
        this.ui.path('hero').active = showHero;
        this.ui.path('hero_lock').active = !showHero;
        this.ui.at('hero_lock/name_bg_0/Label', Label).string = '？\n？\n？';
        const button = this.getComponent(Button);
        // Locked cards stay clickable so the detail panel can offer fragment unlock.
        if (button) button.interactable = true;
        const portrait = this.ui.at('hero/hero_icon', Sprite); portrait.spriteFrame = icon; portrait.enabled = !!icon;
        const fallback = this.ui.at('hero/hero_icon/Fallback', Label); fallback.string = ''; fallback.node.active = false;
        this.ui.path('hero/name_bg').active = false;
        this.ui.at('hero/name_bg/name', Label).string = '';
        this.ui.at('hero/lv_bg/Label', Label).string = `Lv.${entry.level}`;
        this.ui.path('hero/can_upgrade').active = state.ready;
        this.ui.path('hero/can_not_upgrade').active = !state.ready;
        this.ui.at('hero/fragments/total_fragments', Label).string = String(entry.shards);
        this.ui.at('hero/fragments/next_level_fragments', Label).string = state.max ? '满级' : String(state.required);
        this.ui.path('hero/fragments/total_fragments').active = !state.max;
        this.ui.path('hero/fragments/Slash').active = !state.max;
        this.ui.at('hero/can_not_upgrade/ProgressBar', ProgressBar).progress = state.progress;
    }
    dispose(): void { if (this.click && isValid(this.node, true)) this.node.off(Button.EventType.CLICK, this.click); this.click = undefined; }
    onDestroy(): void { this.dispose(); }
}
