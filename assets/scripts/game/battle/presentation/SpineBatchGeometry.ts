/** Cocos 3.8 Spine packs each RGBA colour into four bytes, including NaN bit patterns. */
export const SPINE_BATCH_STRIDE = 10;
export const SPINE_BATCH_VERTICES = 65532;
export const SPINE_BATCH_INDICES = 393216;
export const SPINE_BATCH_TEXTURES = 8;

// Cached poses retain the engine's compact 28-byte layout. Z encodes a page-local
// instance/texture pair; three texels hold the affine transform for local Z=0 and outline.
export const SPINE_GPU_STRIDE = 7;
export const SPINE_WORLD_SIZE = 128;
export const SPINE_WORLD_TEXELS = 3;
export const SPINE_WORLD_CAPACITY = Math.floor(SPINE_WORLD_SIZE * SPINE_WORLD_SIZE / SPINE_WORLD_TEXELS);

export interface CachedSpineModel {
    vCount: number; iCount: number; vData: Uint8Array; iData: Uint16Array;
    meshes: { iCount: number; blendMode: number; textureID: string | number }[];
}
export interface CachedSpineRange {
    first: number; count: number; min: number; vertices: Uint32Array; indices: Uint16Array;
}

/** Validate and scan immutable cached pose indices once, rather than once per soldier/frame. */
export function cachedSpineRanges(model: CachedSpineModel): CachedSpineRange[] | null {
    if (!Number.isInteger(model.vCount) || !Number.isInteger(model.iCount) || !Array.isArray(model.meshes) ||
        !(model.vData instanceof Uint8Array) || !(model.iData instanceof Uint16Array) ||
        model.vData.byteOffset % 4 || model.vData.byteLength < model.vCount * SPINE_GPU_STRIDE * 4 ||
        model.iData.length < model.iCount || model.vCount <= 0 || model.iCount <= 0) return null;
    const source = new Uint32Array(model.vData.buffer, model.vData.byteOffset, model.vCount * SPINE_GPU_STRIDE);
    const ranges: CachedSpineRange[] = [];
    let first = 0;
    for (const mesh of model.meshes) {
        const count = mesh.iCount;
        if (!Number.isInteger(count) || count < 0 || first + count > model.iCount || count > SPINE_BATCH_INDICES) return null;
        if (count === 0) { ranges.push({ first, count, min: 0, vertices: source.subarray(0, 0), indices: new Uint16Array(0) }); continue; }
        let min = Infinity, max = -1;
        for (let i = first; i < first + count; i++) { min = Math.min(min, model.iData[i]); max = Math.max(max, model.iData[i]); }
        if (max >= model.vCount || max - min + 1 > SPINE_BATCH_VERTICES) return null;
        const indices = new Uint16Array(count);
        for (let i = 0; i < count; i++) indices[i] = model.iData[first + i] - min;
        ranges.push({ first, count, min, vertices: source.subarray(min * SPINE_GPU_STRIDE, (max + 1) * SPINE_GPU_STRIDE), indices });
        first += count;
    }
    return first === model.iCount ? ranges : null;
}

/** Match Creator cacheTraverse's byte rounding. Shared source pose data is never modified. */
export function tintCachedSpineRange(source: Uint32Array, r: number, g: number, b: number, opacity: number,
    premultiplied: boolean): Uint32Array {
    const result = source.slice(), bytes = new Uint8Array(result.buffer);
    if (r === 255 && g === 255 && b === 255 && opacity === 1 && !premultiplied) return result;
    for (let v = 0; v < result.length; v += SPINE_GPU_STRIDE) {
        const i = v * 4 + 20, alpha = bytes[i + 3] * opacity, multiplier = premultiplied ? alpha / 255 : 1;
        bytes[i] = Math.floor(bytes[i] * multiplier * r / 255);
        bytes[i + 1] = Math.floor(bytes[i + 1] * multiplier * g / 255);
        bytes[i + 2] = Math.floor(bytes[i + 2] * multiplier * b / 255);
        bytes[i + 3] = Math.floor(alpha);
        bytes[i + 4] = Math.floor(bytes[i + 4] * r / 255);
        bytes[i + 5] = Math.floor(bytes[i + 5] * g / 255);
        bytes[i + 6] = Math.floor(bytes[i + 6] * b / 255);
        bytes[i + 7] = premultiplied ? 255 : 0;
    }
    return result;
}

export function writeCachedSpineRange(vertices: Uint32Array, indices: Uint16Array, target: Float32Array,
    targetBits: Uint32Array, targetIndices: Uint16Array, targetVertex: number, targetIndex: number,
    instance: number, texture: number): void {
    targetBits.set(vertices, targetVertex * SPINE_GPU_STRIDE);
    const id = instance * SPINE_BATCH_TEXTURES + texture;
    for (let v = 0; v < vertices.length / SPINE_GPU_STRIDE; v++) target[(targetVertex + v) * SPINE_GPU_STRIDE + 2] = id;
    for (let i = 0; i < indices.length; i++) targetIndices[targetIndex + i] = indices[i] + targetVertex;
}

/** Copy one draw range, rebasing absolute source indices into the streamed page.
 * Each range owns its vertices so slots sharing source vertices may use different textures.
 */
export function writeSpineRange(source: Float32Array, sourceStride: number, sourceIndices: Uint16Array,
    sourceBase: number, firstIndex: number, indexCount: number, minVertex: number, vertexCount: number,
    target: Float32Array, targetIndices: Uint16Array, targetVertex: number, targetIndex: number,
    textureSlot: number, outlineX: number, outlineY: number): void {
    const srcBits = new Uint32Array(source.buffer, source.byteOffset, source.length);
    const dstBits = new Uint32Array(target.buffer, target.byteOffset, target.length);
    for (let v = 0; v < vertexCount; v++) {
        const s = (minVertex + v) * sourceStride, d = (targetVertex + v) * SPINE_BATCH_STRIDE;
        target[d] = source[s]; target[d + 1] = source[s + 1]; target[d + 2] = source[s + 2];
        target[d + 3] = source[s + 3]; target[d + 4] = source[s + 4];
        dstBits[d + 5] = srcBits[s + 5];
        dstBits[d + 6] = sourceStride === 7 ? srcBits[s + 6] : 0;
        target[d + 7] = textureSlot; target[d + 8] = outlineX; target[d + 9] = outlineY;
    }
    for (let i = 0; i < indexCount; i++)
        targetIndices[targetIndex + i] = sourceIndices[firstIndex + i] - sourceBase - minVertex + targetVertex;
}
