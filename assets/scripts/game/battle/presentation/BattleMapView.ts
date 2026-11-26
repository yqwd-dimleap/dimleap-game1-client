import { _decorator, BoxCollider2D, CircleCollider2D, Collider2D, Component, EffectAsset, Node, Sprite, UITransform, Vec2, Vec3 } from 'cc';
import { RULES, Zone } from '../../../model/config/PrototypeConfig';
import { authoredZoneLayout, randomZoneLayout, zoneContains } from '../../../model/battle/BattleMap';
import type { CombatObstacle } from '../../../model/battle/CombatCollision';
import { BattleZone } from './BattleZone';
const { ccclass, property } = _decorator;
interface HighlightToken { node: Node; launched: boolean; enteredArena: boolean; moving: boolean }
const SETTLE_HIGHLIGHT_HOLD_SECONDS = .5;

@ccclass('BattleMapView')
export class BattleMapView extends Component {
    @property({ tooltip: '关闭时使用编辑器布局；开启后每局生成不重叠增益布局。' }) randomizeZones = false;
    @property({ tooltip: '0为每局新种子；非0用于复现同一地图。' }) layoutSeed = 0;
    @property({ tooltip: '仅随机布局：增益轮廓距场地边缘的最小距离。固定地图保留编辑器位置。' }) edgeMargin = 48;
    @property({ tooltip: '随机布局中增益块之间的最小间距。' }) zoneGap = 16;
    mapId = '';
    private zoneRoot?: Node;
    private authored?: Zone[];
    private regions: BattleZone[] = [];
    private solidObstacles: readonly CombatObstacle[] = [];
    private current: readonly Zone[] = [];
    private highlightEffect?: EffectAsset;
    private tutorialPulseActive = false;
    private readonly litZones = new Set<string>();
    private readonly releaseDelays = new Map<string, number>();
    seed: number | null = null;
    get obstacles(): readonly CombatObstacle[] { return this.solidObstacles; }
    get highlightedZoneIds(): readonly string[] { return Array.from(this.litZones); }

    bind(mapId: string, zoneRoot: Node, highlightEffect?: EffectAsset): void {
        this.mapId = mapId;
        this.zoneRoot = zoneRoot;
        this.authored = undefined;
        this.regions = [];
        this.current = [];
        this.seed = null;
        this.litZones.clear();
        this.releaseDelays.clear();
        this.highlightEffect = highlightEffect;
        this.tutorialPulseActive = false;
    }

    label(id: string, text: string): void {
        const region = this.regions.find(region => region.id === id);
        if (!region) throw new Error(`Unknown battle zone: ${id}`);
        region.renderValue(text);
    }

    layout(board: Node): Zone[] {
        const bounds = RULES;
        this.solidObstacles = this.readObstacles(board);
        if (!this.authored) {
            this.regions = (this.zoneRoot ?? this.node).getComponentsInChildren(BattleZone)
                .filter(region => region.node.activeInHierarchy)
                .sort((a, b) => a.id.localeCompare(b.id));
            if (!this.regions.length) throw new Error(`Battle map has no zones: ${this.mapId || this.node.name}`);
            this.authored = this.regions.map(region => region.read(board));
            if (this.highlightEffect) for (const region of this.regions) region.setHighlightEffect(this.highlightEffect);
        }
        this.seed = this.randomizeZones ? (this.layoutSeed || (Date.now() ^ Math.floor(Math.random() * 0xffffffff))) >>> 0 : null;
        // Authored art may intentionally extend behind the environment frame.
        // Its visual transform and ownership polygon must remain exactly aligned.
        let zones: Zone[];
        if (this.seed === null) {
            zones = authoredZoneLayout(this.authored);
        } else {
            zones = randomZoneLayout(this.authored, bounds, this.seed, this.edgeMargin, this.zoneGap);
            const origin = board.getComponent(UITransform)!;
            for (const zone of zones) {
                const region = this.regions.find(r => r.id === zone.id)!;
                const parent = region.node.parent!.getComponent(UITransform)!;
                const position = parent.convertToNodeSpaceAR(origin.convertToWorldSpaceAR(new Vec3(zone.x, zone.y)));
                region.node.setPosition(position);
            }
        }
        this.current = zones;
        return zones;
    }

    /** Called after token motion so the selected buffer silhouette follows the real centre test. */
    updateHighlights(tokens: readonly HighlightToken[], dt: number): readonly string[] {
        const previous = new Set(this.litZones);
        this.litZones.clear();
        const movingCentres = tokens
            .filter(token => token.launched && token.moving && token.node.isValid)
            .map(token => token.node.position);
        const stoppedCentres = tokens
            .filter(token => token.launched && !token.moving && token.node.isValid)
            .map(token => token.node.position);
        const step = Math.max(0, Math.min(dt, .1));
        for (const zone of this.current) {
            const movingInside = movingCentres.some(point => zoneContains(point, zone));
            const stoppedInside = stoppedCentres.some(point => zoneContains(point, zone));
            let active = movingInside || this.tutorialPulseActive;
            if (movingInside) {
                this.releaseDelays.delete(zone.id);
            } else if (stoppedInside && (previous.has(zone.id) || this.releaseDelays.has(zone.id))) {
                // Keep the completed pass visible for half a second after the base settles.
                const remaining = this.releaseDelays.get(zone.id) ?? SETTLE_HIGHLIGHT_HOLD_SECONDS;
                if (remaining > 0) {
                    active = true;
                    this.releaseDelays.set(zone.id, remaining - step);
                } else {
                    this.releaseDelays.delete(zone.id);
                }
            } else {
                this.releaseDelays.delete(zone.id);
            }
            const region = this.regions.find(candidate => candidate.id === zone.id);
            if (!region) continue;
            region.trackHighlight(active, dt);
            if (active) this.litZones.add(zone.id);
        }
        return this.highlightedZoneIds;
    }

    setTutorialPulse(active: boolean): void {
        this.tutorialPulseActive = active;
        for (const region of this.regions) {
            region.setTutorialPulse(active);
            if (active) this.litZones.add(region.id);
        }
    }

    clearHighlights(): void {
        this.litZones.clear();
        this.releaseDelays.clear();
        for (const region of this.regions) region.clearHighlight();
    }

    private readObstacles(board: Node): CombatObstacle[] {
        const root = this.zoneRoot?.parent ?? this.node;
        const obstacleRoot = root.getChildByName('ObstacleLayer');
        // An empty or absent obstacle layer means this map has no solid props.
        // Falling back to the map root would turn every authored zone sprite into a collider.
        if (!obstacleRoot) return [];
        const boardTransform = board.getComponent(UITransform);
        if (!boardTransform) throw new Error('BattleMap obstacle extraction requires a board UITransform');
        const obstacles: CombatObstacle[] = [];
        const colliders: Collider2D[] = [];
        const visit = (node: Node): void => {
            for (const child of node.children) {
                if (!child.activeInHierarchy) continue;
                const existing = child.getComponents(Collider2D);
                if (existing.length) {
                    for (const collider of existing) {
                        if (collider.group !== 2) collider.group = 2;
                        collider.apply();
                    }
                    colliders.push(...existing);
                } else {
                    // Several authored maps use obstacle art without physics metadata.
                    // Materialize a static circle from the sprite's final UITransform size
                    // so both guide reflection and token collision share one source of truth.
                    const ui = child.getComponent(UITransform), sprite = child.getComponent(Sprite);
                    if (sprite && ui && ui.width > 0 && ui.height > 0) {
                        const collider = child.addComponent(CircleCollider2D);
                        collider.radius = Math.min(ui.width, ui.height) * .45;
                        collider.offset = new Vec2();
                        collider.group = 2;
                        collider.apply();
                        colliders.push(collider);
                    }
                }
                visit(child);
            }
        };
        visit(obstacleRoot);
        for (const collider of colliders) {
            if (!collider.enabledInHierarchy) continue;
            const id = `${collider.node.uuid}:${obstacles.length}`;
            const offset = collider.offset;
            const toBoard = (x: number, y: number): Vec3 => {
                const world = Vec3.transformMat4(new Vec3(), new Vec3(x, y, 0), collider.node.worldMatrix);
                return boardTransform.convertToNodeSpaceAR(world);
            };
            const center = toBoard(offset.x, offset.y);
            if (collider instanceof CircleCollider2D) {
                const edge = toBoard(offset.x + collider.radius, offset.y);
                const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
                if (!(radius > 0) || !Number.isFinite(radius))
                    throw new Error(`Invalid circle obstacle: ${collider.node.name}`);
                obstacles.push({ id, kind: 'circle', x: center.x, y: center.y, radius });
                continue;
            }
            if (!(collider instanceof BoxCollider2D)) continue;
            const xEdge = toBoard(offset.x + collider.size.width * .5, offset.y);
            const yEdge = toBoard(offset.x, offset.y + collider.size.height * .5);
            const axisX = { x: xEdge.x - center.x, y: xEdge.y - center.y };
            const axisY = { x: yEdge.x - center.x, y: yEdge.y - center.y };
            const halfWidth = Math.hypot(axisX.x, axisX.y);
            const halfHeight = Math.hypot(axisY.x, axisY.y);
            if (!(halfWidth > 0) || !(halfHeight > 0) || !Number.isFinite(halfWidth) || !Number.isFinite(halfHeight))
                throw new Error(`Invalid box obstacle: ${collider.node.name}`);
            obstacles.push({ id, kind: 'box', x: center.x, y: center.y, halfWidth, halfHeight,
                angle: Math.atan2(axisX.y, axisX.x) });
        }
        return obstacles;
    }
}
