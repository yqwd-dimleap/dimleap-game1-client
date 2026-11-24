import { Color, Graphics, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { Point, Team } from '../../../model/config/PrototypeConfig';
import { AIM_RIBBON_WIDTH, aimRibbonQuads } from '../../../model/battle/AimRibbon';
import { AimRibbonSprite } from './AimRibbonSprite';
export class AimGuideView {
    private frames!: [SpriteFrame, SpriteFrame];
    private segments: AimRibbonSprite[] = [];
    constructor(readonly node: Node, blue: SpriteFrame, red: SpriteFrame) {
        this.frames = [blue, red];
        const oldDots = node.getComponent(Graphics); if (oldDots) { oldDots.clear(); oldDots.enabled = false; }
    }
    show(path: readonly Point[], team: Team): void {
        const quads = aimRibbonQuads(path, AIM_RIBBON_WIDTH);
        quads.forEach((quad, i) => {
            let sprite = this.segments[i];
            if (!sprite) {
                const node = new Node(`Ribbon_${i}`); node.layer = this.node.layer; this.node.addChild(node);
                node.addComponent(UITransform).setContentSize(1, 1);
                sprite = node.addComponent(AimRibbonSprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                this.segments.push(sprite);
            }
            sprite.color = new Color(255, 255, 255, 155);
            sprite.quad = quad; sprite.spriteFrame = this.frames[team]; sprite.node.active = true;
            sprite.markForUpdateRenderData();
        });
        for (let i = quads.length; i < this.segments.length; i++) this.segments[i].node.active = false;
    }
    clear(): void { for (const sprite of this.segments) sprite.node.active = false; }
}
