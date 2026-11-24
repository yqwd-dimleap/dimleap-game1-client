import { _decorator, Button, Component, instantiate, isValid, Node, Prefab, sp } from 'cc';
import type { MeritReward } from '../../model/config/GameTables';
import { RewardDetailView } from './RewardDetailView';
import { ResourceScope } from '../../core/ResourceScope';
import { BUNDLES } from '../../core/Bundles';

@_decorator.ccclass('GetRewardView')
export class GetRewardView extends Component {
    async initialize(reward: MeritReward, resources: ResourceScope, detailPrefab: Prefab, goldPrefab: Prefab, heroPrefab: Prefab, close: () => void): Promise<void> {
        const back = this.node.getChildByName('btn_back')?.getComponent(Button);
        back?.node.once(Button.EventType.CLICK, close);
        const double = this.node.getChildByName('btn_double')?.getComponent(Button);
        if (double) { double.interactable = false; double.node.off(Button.EventType.CLICK); }
        const host = this.node.getChildByName('RewardHost') ?? new Node('RewardHost');
        host.layer = this.node.layer;
        if (!host.parent) this.node.addChild(host);
        for (const child of [...host.children]) child.destroy();
        const detail = instantiate(detailPrefab);
        host.addChild(detail);
        const view = detail.getComponent(RewardDetailView);
        if (!view) throw new Error('RewardDetail prefab requires RewardDetailView');
        await view.initialize(reward, resources, goldPrefab, heroPrefab, 'reward');
        detail.setPosition(0, 0, 0);
        const animation = resources.load(BUNDLES.seasonContent, 'ui/animations/gongxihuode/UI_gongxihuode', sp.SkeletonData).then(data => {
            if (!isValid(this, true)) return;
            const skeleton = this.node.getChildByName('reward_ani')?.getComponent(sp.Skeleton);
            if (!skeleton) return;
            skeleton.skeletonData = data;
            skeleton.clearTracks();
            skeleton.setCompleteListener(entry => {
                if (entry.animation?.name === 'born' && isValid(skeleton, true)) skeleton.setAnimation(0, 'idle', true);
            });
            skeleton.setAnimation(0, 'born', false);
        }).catch(error => {
            if (isValid(this, true)) console.warn('[Reward] optional animation unavailable:', error);
        });
        await animation;
    }
}
