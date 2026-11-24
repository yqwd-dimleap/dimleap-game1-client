import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { SeasonRankEntry } from '../../model/season/SeasonState';
import { RankLevelView } from './RankLevelView';
import type { RankLevelAssets } from './RankLevelView';

export interface RankItemAssets {
    avatars: readonly SpriteFrame[];
    top: readonly SpriteFrame[];
    other: SpriteFrame;
    self: SpriteFrame;
    rankLevel: RankLevelAssets;
}

export function rankAvatarId(entry: SeasonRankEntry): number {
    if (Number.isInteger(entry.avatarId) && entry.avatarId! >= 1 && entry.avatarId! <= 8) return entry.avatarId!;
    let hash = 0;
    for (let index = 0; index < entry.playerId.length; index++) hash = (hash * 31 + entry.playerId.charCodeAt(index)) | 0;
    return Math.abs(hash) % 8 + 1;
}

@_decorator.ccclass('RankItemView')
export class RankItemView extends Component {
    private assets?: RankItemAssets;
    private bound = false;
    private background?: Sprite;
    private avatar?: Sprite;
    private nickname?: Label;
    private score?: Label;
    private normalRank?: Node;
    private normalRankLabel?: Label;
    private rankLevel?: RankLevelView;
    private readonly topRanks: (Node | undefined)[] = [];

    initialize(assets: RankItemAssets): void {
        if (!this.bound) {
            const root = this.node.getChildByName('ranking_item');
            this.background = root?.getComponent(Sprite) ?? undefined;
            this.avatar = root?.getChildByName('avatar')?.getComponent(Sprite) ?? undefined;
            this.nickname = root?.getChildByName('nickname')?.getComponent(Label) ?? undefined;
            this.score = root?.getChildByName('score')?.getComponent(Label) ?? undefined;
            this.normalRank = root?.getChildByName('ranking_bg') ?? undefined;
            this.normalRankLabel = this.normalRank?.getChildByName('ranking')?.getComponent(Label) ?? undefined;
            this.rankLevel = root?.getChildByName('RankLevel')?.getComponent(RankLevelView) ?? undefined;
            this.topRanks[0] = root?.getChildByName('ranking_1') ?? undefined;
            this.topRanks[1] = root?.getChildByName('ranking_2') ?? undefined;
            this.topRanks[2] = root?.getChildByName('ranking_3') ?? undefined;
            if (!root || !this.background || !this.avatar || !this.nickname || !this.normalRank ||
                !this.normalRankLabel || !this.rankLevel)
                throw new Error('RankItem requires ranking_item visuals and RankLevelView');
            this.bound = true;
        }
        this.assets = assets;
    }

    render(entry: SeasonRankEntry, isSelf: boolean): void {
        if (!this.bound || !this.assets) throw new Error('Initialize RankItemView before rendering');
        const rank = Math.max(1, Math.floor(entry.rank));
        const top = rank <= 3;
        this.background!.spriteFrame = isSelf
            ? this.assets.self
            : (top ? this.assets.top[rank - 1] ?? this.assets.other : this.assets.other);
        for (let index = 0; index < 3; index++) {
            if (this.topRanks[index]) this.topRanks[index]!.active = rank === index + 1;
        }
        this.normalRank!.active = !top;
        this.normalRankLabel!.string = String(rank);
        this.nickname!.string = entry.nickname;
        if (this.score) this.score.string = `${entry.netStars} 星`;
        this.rankLevel!.render(entry.netStars, this.assets.rankLevel);
        const avatar = this.assets.avatars[rankAvatarId(entry) - 1];
        if (avatar) this.avatar!.spriteFrame = avatar;
    }
}
