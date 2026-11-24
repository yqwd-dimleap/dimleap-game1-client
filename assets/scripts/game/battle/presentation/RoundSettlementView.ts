import { _decorator, Component, instantiate, isValid, Node, SpriteFrame, sp, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import type { BattleMatch } from '../../../model/battle/BattleMatch';
import { livesBeforeRound, type RoundWinner } from '../../../model/battle/BattleSeries';
import type { Team } from '../../../model/battle/types';
import { ViewNodes } from '../../../ui/binding/ViewNodes';
import { PlayerBadgeView } from './PlayerBadgeView';

const { ccclass } = _decorator;

@ccclass('RoundSettlementView')
export class RoundSettlementView extends Component {
    private static readonly ARROW_COUNT = 6;
    private static readonly ARROW_INTERVAL = .18;
    private static readonly ARROW_FLIGHT = 1.1;
    private ui?: ViewNodes;
    private playRequest = 0;
    private readonly playerHome = new Map<Node, Vec3>();
    private readonly arrowClones: Node[] = [];
    private get nodes(): ViewNodes { return this.ui ?? (this.ui = new ViewNodes(this.node)); }

    initialize(): void {
        this.ui = new ViewNodes(this.node);
        for (const path of ['BluePlayer2', 'RedPlayer2']) {
            const node = this.nodes.path(path);
            this.playerHome.set(node, node.position.clone());
        }
        this.nodes.path('red_arrow').active = false;
        this.nodes.path('blue_arrow').active = false;
        this.node.active = false;
    }

    async play(winner: RoundWinner, match: BattleMatch, avatars: readonly SpriteFrame[],
        lives: readonly [number, number]): Promise<void> {
        const request = ++this.playRequest;
        this.node.active = true;
        this.clearArrows();
        await this.nextFrame();
        if (request !== this.playRequest || !isValid(this, true)) return;

        const blue = this.nodes.path('BluePlayer2');
        const red = this.nodes.path('RedPlayer2');
        const blueHome = this.playerHome.get(blue)!;
        const redHome = this.playerHome.get(red)!;
        blue.setPosition(blueHome); red.setPosition(redHome);
        this.nodes.path('red_arrow').active = false;
        this.nodes.path('blue_arrow').active = false;

        this.nodes.at('BluePlayer2', PlayerBadgeView).render(match.blue, avatars[match.blue.avatar - 1]);
        this.nodes.at('RedPlayer2', PlayerBadgeView).render(match.red, avatars[match.red.avatar - 1]);
        this.prepareRoundIcons(livesBeforeRound(lives, winner), winner, 1);

        const background = this.nodes.at('background_ani', sp.Skeleton);
        background.node.active = true;
        background.setAnimationCacheMode(sp.Skeleton.AnimationCacheMode.REALTIME);
        await this.playClip(background, 'di_1', false);
        if (request !== this.playRequest || !isValid(this, true)) return;
        background.setAnimation(0, 'di_2', true);

        await Promise.all([
            this.move(blue, new Vec3(0, -400, 0), .5),
            this.move(red, new Vec3(0, 400, 0), .5),
        ]);
        if (request !== this.playRequest || !isValid(this, true)) return;

        if (winner !== 'draw') {
            const volley = this.fireWinnerVolley(winner);
            const hit = this.playWinnerHit(winner);
            await Promise.all([volley, hit]);
            if (request !== this.playRequest || !isValid(this, true)) return;
        } else {
            await this.wait(.6);
        }

        await Promise.all([
            this.move(blue, blueHome, .5),
            this.move(red, redHome, .5),
        ]);
        if (request !== this.playRequest || !isValid(this, true)) return;
        await this.playClip(background, 'di_3', false);
        if (request !== this.playRequest || !isValid(this, true)) return;
        this.clearArrows();
        this.node.active = false;
    }

    hide(): void {
        this.playRequest++;
        this.clearArrows();
        this.node.active = false;
    }

    onDestroy(): void {
        this.playRequest++;
        this.clearArrows();
        this.playerHome.clear();
        this.ui = undefined;
    }

    private prepareRoundIcons(lives: readonly [number, number], winner: RoundWinner, targetRound: number): void {
        for (const [team, player, skin] of [[0, 'BluePlayer2', 'lan'], [1, 'RedPlayer2', 'hong']] as const) {
            for (const index of [1, 2]) {
                const icon = this.nodes.at(`${player}/ani_round_${index}`, sp.Skeleton);
                const target = winner !== 'draw' && winner !== team && index === targetRound;
                icon.node.active = lives[team] >= index || target;
                if (!icon.node.active) continue;
                icon.setSkin(skin);
                icon.setAnimation(0, 'idle', true);
            }
        }
    }

    private async fireWinnerVolley(winner: Team): Promise<void> {
        const request = this.playRequest;
        const winnerPlayer = winner === 0 ? 'BluePlayer2' : 'RedPlayer2';
        const loserPlayer = winner === 0 ? 'RedPlayer2' : 'BluePlayer2';
        const arrowName = winner === 0 ? 'blue_arrow' : 'red_arrow';
        const source = this.localPosition(this.nodes.path(`${winnerPlayer}/avatar_sprite`));
        const target = this.localPosition(this.nodes.path(`${loserPlayer}/ani_round_1`));
        const template = this.nodes.path(arrowName);
        const flights: Promise<void>[] = [];
        for (let index = 0; index < RoundSettlementView.ARROW_COUNT; index++) {
            if (index > 0) await this.wait(RoundSettlementView.ARROW_INTERVAL);
            if (request !== this.playRequest || !isValid(this, true)) return;
            const lane = index - (RoundSettlementView.ARROW_COUNT - 1) / 2;
            const node = instantiate(template);
            this.node.addChild(node);
            this.setLayer(node, this.node.layer);
            const start = new Vec3(source.x + lane * 34, source.y - Math.abs(lane) * 11);
            const dx = target.x - start.x;
            const dy = target.y - start.y;
            const length = Math.max(1, Math.hypot(dx, dy));
            const bend = lane === 0 ? (index % 2 === 0 ? 42 : -42) : lane * 40;
            const control = new Vec3(
                (start.x + target.x) / 2 - dy / length * bend,
                (start.y + target.y) / 2 + dx / length * bend,
            );
            const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
            node.angle = this.bezierAngle(start, control, target, 0);
            node.setPosition(start);
            node.setScale(.22, .22, 1);
            opacity.opacity = 0;
            node.active = true;
            this.arrowClones.push(node);
            flights.push(new Promise<void>(resolve => {
                const progress = { value: 0 };
                Tween.stopAllByTarget(progress);
                tween(progress).to(RoundSettlementView.ARROW_FLIGHT, { value: 1 }, {
                    easing: 'sineIn',
                    onUpdate: () => {
                        if (!isValid(node, true) || request !== this.playRequest) return;
                        node.setPosition(this.bezierPoint(start, control, target, progress.value));
                        node.angle = this.bezierAngle(start, control, target, progress.value);
                        this.applyArrowVisual(node, opacity, progress.value);
                    },
                }).call(() => {
                    if (isValid(node, true)) {
                        node.active = false;
                        node.destroy();
                    }
                    const arrowIndex = this.arrowClones.indexOf(node);
                    if (arrowIndex >= 0) this.arrowClones.splice(arrowIndex, 1);
                    resolve();
                }).start();
            }));
        }
        await Promise.all(flights);
    }

    private async playWinnerHit(winner: Team): Promise<void> {
        const request = this.playRequest;
        await this.wait(RoundSettlementView.ARROW_FLIGHT);
        if (request !== this.playRequest || !isValid(this, true)) return;
        const loserPlayer = winner === 0 ? 'RedPlayer2' : 'BluePlayer2';
        const skin = winner === 0 ? 'hong' : 'lan';
        const hit = this.nodes.at(`${loserPlayer}/ani_round_1`, sp.Skeleton);
        hit.node.active = true;
        hit.setSkin(skin);
        hit.paused = false;
        hit.timeScale = 1;
        hit.clearTracks();
        hit.setToSetupPose();
        hit.setAnimation(0, 'idle', true);
        await this.nextFrame();
        if (request !== this.playRequest || !isValid(this, true)) return;
        await this.playClipOnce(hit, 'hit');
        if (request !== this.playRequest || !isValid(this, true)) return;
        hit.setAnimation(0, 'idle2', true);
        await this.wait(.25);
    }

    private applyArrowVisual(node: Node, opacity: UIOpacity, t: number): void {
        const fadeIn = Math.min(1, t / .16);
        const fadeOut = Math.min(1, (1 - t) / .18);
        opacity.opacity = Math.round(255 * Math.min(fadeIn, fadeOut));

        const grow = 1 - Math.pow(1 - Math.min(1, t / .34), 3);
        const shrinkProgress = Math.max(0, (t - .66) / .34);
        const scale = (.22 + .98 * grow) * (1 - .82 * shrinkProgress * shrinkProgress);
        node.setScale(scale, scale, 1);
    }

    private bezierPoint(start: Vec3, control: Vec3, target: Vec3, t: number): Vec3 {
        const inverse = 1 - t;
        return new Vec3(
            inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * target.x,
            inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * target.y,
        );
    }

    private bezierAngle(start: Vec3, control: Vec3, target: Vec3, t: number): number {
        const dx = 2 * (1 - t) * (control.x - start.x) + 2 * t * (target.x - control.x);
        const dy = 2 * (1 - t) * (control.y - start.y) + 2 * t * (target.y - control.y);
        return Math.atan2(dy, dx) * 180 / Math.PI;
    }

    private playClip(skeleton: sp.Skeleton, clip: string, loop: boolean): Promise<void> {
        const duration = skeleton.skeletonData?.getRuntimeData()?.findAnimation(clip)?.duration ?? 0;
        skeleton.paused = false;
        skeleton.timeScale = 1;
        skeleton.clearTracks();
        skeleton.setToSetupPose();
        if (!skeleton.findAnimation(clip)) throw new Error(`RoundSettlement missing animation: ${clip}`);
        skeleton.setAnimation(0, clip, loop);
        return loop ? Promise.resolve() : this.wait(duration);
    }

    private playClipOnce(skeleton: sp.Skeleton, clip: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!skeleton.skeletonData?.getRuntimeData()?.findAnimation(clip)) {
                reject(new Error(`RoundSettlement missing animation: ${clip}`));
                return;
            }
            let settled = false;
            const finish = (): void => {
                if (settled) return;
                settled = true;
                skeleton.setCompleteListener(() => {});
                resolve();
            };
            skeleton.setCompleteListener(entry => {
                if (entry.animation?.name === clip) finish();
            });
            skeleton.setAnimation(0, clip, false);
        });
    }

    private move(node: Node, position: Vec3, seconds: number): Promise<void> {
        return new Promise<void>(resolve => {
            Tween.stopAllByTarget(node);
            tween(node).to(seconds, { position }, { easing: 'sineInOut' }).call(() => resolve()).start();
        });
    }

    private localPosition(node: Node): Vec3 {
        return this.node.getComponent(UITransform)!.convertToNodeSpaceAR(node.worldPosition);
    }

    private wait(seconds: number): Promise<void> {
        return new Promise<void>(resolve => {
            if (seconds <= 0) resolve();
            else this.scheduleOnce(resolve, seconds);
        });
    }

    private nextFrame(): Promise<void> {
        return new Promise<void>(resolve => this.scheduleOnce(resolve, 0));
    }

    private clearArrows(): void {
        for (const node of this.arrowClones.splice(0)) if (isValid(node, true)) {
            Tween.stopAllByTarget(node); node.destroy();
        }
    }

    private setLayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) this.setLayer(child, layer);
    }
}
