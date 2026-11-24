import { _decorator, Sprite } from 'cc';
import { RibbonQuad } from '../../../model/battle/AimRibbon';
const { ccclass } = _decorator;

/** A standard 2D Sprite quad or triangle from the non-overlapping ribbon mesh. */
@ccclass('AimRibbonSprite')
export class AimRibbonSprite extends Sprite {
    quad?: RibbonQuad;
    protected _flushAssembler(): void {
        super._flushAssembler();
        // Creator 3.8's simple assembler still owns UV atlas packing, batching and world transforms.
        const self = this as any, base = self._assembler;
        // VERTEX fill (1 in Creator 3.8): preserve the tail's individual vertex alpha.
        self.setFillColorType(1);
        const assembler = Object.create(base);
        assembler.updateRenderData = (sprite: AimRibbonSprite): void => {
            base.updateRenderData(sprite);
            const data = sprite.renderData, quad = sprite.quad, frame = sprite.spriteFrame;
            if (!data || !quad || !frame) return;
            const uv = frame.uv, vb = data.chunk.vb, stride = data.floatStride;
            for (let i = 0; i < 4; i++) {
                const t = quad.samples[i].y, side = quad.samples[i].x;
                data.data[i].x = quad.corners[i].x; data.data[i].y = quad.corners[i].y;
                const k = i * stride;
                const nearU = uv[0] * (1 - side) + uv[2] * side, farU = uv[4] * (1 - side) + uv[6] * side;
                const nearV = uv[1] * (1 - side) + uv[3] * side, farV = uv[5] * (1 - side) + uv[7] * side;
                vb[k + 3] = nearU * (1 - t) + farU * t;
                vb[k + 4] = nearV * (1 - t) + farV * t;
                vb[k + 8] = sprite.color.a / 255 * Math.min(1, (1 - t) / .2);
            }
            data.vertDirty = true;
        };
        self._assembler = assembler;
    }
}

