import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame, UITransform, isValid, sp } from 'cc';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import type { ResourceLoader } from '../../../core/ResourceScope';
import type { PlayerProfile } from '../../../model/player/PlayerProfile';
import { playerRank } from '../../../model/player/PlayerRank';
import { loadPlayerBadge } from '../../../ui/common/PlayerUIAssets';
import { RankLevelView } from '../../../ui/season/RankLevelView';
@_decorator.ccclass('BattleSettlementView')
export class BattleSettlementView extends Component {
    private ui?: ViewNodes;
    private back?: () => void;
    private backNode?: Node;
    private detail?: Label;
    private data?: sp.SkeletonData;
    private playRequest = 0;
    private playerRevision = 0;
    private playerArtKey = '';
    private rankLevel?: RankLevelView;
    initialize(data: sp.SkeletonData, victoryArt: SpriteFrame, failureArt: SpriteFrame): void {
        const ui = this.ui ?? (this.ui = new ViewNodes(this.node));
        this.data = data;
        ui.at('ani', sp.Skeleton).skeletonData = data;
        ui.at('bg/victory_icon', Sprite).spriteFrame = victoryArt;
        ui.at('bg/fail_icon', Sprite).spriteFrame = failureArt;
        this.detail = this.node.getChildByPath('Detail')?.getComponent(Label) ?? this.createDetailLabel();
        this.rankLevel = this.node.getChildByPath('player_node/RankLevel')?.getComponent(RankLevelView) ?? undefined;
    }
    show(winner: 0 | 1 | 'draw', detail: string, player: Readonly<PlayerProfile>,
        resources: ResourceLoader, back: () => void): void {
        const ui = this.ui ?? (this.ui = new ViewNodes(this.node));
        this.node.active = true;
        // The refreshed prefab keeps both result icons authored, but the Spine node
        // starts disabled so it does not render while the prefab is being assembled.
        // Treat a draw as the non-victory result until a dedicated draw asset exists.
        ui.path('bg/victory_icon').active = winner === 0;
        ui.path('bg/fail_icon').active = winner !== 0;
        const detailLabel = this.detail ?? (this.detail = this.node.getChildByPath('Detail')?.getComponent(Label) ?? this.createDetailLabel());
        if (detailLabel) detailLabel.string = (winner === 'draw' ? '平局\n' : '') + detail;
        this.renderPlayer(player, resources);
        const spine = ui.at('ani', sp.Skeleton);
        this.playSpine(spine, winner === 0 ? 'shengli' : 'shibai');
        this.unbindBack(); this.back = back; this.backNode = ui.path('btn_back'); this.backNode.on(Button.EventType.CLICK, back);
    }
    private renderPlayer(player: Readonly<PlayerProfile>, resources: ResourceLoader): void {
        const revision = ++this.playerRevision, rank = playerRank(player.netStars);
        const nickname = this.node.getChildByPath('player_node/avatar_frame/nickname')?.getComponent(Label);
        if (nickname) nickname.string = player.nickname;
        const playerId = this.node.getChildByPath('player_node/avatar_frame/playerID')?.getComponent(Label);
        if (playerId) playerId.string = `ID:${player.playerId}`;
        this.rankLevel?.render(player.netStars);
        const key = `${player.avatar}:${rank.art}`;
        if (key === this.playerArtKey) return;
        void loadPlayerBadge(resources, player.avatar, rank.art).then(([avatar, badge, title]) => {
            if (!isValid(this, true) || revision !== this.playerRevision) return;
            const avatarSprite = this.node.getChildByPath('player_node/avatar')?.getComponent(Sprite);
            if (avatarSprite) avatarSprite.spriteFrame = avatar;
            const levelSprite = this.node.getChildByPath('player_node/RankLevel/level_node/level_sprite')?.getComponent(Sprite);
            if (levelSprite) levelSprite.spriteFrame = badge;
            const titleSprite = this.node.getChildByPath('player_node/RankLevel/level_node/title_bg')?.getComponent(Sprite);
            if (titleSprite) titleSprite.spriteFrame = title;
            this.rankLevel?.render(player.netStars, { badges: [badge], titleBackgrounds: [title] });
            this.playerArtKey = key;
        }).catch(error => {
            if (isValid(this, true) && revision === this.playerRevision)
                console.error('[BattleSettlement] Player badge failed to load', error);
        });
    }
    private playSpine(spine: sp.Skeleton, clip: string): void {
        if (!this.data) {
            console.error('[BattleSettlement] Spine data is not initialized');
            return;
        }
        const request = ++this.playRequest;
        spine.node.layer = this.node.layer;
        spine.node.active = true;
        spine.enabled = true;
        spine.skeletonData = this.data;
        spine.paused = false;
        spine.timeScale = 1;
        spine.setAnimationCacheMode(sp.Skeleton.AnimationCacheMode.REALTIME);
        spine.clearTracks();
        spine.setToSetupPose();
        if (!spine.findAnimation(clip)) {
            console.error(`[BattleSettlement] Spine animation missing: ${clip}`);
            return;
        }
        const entry = spine.setAnimation(0, clip, false);
        if (!entry) {
            // The Skeleton runtime can finish rebuilding on the next frame when the
            // settlement root switches from inactive to active.
            this.scheduleOnce(() => {
                if (request !== this.playRequest || !isValid(this, true) || !this.node.activeInHierarchy) return;
                spine.paused = false;
                spine.setAnimation(0, clip, false);
            });
        }
    }
    private unbindBack(): void {
        if (this.back && isValid(this.backNode, true)) this.backNode!.off(Button.EventType.CLICK, this.back);
        this.back = undefined; this.backNode = undefined;
    }
    onDestroy(): void {
        this.playRequest++; this.playerRevision++;
        this.data = undefined; this.rankLevel = undefined; this.unbindBack();
    }

    /** The refreshed settlement prefab no longer contains the old Detail node. */
    private createDetailLabel(): Label | undefined {
        const parent = this.node.getChildByPath('bg_frame_1');
        if (!parent) return undefined;
        const node = new Node('Detail');
        parent.addChild(node);
        node.setPosition(0, -52, 0);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(460, 54);
        const label = node.addComponent(Label);
        label.fontSize = 22;
        label.lineHeight = 28;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.CLAMP;
        return label;
    }
}
