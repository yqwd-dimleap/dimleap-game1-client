import { _decorator, Button, Component, isValid, Label, Sprite, Node } from 'cc';
import { ViewNodes } from '../binding/ViewNodes';
import type { ResourceLoader } from '../../core/ResourceScope';
import type { PlayerProfile } from '../../model/player/PlayerProfile';
import { playerRank } from '../../model/player/PlayerRank';
import { loadPlayerBadge } from '../common/PlayerUIAssets';
import { RankLevelView } from '../season/RankLevelView';

@_decorator.ccclass('PlayerInfoView')
export class PlayerInfoView extends Component {
    private bindings?: ViewNodes;
    private revision = 0;
    private artKey = '';
    private rankLevel?: RankLevelView;
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
    }
    async renderPlayer(profile: Readonly<PlayerProfile>, resources: ResourceLoader): Promise<void> {
        const revision = ++this.revision, rank = playerRank(profile.netStars);
        const nickname = this.labelAt('nickname', 'btn_avatar_frame/nickname'); if (nickname) nickname.string = profile.nickname;
        const playerId = this.labelAt('playerID', 'btn_avatar_frame/playerID'); if (playerId) playerId.string = `ID:${profile.playerId}`;
        if (this.rankLevel) {
            this.rankLevel.render(profile.netStars);
        } else {
            // Compatibility with the old flat RankLevel layout.
            const rankTitle = this.labelAt('level_node/title_bg/title'); if (rankTitle) rankTitle.string = rank.title;
            const notKing = this.nodeAt('Not_King_Star'), king = this.nodeAt('King_Star');
            if (notKing) notKing.active = !rank.king;
            if (king) king.active = rank.king;
            for (let i = 0; i < 5; i++) {
                const star = this.spriteAt(`Not_King_Star/star${i + 1}`);
                if (star) { star.node.active = i < rank.slots; star.grayscale = i >= rank.stars; }
            }
            const starAmount = this.labelAt('King_Star/star_amount'); if (starAmount) starAmount.string = `x${rank.stars}`;
        }
        const key = `${profile.avatar}:${rank.art}`;
        if (key === this.artKey) return;
        const [avatar, badge, title] = await loadPlayerBadge(resources, profile.avatar, rank.art);
        if (!isValid(this, true) || revision !== this.revision) return;
        const avatarSprite = this.spriteAt('avatar'); if (avatarSprite) avatarSprite.spriteFrame = avatar;
        const levelSprite = this.spriteAt('RankLevel/level_node/level_sprite', 'level_node/level_sprite');
        if (levelSprite) levelSprite.spriteFrame = badge;
        const titleSprite = this.spriteAt('RankLevel/level_node/title_bg', 'level_node/title_bg');
        if (titleSprite) titleSprite.spriteFrame = title;
        this.artKey = key;
    }
    onDestroy(): void { this.revision++; this.dispose(); }
}
