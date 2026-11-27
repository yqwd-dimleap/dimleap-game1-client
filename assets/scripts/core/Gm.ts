import { DEBUG } from 'cc/env';

/**
 * GM 总开关（唯一开关，默认关闭）。
 *
 * false：战斗 HUD 的「红/蓝方胜利」、碰撞调参面板、英雄攻击测试面板、英雄页 GM 按钮
 *        全部隐藏，表现与正式包一致。
 * true ：仅在 DEBUG（编辑器预览 / 调试构建）下生效；正式包 DEBUG 为 false，恒为关闭。
 * 调参 Prefab 位于 assets/prefabs/debug，不进入正式资源包；启用 GM 时需另行提供调试 Bundle。
 */
export const GM_ENABLED = false;

/** 所有 GM 入口统一用它判断可见性，避免各处散落的 DEBUG 判断。 */
export const GM_VISIBLE = GM_ENABLED && DEBUG;
