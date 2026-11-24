import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { playerRank } from '../../model/player/PlayerRank';

export interface RankLevelAssets {
    badges: readonly SpriteFrame[];
    titleBackgrounds: readonly SpriteFrame[];
}

@_decorator.ccclass('RankLevelView')
export class RankLevelView extends Component {
    private bound = false;
    private levelSprite?: Sprite;
    private titleBackground?: Sprite;
    private titleLabel?: Label;
    private notKing?: Node;
    private king?: Node;
    private starAmount?: Label;
    private readonly stars: Sprite[] = [];
    private readonly starPositions: Array<{ x: number; y: number; z: number }> = [];

    private bind(): void {
        if (this.bound) return;
        const levelNode = this.node.getChildByName('level_node');
        this.levelSprite = levelNode?.getChildByName('level_sprite')?.getComponent(Sprite) ?? undefined;
        this.titleBackground = levelNode?.getChildByName('title_bg')?.getComponent(Sprite) ?? undefined;
        this.titleLabel = levelNode?.getChildByName('title_bg')?.getChildByName('title')?.getComponent(Label) ?? undefined;
        this.notKing = this.node.getChildByName('Not_King_Star') ?? undefined;
        this.king = this.node.getChildByName('King_Star') ?? undefined;
        this.starAmount = this.king?.getChildByName('star_amount')?.getComponent(Label) ?? undefined;
        for (let index = 1; index <= 5; index++) {
            const star = this.notKing?.getChildByName(`star${index}`)?.getComponent(Sprite);
            if (star) {
                this.stars.push(star);
                this.starPositions.push({ x: star.node.position.x, y: star.node.position.y, z: star.node.position.z });
            }
        }
        if (!this.levelSprite || !this.titleBackground || !this.titleLabel || !this.notKing || !this.king ||
            !this.starAmount || this.stars.length !== 5)
            throw new Error('RankLevel requires level_node, title_bg/title, Not_King_Star, King_Star and five stars');
        this.bound = true;
    }

    render(netStars: number, assets?: RankLevelAssets): void {
        this.bind();
        const rank = playerRank(netStars);
        this.titleLabel!.string = rank.title;
        if (assets) {
            this.levelSprite!.spriteFrame = assets.badges[rank.art - 1] ?? this.levelSprite!.spriteFrame;
            this.titleBackground!.spriteFrame = assets.titleBackgrounds[rank.art - 1] ?? this.titleBackground!.spriteFrame;
        }
        this.notKing!.active = !rank.king;
        this.king!.active = rank.king;
        const firstX = this.starPositions[0].x;
        const lastX = this.starPositions[this.starPositions.length - 1].x;
        const centerX = (firstX + lastX) * .5;
        const spacing = (lastX - firstX) / (this.stars.length - 1);
        this.stars.forEach((star, index) => {
            star.node.active = index < rank.slots;
            star.grayscale = index >= rank.stars;
            if (rank.slots > 0) {
                star.node.setPosition(
                    centerX + (index - (rank.slots - 1) * .5) * spacing,
                    this.starPositions[index].y,
                    this.starPositions[index].z,
                );
            }
        });
        this.starAmount!.string = `x${rank.stars}`;
    }
}
