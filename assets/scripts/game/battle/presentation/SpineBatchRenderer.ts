import { director, Director, EffectAsset, gfx, Material, MeshBuffer, renderer, sp, Texture2D } from 'cc';
import { JSB } from 'cc/env';
import { SPINE_BATCH_INDICES, SPINE_BATCH_STRIDE, SPINE_BATCH_TEXTURES, SPINE_BATCH_VERTICES, writeSpineRange } from './SpineBatchGeometry';
import { SpineGpuBatchRenderer } from './SpineGpuBatchRenderer';

// Version adapter for the Web Spine assembler in Creator 3.8.8. No engine prototypes are changed.
// The native assembler has a different submission path and keeps its normal renderer.
type Middleware = {
    commitMiddleware(comp: sp.Skeleton, buffer: MeshBuffer, offset: number, count: number,
        texture: Texture2D, material: Material, enabled: boolean): void;
};
type Draw = { texture: Texture2D | null; material: Material; indexOffset: number; indexCount: number };
type Render = (this: sp.Skeleton, batcher: Middleware) => void;
type WebSkeleton = sp.Skeleton & {
    _render: Render;
    _drawList: { length: number; data: Draw[] };
};
type Page = { buffer: MeshBuffer; textures: Texture2D[]; materials: Map<string, Material>; bound: Texture2D[] };
type Range = { drawIndex: number; min: number; count: number };

const ATTRIBUTES = [
    new gfx.Attribute(gfx.AttributeName.ATTR_POSITION, gfx.Format.RGB32F),
    new gfx.Attribute(gfx.AttributeName.ATTR_TEX_COORD, gfx.Format.RG32F),
    new gfx.Attribute(gfx.AttributeName.ATTR_COLOR, gfx.Format.RGBA8, true),
    new gfx.Attribute(gfx.AttributeName.ATTR_COLOR2, gfx.Format.RGBA8, true),
    new gfx.Attribute('a_batch', gfx.Format.RGB32F),
];

/** Stream in scene traversal order, retaining native stencil/layer/blend boundaries.
 * A page has at most eight textures and 65532 vertices; overflow starts another page.
 * Per-vertex outline widths let the two teams share a draw without reordering them.
 */
export class SpineBatchRenderer {
    private pages: Page[] = [];
    private cursor = 0;
    private originals = new WeakMap<sp.Skeleton, Render>();
    private blendKeys = new WeakMap<Material, string>();
    private disposed = false;
    private parent?: Material;
    private ranges: Range[] = [];
    private gpu: SpineGpuBatchRenderer;
    constructor(private effect: EffectAsset, private outline: (skeleton: sp.Skeleton) => number | null) {
        this.gpu = new SpineGpuBatchRenderer(effect, outline);
        if (JSB) return;
        director.on(Director.EVENT_BEFORE_DRAW, this.begin, this);
        director.on(Director.EVENT_BEFORE_COMMIT, this.upload, this);
    }
    attach(skeleton: sp.Skeleton): void {
        if (JSB || this.disposed || this.originals.has(skeleton)) return;
        const web = skeleton as WebSkeleton, original = web._render;
        if (typeof original !== 'function') return;
        this.originals.set(skeleton, original);
        this.gpu.attach(skeleton);
        const owner = this;
        web._render = function (batcher): void {
            if (!owner.gpu.draw(this, batcher) && !owner.draw(this as WebSkeleton, batcher)) original.call(this, batcher);
        };
    }
    detach(skeleton: sp.Skeleton): void {
        this.gpu.detach(skeleton);
        const original = this.originals.get(skeleton);
        if (original) { (skeleton as WebSkeleton)._render = original; this.originals.delete(skeleton); }
    }
    private begin(): void {
        this.cursor = 0;
        for (const page of this.pages) {
            const b = page.buffer;
            b.reset(); b.vertexOffset = b.indexOffset = b.byteOffset = 0;
            page.textures.length = 0;
        }
    }
    private upload(): void {
        for (const page of this.pages) if (page.buffer.indexOffset) {
            for (let i = 0; i < SPINE_BATCH_TEXTURES; i++) {
                const texture = page.textures[i] ?? page.textures[0];
                if (page.bound[i] === texture) continue;
                for (const material of page.materials.values()) material.setProperty(`texture${i}`, texture);
                page.bound[i] = texture;
            }
            page.buffer.uploadBuffers();
        }
        // Retain only pages used this frame. Scene reset must release a previous stress army.
        for (let i = this.pages.length - 1; i > this.cursor; i--) this.destroyPage(this.pages.pop()!);
    }
    private page(vertices: number, indices: number, texture: Texture2D): Page {
        let page = this.pages[this.cursor];
        if (page && (page.buffer.vertexOffset + vertices > SPINE_BATCH_VERTICES ||
            page.buffer.indexOffset + indices > SPINE_BATCH_INDICES ||
            (!page.textures.includes(texture) && page.textures.length === SPINE_BATCH_TEXTURES))) page = this.pages[++this.cursor];
        if (!page) {
            const buffer = new MeshBuffer();
            buffer.initialize(director.root!.device, ATTRIBUTES, SPINE_BATCH_VERTICES * SPINE_BATCH_STRIDE, SPINE_BATCH_INDICES);
            page = { buffer, textures: [], materials: new Map(), bound: [] }; this.pages.push(page);
        }
        if (!page.textures.includes(texture)) page.textures.push(texture);
        return page;
    }
    private material(page: Page, source: Material): Material {
        const blendState = source.passes[0].blendState;
        let key = this.blendKeys.get(source);
        if (key === undefined) { key = JSON.stringify(blendState); this.blendKeys.set(source, key); }
        let material = page.materials.get(key);
        if (!material) {
            if (!this.parent) { this.parent = new Material(); this.parent.initialize({ effectAsset: this.effect }); }
            material = new renderer.MaterialInstance({ parent: this.parent });
            material.overridePipelineStates({ blendState });
            // Keep unused samplers valid, including on WebGL 1.
            for (let i = 0; i < SPINE_BATCH_TEXTURES; i++) material.setProperty(`texture${i}`, page.textures[i] ?? page.textures[0]);
            page.materials.set(key, material);
        }
        return material;
    }
    private draw(skeleton: WebSkeleton, batcher: Middleware): boolean {
        if (this.disposed || !skeleton.enableBatch) return false;
        const width = this.outline(skeleton);
        if (width === null) return false;
        const rd = skeleton.renderData, list = skeleton._drawList;
        if (!rd?.chunk || !rd.indices || !list?.length) return false;
        const stride = rd.getMeshBuffer()!.vertexFormatBytes / 4;
        if (stride !== 6 && stride !== 7) return false;
        // Validate all ranges before submitting any, so fallback never draws a partial skeleton twice.
        let rangeCount = 0;
        for (let d = 0; d < list.length; d++) {
            const draw = list.data[d];
            if (!draw.texture || !draw.indexCount) continue;
            if (draw.indexOffset < 0 || draw.indexOffset + draw.indexCount > rd.indices.length ||
                draw.indexCount > SPINE_BATCH_INDICES || !draw.material?.passes[0]) return false;
            let min = Infinity, max = -1;
            for (let i = draw.indexOffset, end = i + draw.indexCount; i < end; i++) {
                const v = rd.indices[i] - rd.chunk.vertexOffset; min = Math.min(min, v); max = Math.max(max, v);
            }
            if (min < 0 || max >= rd.vertexCount || max - min + 1 > SPINE_BATCH_VERTICES) return false;
            const range = this.ranges[rangeCount] ?? (this.ranges[rangeCount] = { drawIndex: d, min, count: 0 });
            range.drawIndex = d; range.min = min; range.count = max - min + 1; rangeCount++;
        }
        for (let d = 0; d < rangeCount; d++) {
            const { drawIndex, min, count } = this.ranges[d], draw = list.data[drawIndex], texture = draw.texture!;
            const page = this.page(count, draw.indexCount, texture), b = page.buffer;
            const material = this.material(page, draw.material);
            writeSpineRange(rd.chunk.vb, stride, rd.indices, rd.chunk.vertexOffset, draw.indexOffset, draw.indexCount,
                min, count, b.vData, b.iData, b.vertexOffset, b.indexOffset, page.textures.indexOf(texture),
                width / texture.width, width / texture.height);
            const index = b.indexOffset;
            b.vertexOffset += count; b.indexOffset += draw.indexCount; b.byteOffset = b.vertexOffset * SPINE_BATCH_STRIDE * 4; b.setDirty();
            // The shader samples its own palette. Use its first texture as the stable middleware key.
            batcher.commitMiddleware(skeleton, b, index, draw.indexCount, page.textures[0], material, true);
        }
        this.ranges.length = rangeCount;
        return true;
    }
    private destroyPage(page: Page): void {
        for (const material of page.materials.values()) material.destroy();
        page.materials.clear(); page.textures.length = page.bound.length = 0; page.buffer.destroy();
    }
    destroy(): void {
        this.disposed = true;
        this.gpu.destroy();
        director.off(Director.EVENT_BEFORE_DRAW, this.begin, this);
        director.off(Director.EVENT_BEFORE_COMMIT, this.upload, this);
        for (const page of this.pages) this.destroyPage(page);
        this.pages = [];
        this.ranges = [];
        this.parent?.destroy(); this.parent = undefined;
    }
}
