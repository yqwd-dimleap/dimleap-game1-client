import { assetManager, director, Director, EffectAsset, gfx, Material, MeshBuffer, renderer, sp, Texture2D } from 'cc';
import { JSB } from 'cc/env';
import { CachedSpineModel, CachedSpineRange, cachedSpineRanges, SPINE_BATCH_INDICES, SPINE_BATCH_TEXTURES,
    SPINE_BATCH_VERTICES, SPINE_GPU_STRIDE, SPINE_WORLD_CAPACITY, SPINE_WORLD_SIZE, SPINE_WORLD_TEXELS,
    tintCachedSpineRange, writeCachedSpineRange } from './SpineBatchGeometry';

type Assembler = { updateRenderData(comp: sp.Skeleton): void };
type WebSkeleton = {
    _assembler?: Assembler;
    node: sp.Skeleton['node'] & { _uiProps: { opacity: number } };
    drawList: { reset(): void };
    syncAttachedNode(): void;
    updateRenderData(): CachedSpineModel | null;
    _slotTextures?: Map<string, Texture2D>;
};
type Binding = { base?: Assembler; adapter?: Assembler; descriptor?: PropertyDescriptor;
    ready: boolean; model?: CachedSpineModel; ranges?: CachedSpineRange[] };
type Pose = { ranges: CachedSpineRange[] | null; colors: Map<string, Uint32Array[]> };
type Page = { buffer: MeshBuffer; bits: Uint32Array; textures: Texture2D[]; bound: Texture2D[];
    materials: Map<string, Material>; world: Texture2D; matrices: Float32Array; instances: number };
type Middleware = { commitMiddleware(comp: sp.Skeleton, buffer: MeshBuffer, offset: number, count: number,
    texture: Texture2D, material: Material, enabled: boolean): void };
const ATTRIBUTES = [
    new gfx.Attribute(gfx.AttributeName.ATTR_POSITION, gfx.Format.RGB32F),
    new gfx.Attribute(gfx.AttributeName.ATTR_TEX_COORD, gfx.Format.RG32F),
    new gfx.Attribute(gfx.AttributeName.ATTR_COLOR, gfx.Format.RGBA8, true),
    new gfx.Attribute(gfx.AttributeName.ATTR_COLOR2, gfx.Format.RGBA8, true),
];

/** Creator 3.8.8 Web adapter, scoped to explicitly attached Skeleton instances.
 * Read cached local poses directly: no per-unit native cacheTraverse copy/transform.
 * Ordered pages keep exact traversal/stencil order, with page-local matrix/outline data.
 * Realtime, unknown materials, invalid models and unsupported devices use the CPU path.
 */
export class SpineGpuBatchRenderer {
    enabled = true;
    readonly supported: boolean;
    private bindings = new Map<sp.Skeleton, Binding>();
    private poses = new WeakMap<CachedSpineModel, Pose>();
    private pages: Page[] = [];
    private cursor = 0;
    private parent?: Material;
    private disposed = false;
    private region?: gfx.BufferTextureCopy;
    constructor(private effect: EffectAsset, private outline: (skeleton: sp.Skeleton) => number | null) {
        const device = director.root?.device, caps = device?.capabilities;
        this.supported = !JSB && !!device && !!caps && caps.maxVertexTextureUnits >= 1 &&
            // Creator allocates sampler units modulo maxTextureUnits, including vertex samplers.
            caps.maxTextureSize >= SPINE_WORLD_SIZE && caps.maxTextureUnits >= SPINE_BATCH_TEXTURES + 1 &&
            !!(device.getFormatFeatures(gfx.Format.RGBA32F) & gfx.FormatFeatureBit.SAMPLED_TEXTURE);
        if (!this.supported) return;
        this.region = new gfx.BufferTextureCopy();
        this.region.texExtent.width = SPINE_WORLD_SIZE;
        director.on(Director.EVENT_BEFORE_DRAW, this.begin, this);
        director.on(Director.EVENT_BEFORE_COMMIT, this.upload, this);
    }
    attach(skeleton: sp.Skeleton): void {
        if (!this.supported || this.disposed || this.bindings.has(skeleton)) return;
        const web = skeleton as unknown as WebSkeleton;
        const binding: Binding = { base: web._assembler, ready: false,
            descriptor: Object.getOwnPropertyDescriptor(web, '_assembler') };
        if (binding.descriptor && !binding.descriptor.configurable) return;
        const owner = this;
        const adapt = (base?: Assembler): void => {
            if (base === binding.adapter) return;
            binding.base = base;
            if (!base) { binding.adapter = undefined; return; }
            const adapter = Object.create(base) as Assembler;
            adapter.updateRenderData = (comp): void => {
                binding.ready = false;
                if (owner.eligible(comp)) {
                    const model = (comp as unknown as WebSkeleton).updateRenderData();
                    if (model) {
                        const pose = owner.pose(model);
                        if (pose.ranges) {
                            binding.model = model; binding.ranges = pose.ranges; binding.ready = true;
                            web.drawList.reset(); web.syncAttachedNode();
                            return;
                        }
                    }
                }
                binding.model = undefined; binding.ranges = undefined;
                base.updateRenderData(comp);
            };
            binding.adapter = adapter;
        };
        adapt(binding.base);
        // Skeleton may replace its assembler while configuring cache mode or skeletonData.
        // Wrap only this instance, retaining the engine's original assembler and descriptor.
        Object.defineProperty(web, '_assembler', { configurable: true, enumerable: binding.descriptor?.enumerable ?? true,
            get: () => binding.adapter, set: adapt });
        this.bindings.set(skeleton, binding);
    }
    detach(skeleton: sp.Skeleton): void {
        const binding = this.bindings.get(skeleton);
        if (!binding) return;
        const web = skeleton as unknown as WebSkeleton;
        delete web._assembler;
        if (binding.descriptor) {
            Object.defineProperty(web, '_assembler', binding.descriptor);
            if ('value' in binding.descriptor) web._assembler = binding.base;
            else binding.descriptor.set?.call(web, binding.base);
        }
        else web._assembler = binding.base;
        this.bindings.delete(skeleton);
    }
    private eligible(skeleton: sp.Skeleton): boolean {
        return this.enabled && !this.disposed && skeleton.enableBatch && skeleton.isAnimationCached() &&
            !!skeleton.skeletonData?.isValid && skeleton.node.active && skeleton.color.a > 0 &&
            !skeleton.debugBones && !skeleton.debugSlots && !skeleton.debugMesh && this.outline(skeleton) !== null;
    }
    private pose(model: CachedSpineModel): Pose {
        let pose = this.poses.get(model);
        if (!pose) { pose = { ranges: cachedSpineRanges(model), colors: new Map() }; this.poses.set(model, pose); }
        return pose;
    }
    /** Called before the CPU renderer; if an otherwise prepared draw cannot use GPU,
     * rebuild native data first so fallback never consumes an empty/stale native buffer. */
    draw(skeleton: sp.Skeleton, batcher: Middleware): boolean {
        const binding = this.bindings.get(skeleton);
        if (!binding?.ready) return false;
        const model = binding.model!, ranges = binding.ranges!;
        const width = this.outline(skeleton);
        const textures: Texture2D[] = [];
        const matrix = skeleton.node.worldMatrix;
        // Cached Spine vertices are 2D. Retain all three world axes, with an affine W=1.
        if (this.eligible(skeleton) && width !== null && matrix.m03 === 0 && matrix.m07 === 0 && matrix.m15 === 1) {
            const web = skeleton as unknown as WebSkeleton;
            for (const mesh of model.meshes) {
                const id = String(mesh.textureID);
                const texture = assetManager.assets.get(id) as Texture2D | undefined ??
                    skeleton.skeletonData?.textures.find(t => t.uuid === id || t.getId() === id) ?? web._slotTextures?.get(id);
                if ((!texture && mesh.iCount) || mesh.blendMode < 0 || mesh.blendMode > 3) break;
                textures.push(texture!);
            }
        }
        if (textures.length !== model.meshes.length || width === null) {
            binding.ready = false; binding.base?.updateRenderData(skeleton); return false;
        }
        const color = skeleton.color, opacity = (skeleton as unknown as WebSkeleton).node._uiProps.opacity;
        const pose = this.pose(model), key = `${color.r}/${color.g}/${color.b}/${opacity}/${skeleton.premultipliedAlpha}`;
        let vertices = pose.colors.get(key);
        if (!vertices) {
            // Limit variants during animated opacity/tint; the common white/PMA pose is shared by the army.
            if (pose.colors.size >= 4) pose.colors.delete(pose.colors.keys().next().value!);
            vertices = ranges.map(range => tintCachedSpineRange(range.vertices, color.r, color.g, color.b,
                opacity, skeleton.premultipliedAlpha));
            pose.colors.set(key, vertices);
        }
        for (let d = 0; d < ranges.length; d++) {
            const range = ranges[d]; if (!range.count) continue;
            const texture = textures[d], vertexCount = vertices[d].length / SPINE_GPU_STRIDE;
            const page = this.page(vertexCount, range.count, texture), instance = page.instances++;
            // Each slot draw has independent outline parameters, including differently sized textures.
            this.writeWorld(page, instance, skeleton, width / texture.width, width / texture.height);
            const b = page.buffer, offset = b.indexOffset;
            writeCachedSpineRange(vertices[d], range.indices, b.vData, page.bits, b.iData, b.vertexOffset,
                offset, instance, page.textures.indexOf(texture));
            b.vertexOffset += vertexCount; b.indexOffset += range.count;
            b.byteOffset = b.vertexOffset * SPINE_GPU_STRIDE * 4; b.setDirty();
            batcher.commitMiddleware(skeleton, b, offset, range.count, page.textures[0],
                this.material(page, model.meshes[d].blendMode, skeleton.premultipliedAlpha), true);
        }
        return true;
    }
    private begin(): void {
        this.cursor = 0;
        for (const page of this.pages) {
            page.buffer.reset(); page.buffer.vertexOffset = page.buffer.indexOffset = page.buffer.byteOffset = 0;
            page.textures.length = 0; page.instances = 0;
        }
    }
    private page(vertices: number, indices: number, texture: Texture2D): Page {
        let page = this.pages[this.cursor];
        if (page && (page.buffer.vertexOffset + vertices > SPINE_BATCH_VERTICES ||
            page.buffer.indexOffset + indices > SPINE_BATCH_INDICES || page.instances >= SPINE_WORLD_CAPACITY ||
            (!page.textures.includes(texture) && page.textures.length === SPINE_BATCH_TEXTURES))) page = this.pages[++this.cursor];
        if (!page) {
            const buffer = new MeshBuffer();
            buffer.initialize(director.root!.device, ATTRIBUTES, SPINE_BATCH_VERTICES * SPINE_GPU_STRIDE, SPINE_BATCH_INDICES);
            const world = new Texture2D();
            world.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
            world.reset({ width: SPINE_WORLD_SIZE, height: SPINE_WORLD_SIZE, format: Texture2D.PixelFormat.RGBA32F, mipmapLevel: 0 });
            page = { buffer, bits: new Uint32Array(buffer.vData.buffer), textures: [], bound: [], materials: new Map(), world,
                matrices: new Float32Array(SPINE_WORLD_SIZE * SPINE_WORLD_SIZE * 4), instances: 0 };
            this.pages.push(page);
        }
        if (!page.textures.includes(texture)) page.textures.push(texture);
        return page;
    }
    private writeWorld(page: Page, instance: number, skeleton: sp.Skeleton, outlineX: number, outlineY: number): void {
        const m = skeleton.node.worldMatrix, data = page.matrices, i = instance * SPINE_WORLD_TEXELS * 4;
        data[i] = m.m00; data[i + 1] = m.m01; data[i + 2] = m.m02; data[i + 3] = outlineX;
        data[i + 4] = m.m04; data[i + 5] = m.m05; data[i + 6] = m.m06; data[i + 7] = outlineY;
        data[i + 8] = m.m12; data[i + 9] = m.m13; data[i + 10] = m.m14; data[i + 11] = 1;
    }
    private material(page: Page, blend: number, pma: boolean): Material {
        const key = `${blend}/${pma}`;
        let material = page.materials.get(key);
        if (!material) {
            if (!this.parent) {
                this.parent = new Material(); this.parent.initialize({ effectAsset: this.effect, defines: { USE_SPINE_WORLD: true } });
            }
            material = new renderer.MaterialInstance({ parent: this.parent });
            const f = gfx.BlendFactor;
            const src = blend === 2 ? f.DST_COLOR : pma ? f.ONE : f.SRC_ALPHA;
            const dst = blend === 1 ? f.ONE : blend === 3 ? f.ONE_MINUS_SRC_COLOR : f.ONE_MINUS_SRC_ALPHA;
            material.overridePipelineStates({ blendState: { targets: [{ blend: true, blendSrc: src, blendDst: dst,
                blendSrcAlpha: src, blendDstAlpha: dst }] } });
            material.setProperty('worldData', page.world);
            for (let i = 0; i < SPINE_BATCH_TEXTURES; i++) material.setProperty(`texture${i}`, page.textures[i] ?? page.textures[0]);
            page.materials.set(key, material);
        }
        return material;
    }
    private upload(): void {
        for (const page of this.pages) if (page.buffer.indexOffset) {
            for (let i = 0; i < SPINE_BATCH_TEXTURES; i++) {
                const texture = page.textures[i] ?? page.textures[0];
                if (page.bound[i] === texture) continue;
                for (const material of page.materials.values()) material.setProperty(`texture${i}`, texture);
                page.bound[i] = texture;
            }
            this.region!.texExtent.height = Math.ceil(page.instances * SPINE_WORLD_TEXELS / SPINE_WORLD_SIZE);
            director.root!.device.copyBuffersToTexture([page.matrices], page.world.getGFXTexture()!, [this.region!]);
            page.buffer.uploadBuffers();
        }
        for (let i = this.pages.length - 1; i > this.cursor; i--) this.destroyPage(this.pages.pop()!);
    }
    private destroyPage(page: Page): void {
        for (const material of page.materials.values()) material.destroy();
        page.materials.clear(); page.world.destroy(); page.buffer.destroy();
    }
    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        director.off(Director.EVENT_BEFORE_DRAW, this.begin, this);
        director.off(Director.EVENT_BEFORE_COMMIT, this.upload, this);
        for (const skeleton of this.bindings.keys()) this.detach(skeleton);
        for (const page of this.pages) this.destroyPage(page);
        this.pages = []; this.poses = new WeakMap(); this.parent?.destroy(); this.parent = undefined;
    }
}
