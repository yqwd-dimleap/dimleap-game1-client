import { Node, sp, sys, UITransform } from 'cc';
import { CombatModel, UnitState } from '../../../model/battle/CombatModel';
import { LabSettings } from '../../../model/battle/CombatLab';
import { TroopAssets } from './TroopAssets';
import { TroopSpineView } from './TroopSpineView';
import { UnitView } from './UnitView';

/** Test armies use two nodes per unit and a bounded pool. Authored combat prefabs remain editable. */
export class LabArmyView {
    private active = new Map<number, { view: UnitView; key: string }>();
    private free = new Map<string, UnitView[]>();
    private freeCount = 0;
    private poolRoot: Node;
    private bands = new Map<number, Node[]>();
    private sortTime = -1;
    private syncedTime = -1;
    private syncedSpeed = -1;
    private settings!: LabSettings;
    constructor(private root: Node, private assets: TroopAssets) {
        this.poolRoot = new Node('LabPool'); this.poolRoot.active = false; root.addChild(this.poolRoot);
    }
    prepare(settings: LabSettings): void {
        this.clear();
        // Changing render mode must not retain hundreds of incompatible pooled Skeletons.
        for (const [key, pool] of this.free) if (!key.endsWith(`:${settings.cached}:${settings.batch}`)) {
            for (const view of pool) view.node.destroy();
            this.freeCount -= pool.length; this.free.delete(key);
        }
        this.settings = settings; this.root.setScale(1, 1, 1);
    }
    add(unit: UnitState): void {
        const key = `${unit.hero}:${this.settings.cached}:${this.settings.batch}`;
        let view = this.free.get(key)?.pop();
        if (view) this.freeCount--;
        else {
            const node = new Node('LabUnit'); node.layer = this.root.layer; node.addComponent(UITransform);
            view = node.addComponent(UnitView);
            const visual = new Node('SpineVisual'); visual.layer = this.root.layer; node.addChild(visual);
            visual.addComponent(UITransform); visual.addComponent(sp.Skeleton);
            visual.addComponent(TroopSpineView);
        }
        view.node.active = false; this.root.addChild(view.node);
        view.configure(unit, this.assets, this.settings.cached, this.settings.batch, false);
        view.node.active = true;
        view.sync(unit, 0, 0);
        this.active.set(unit.id, { view, key });
    }
    sync(model: CombatModel, speed: number, elapsed = model.elapsed): void {
        if (this.syncedTime === elapsed && this.syncedSpeed === speed) return;
        this.syncedTime = elapsed; this.syncedSpeed = speed;
        for (const unit of model.units) this.active.get(unit.id)?.view.sync(unit, speed, elapsed);
        if (model.elapsed - this.sortTime < .1) return;
        this.sortTime = model.elapsed;
        if (!this.settings.grouped) { UnitView.sortByDepth(Array.from(this.active.values(), item => item.view), !sys.isNative); return; }
        let added = false;
        for (const unit of model.units) {
            if (unit.hp <= 0) continue;
            const view = this.active.get(unit.id)?.view; if (!view) continue;
            const band = Math.floor(unit.y / 48);
            let parents = this.bands.get(band);
            if (!parents) {
                const row = new Node(`Depth_${band}`); row.layer = this.root.layer; this.root.addChild(row);
                parents = [new Node('Blue'), new Node('Red')];
                for (const node of parents) { node.layer = this.root.layer; row.addChild(node); }
                this.bands.set(band, parents); added = true;
            }
            if (view.node.parent !== parents[unit.team]) view.node.setParent(parents[unit.team]);
        }
        if (added) [...this.bands.entries()].sort((a, b) => b[0] - a[0]).forEach(([, parents], i) => parents[0].parent!.setSiblingIndex(i));
    }
    clear(): void {
        for (const { view, key } of this.active.values()) {
            if (this.freeCount < 512) {
                view.node.active = false; view.node.setParent(this.poolRoot);
                let pool = this.free.get(key); if (!pool) { pool = []; this.free.set(key, pool); }
                pool.push(view); this.freeCount++;
            } else view.node.destroy();
        }
        this.active.clear();
        for (const parents of this.bands.values()) parents[0].parent!.destroy();
        this.bands.clear(); this.sortTime = this.syncedTime = this.syncedSpeed = -1; this.root.setScale(1, 1, 1);
    }
    metrics(): { active: number; pooled: number } { return { active: this.active.size, pooled: this.freeCount }; }
    destroy(): void {
        // Scene children may already be destroyed when the controller's onDestroy runs.
        // Teardown releases references; it must never reparent/reset a dying hierarchy.
        for (const { view } of this.active.values()) if (view.node?.isValid) view.node.destroy();
        for (const pool of this.free.values()) for (const view of pool) if (view.node?.isValid) view.node.destroy();
        for (const parents of this.bands.values()) if (parents[0].parent?.isValid) parents[0].parent.destroy();
        if (this.poolRoot.isValid) this.poolRoot.destroy();
        this.active.clear(); this.free.clear(); this.bands.clear(); this.freeCount = 0;
    }
}
