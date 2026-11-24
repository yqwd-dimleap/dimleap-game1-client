import { Camera } from 'cc';
import { CameraStage, FramingTrack, framingHeight } from '../../../model/battle/BattleFraming';

/** Only the world camera moves. Physics and screen HUD keep their own coordinates. */
export class BattleCamera {
    readonly track = new FramingTrack();
    constructor(readonly camera: Camera) { this.frame('overview', 0); }
    get moving(): boolean { return this.track.moving; }
    frame(stage: CameraStage, duration = 0.48): void { this.track.frame(stage, duration); this.apply(); }
    update(dt: number): void { this.track.update(dt); this.apply(); }
    private apply(): void {
        const p = this.track.pose;
        this.camera.node.setPosition(p.x, p.y, 1000); this.camera.orthoHeight = framingHeight(p.height, this.camera.camera?.aspect ?? 750 / 1334);
    }
    snapshot(): object { return { stage: this.track.stage, moving: this.moving, ...this.track.pose, actualHeight: this.camera.orthoHeight }; }
}
