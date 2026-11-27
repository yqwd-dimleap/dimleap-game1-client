import { _decorator, Component, EffectAsset, Label, Material, Node, Sprite, UITransform, Vec2, Vec3, Vec4 } from 'cc';
import { Zone } from '../../../model/config/PrototypeConfig';
import { MAX_ZONE_BONUS } from '../../../model/battle/BattleMap';
const { ccclass, property } = _decorator;
const GLOW_COLOR = new Vec4(.58, 1, .38, .78);

/** Normalized artwork outline, independent of Box2D. No inspector node references. */
@ccclass('BattleZone')
export class BattleZone extends Component {
    @property id = '';
    /** Actual troops added by this zone; the artwork may show more decorative "+" marks. */
    @property({ tooltip: '实际增加兵数，范围 1～3；图片中的加号仅用于视觉表达，不必与数量一致。' })
    bonus = 0;
    @property({ type: [Vec2], tooltip: '图片轮廓，中心为(0,0)，边缘约为±0.5；只用于增益判定。' })
    outline: Vec2[] = [];

    private value?: Label;
    private highlightEffect?: EffectAsset;
    private highlightNode?: Node;
    private highlightMaterial?: Material;
    private highlightOpacity = 0;
    private highlightTarget = 0;
    private highlightClock = 0;
    private pulseActive = false;
    get highlighted(): boolean { return this.highlightTarget > 0; }

    setHighlightEffect(effect: EffectAsset): void {
        if (this.highlightEffect === effect) return;
        this.destroyHighlight();
        this.highlightEffect = effect;
    }

    /** Fills the whole authored buffer silhouette while a moving token touches it. */
    trackHighlight(active: boolean, dt: number): void {
        const step = Math.max(0, Math.min(dt, .1));
        active = active || this.pulseActive;
        this.highlightTarget = active ? 1 : 0;
        this.highlightClock += step;
        const rate = active ? 10 : 24;
        this.highlightOpacity += (this.highlightTarget - this.highlightOpacity) * Math.min(1, rate * step);
        if (this.highlightTarget === 0 && this.highlightOpacity < .01) {
            this.highlightOpacity = 0;
            if (this.highlightNode) this.highlightNode.active = false;
            return;
        }
        const pulse = .92 + .08 * Math.sin(this.highlightClock * 4.2);
        const overlay = this.ensureHighlight();
        overlay.active = true;
        const source = this.getComponent(Sprite)?.spriteFrame;
        const width = Math.max(1, source?.texture?.width ?? 1);
        const height = Math.max(1, source?.texture?.height ?? 1);
        this.highlightMaterial!.setProperty('glowColor', GLOW_COLOR);
        this.highlightMaterial!.setProperty('glowParams',
            new Vec4(this.highlightOpacity * pulse * .72, Math.max(2.4 / width, 2.4 / height), .34, 0));
    }

    setTutorialPulse(active: boolean): void {
        this.pulseActive = active;
    }

    clearHighlight(): void {
        this.highlightTarget = 0;
        this.highlightOpacity = 0;
        if (this.highlightNode) this.highlightNode.active = false;
    }

    renderValue(text: string): void {
        this.value ??= this.node.getChildByName('ZoneValue')?.getComponent(Label) ?? undefined;
        if (!this.value) throw new Error(`${this.node.name}: missing ZoneValue/Label`);
        this.value.string = text;
    }

    private ensureHighlight(): Node {
        if (this.highlightNode) return this.highlightNode;
        if (!this.highlightEffect) throw new Error(`${this.node.name}: buffer highlight effect is not loaded`);
        const source = this.getComponent(Sprite), sourceUI = this.getComponent(UITransform);
        if (!source?.spriteFrame || !sourceUI) throw new Error(`${this.node.name}: buffer highlight requires a SpriteFrame`);
        const node = new Node('BufferHighlight');
        node.layer = this.node.layer;
        this.node.addChild(node);
        node.setSiblingIndex(0);
        node.setPosition(0, 0, 0);
        // Keep the overlay geometrically identical to the authored buffer. Scaling
        // around a non-centred anchor can expose only part of an irregular mask.
        node.setScale(1, 1, 1);
        const ui = node.addComponent(UITransform);
        const sprite = node.addComponent(Sprite);
        sprite.spriteFrame = source.spriteFrame;
        sprite.type = source.type;
        sprite.sizeMode = source.sizeMode;
        sprite.trim = source.trim;
        // SpriteFrame assignment can resize a TRIMMED sprite. Apply the authored
        // final geometry after all Sprite settings so decoration and mask stay aligned.
        ui.setContentSize(sourceUI.width, sourceUI.height);
        ui.setAnchorPoint(sourceUI.anchorX, sourceUI.anchorY);
        const material = new Material();
        material.initialize({ effectAsset: this.highlightEffect });
        material.setProperty('glowColor', GLOW_COLOR);
        sprite.customMaterial = material;
        this.highlightNode = node;
        this.highlightMaterial = material;
        return node;
    }

    private destroyHighlight(): void {
        if (this.highlightNode?.isValid) this.highlightNode.destroy();
        this.highlightMaterial?.destroy();
        this.highlightNode = undefined;
        this.highlightMaterial = undefined;
        this.highlightOpacity = 0;
        this.highlightTarget = 0;
    }

    onDestroy(): void {
        this.destroyHighlight();
    }

    read(board: Node): Zone {
        if (!Number.isInteger(this.bonus) || this.bonus <= 0)
            throw new Error(`${this.node.name}: invalid bonus ${this.bonus}; expected 1..${MAX_ZONE_BONUS}`);
        // Authored zones use both CUSTOM and TRIMMED Sprite modes. The outline is
        // normalized against the final UITransform size, so the Sprite size mode
        // must not reject otherwise valid map artwork.
        const ui = this.getComponent(UITransform);
        const target = board.getComponent(UITransform);
        if (!ui || !target || !(ui.width > 0) || !(ui.height > 0))
            throw new Error(`${this.node.name}: invalid zone UITransform size`);
        const centre = target.convertToNodeSpaceAR(this.node.worldPosition);
        const polygon = this.outline.map(p => {
            const world = ui.convertToWorldSpaceAR(new Vec3(p.x * ui.width, p.y * ui.height));
            const local = target.convertToNodeSpaceAR(world);
            return { x: local.x - centre.x, y: local.y - centre.y };
        });
        return { id: this.id, bonus: Math.min(MAX_ZONE_BONUS, this.bonus), x: centre.x, y: centre.y,
            radius: Math.max(...polygon.map(p => Math.hypot(p.x, p.y))), polygon };
    }
}
