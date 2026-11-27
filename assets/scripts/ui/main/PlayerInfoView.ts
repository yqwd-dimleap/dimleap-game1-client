import { _decorator, Button, Component, instantiate, isValid, Label, Node, Prefab, Sprite, SpriteFrame } from 'cc';
import { ViewNodes } from '../binding/ViewNodes';
import type { ResourceLoader } from '../../core/ResourceScope';
import type { PlayerProfile } from '../../model/player/PlayerProfile';
import { playerRank } from '../../model/player/PlayerRank';
import { loadPlayerBadge, PLAYER_RANK_BUNDLE, RANK_LEVEL_PREFAB_PATH } from '../common/PlayerUIAssets';
import { RankLevelAssets, RankLevelView } from '../season/RankLevelView';

@_decorator.ccclass('PlayerInfoView')
export class PlayerInfoView extends Component {
    private bindings?: ViewNodes;
    private revision = 0;
    private artKey = '';
    private rankLevel?: RankLevelView;
    private rankLevelNode?: Node;
    private rankLevelLoading?: Promise<void>;
    private rankAssets?: RankLevelAssets;
    private rankProfile?: Readonly<PlayerProfile>;
    private openSettings?: () => void;
    private readonly clickSettings = (): void => { this.openSettings?.(); };
    /**
     * PlayerInfo has two authored layouts in the project history.  The current
     * compact layout nests nickname/playerID under btn_avatar_frame, while the
     * original layout kept them at the root and also contained rank widgets.
     * Resolve optional paths directly so an art-only prefab update cannot break
     * the whole home page.
     */
    private nodeAt(path: string): Node | undefined { return this.node.getChildByPath(path) ?? undefined; }
    private labelAt(...paths: string[]): Label | undefined {
        for (const path of paths) {
            const label = this.nodeAt(path)?.getComponent(Label);
            if (label) return label;
        }
        return undefined;
    }
    private spriteAt(...paths: string[]): Sprite | undefined {
        for (const path of paths) {
            const sprite = this.nodeAt(path)?.getComponent(Sprite);
            if (sprite) return sprite;
        }
        return undefined;
    }
    private findRankLevel(root: Node): RankLevelView | undefined {
        const direct = root.getComponent(RankLevelView);
        if (direct) return direct;
        for (const child of root.children) {
            const nested = this.findRankLevel(child);
            if (nested) return nested;
        }
        return undefined;
    }
    initialize(openSettings: () => void): void {
        const ui = this.bindings ?? (this.bindings = new ViewNodes(this.node));
        const button = ui.at('btn_avatar_frame', Button).node;
        this.rankLevel = this.findRankLevel(this.node);
        if (this.rankLevel) this.rankLevel.node.active = true;
        button.off(Button.EventType.CLICK, this.clickSettings);
        this.openSettings = openSettings;
        button.on(Button.EventType.CLICK, this.clickSettings);
    }
    dispose(): void {
        // A parent page can be torn down after Cocos has already cleared child
        // component nodes. Cleanup must stay safe in either destruction order.
        const node = this.node;
        if (node && isValid(node, true)) node.getChildByName('btn_avatar_frame')?.off(Button.EventType.CLICK, this.clickSettings);
        this.openSettings = undefined;
        this.bindings = undefined;
        this.rankLevel = undefined;
        if (this.rankLevelNode && isValid(this.rankLevelNode, true)) this.rankLevelNode.destroy();
        this.rankLevelNode = undefined;
        this.rankLevelLoading = undefined;
        this.rankAssets = undefined;
        this.rankProfile = undefined;
    }
    async renderPlayer(profile: Readonly<PlayerProfile>, resources: ResourceLoader): Promise<void> {
        const revision = ++this.revision, rank = playerRank(profile.netStars);
        this.rankProfile = profile;
        const nickname = this.labelAt('nickname', 'btn_avatar_frame/nickname'); if (nickname) nickname.string = profile.nickname;
        const playerId = this.labelAt('playerID', 'btn_avatar_frame/playerID'); if (playerId) playerId.string = `ID:${profile.playerId}`;
        void this.ensureRankLevel(resources);
        const key = `${profile.avatar}:${rank.art}`;
        if (key === this.artKey) return;
        const [avatar, badge, title] = await loadPlayerBadge(resources, profile.avatar, rank.art);
        if (!isValid(this, true) || revision !== this.revision) return;
        const avatarSprite = this.spriteAt('avatar'); if (avatarSprite) avatarSprite.spriteFrame = avatar;
        const badges: SpriteFrame[] = [];
        const titleBackgrounds: SpriteFrame[] = [];
        badges[rank.art - 1] = badge;
        titleBackgrounds[rank.art - 1] = title;
        this.rankAssets = { badges, titleBackgrounds };
        this.rankLevel?.render(profile.netStars, this.rankAssets);
        this.artKey = key;
    }
    private ensureRankLevel(resources: ResourceLoader): Promise<void> {
        if (this.rankLevel && isValid(this.rankLevel, true)) return Promise.resolve();
        if (this.rankLevelLoading) return this.rankLevelLoading;
        const task = (async () => {
            const prefab = await resources.load(PLAYER_RANK_BUNDLE, RANK_LEVEL_PREFAB_PATH, Prefab);
            if (!isValid(this, true)) return;
            const node = instantiate(prefab);
            node.name = 'RankLevel';
            this.setLayer(node, this.node.layer);
            node.setParent(this.node);
            node.setPosition(0, -10, 0);
            node.setScale(0.8, 0.8, 1);
            const view = node.getComponent(RankLevelView);
            if (!view) {
                node.destroy();
                throw new Error('RankLevel prefab requires RankLevelView');
            }
            this.rankLevelNode = node;
            this.rankLevel = view;
            if (this.rankProfile) view.render(this.rankProfile.netStars, this.rankAssets);
        })();
        this.rankLevelLoading = task;
        const clear = (): void => { if (this.rankLevelLoading === task) this.rankLevelLoading = undefined; };
        void task.then(clear, clear);
        return task;
    }
    private setLayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) this.setLayer(child, layer);
    }
    onDestroy(): void { this.revision++; this.dispose(); }
}
