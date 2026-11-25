import { _decorator, Camera, Component, Graphics, instantiate, Node, Prefab } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import { Team } from '../../../model/config/PrototypeConfig';
import { SlingshotView } from './SlingshotView';

/** The world prefab owns its hierarchy; consumers use this component's interface. */
@_decorator.ccclass('BattleWorldView')
export class BattleWorldView extends Component {
    private bindings?: ViewNodes;
    private mapNode?: Node;
    private get ui(): ViewNodes { return this.bindings ??= new ViewNodes(this.node); }
    get board(): Node { return this.ui.path('BoardRoot'); }
    get tokens(): Node { return this.ui.path('BoardRoot/ZoneLayer/Tokens'); }
    get units(): Node { return this.ui.path('BoardRoot/ZoneLayer/Units'); }
    get aim(): Node { return this.ui.path('BoardRoot/ZoneLayer/AimGuide'); }
    get effects(): Node { return this.ui.path('BoardRoot/ZoneLayer/CombatEffects'); }
    get effectsGraphics(): Graphics { return this.ui.at('BoardRoot/ZoneLayer/CombatEffects', Graphics); }
    get camera(): Camera { return this.ui.at('WorldCamera', Camera); }
    slingshot(team: Team): SlingshotView { return this.ui.at(`BoardRoot/ActorLayer/${team === 0 ? 'Blue' : 'Red'}SlingshotEx`, SlingshotView); }
    get mountedMap(): Node | undefined { return this.mapNode; }
    installMap(prefab: Prefab): Node {
        this.mapNode?.destroy();
        const map = instantiate(prefab);
        map.name = 'MapInstance';
        this.setLayer(map, this.board.layer);
        this.board.addChild(map);
        map.setSiblingIndex(0);
        map.setPosition(0, 0, 0);
        this.mapNode = map;
        return map;
    }
    private setLayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) this.setLayer(child, layer);
    }
}
