# 配置入口

Excel 源表位于工程 excel；生成 JSON 位于 `assets/resources/config/game`，作为启动必需数据随主包发布；可选生成 TypeScript 位于 `tools/generated/tables`，不进入运行时构建。生成文件不得手改。

GameApp 在启动界面绘制后并行加载 hero_config、hero_level_config、item_config、ai_difficulty_config、rank_config、season_merit_reward 六张 JSON。GameTables 验证全量数据和关联成功后发布只读快照，随后初始化存档；失败走启动重试，旧快照不会被半份数据替换。临时 ResourceScope 随后释放 JsonAsset 引用，纯数据继续使用。

GameTables 不导入 cc；PrototypeConfig 保留表现元数据，数值通过延迟 getter 读取配置。BattleConfig 为每场战斗生成规则快照。最新表优先于旧原型数值，当前弓兵射程 400，基础攻频 1.0 次/秒。原有攻击动画事件、投射物飞行和命中仍独立驱动。

## 数值单位与存档

- `move_speed_px_s` 统一为真实像素/秒，运行时不再乘以帧率；模拟仍使用 dt，不取决于设备实际帧率。
- `attack_tier` 是攻击节奏的唯一分支：1 为近战，2 为远程；配置校验会拒绝其他值。
- `attack_rate_s` 仅用于近战，单位为次/秒，攻击周期为 `1 / attack_rate_s`；近战动画按该周期缩放并连续执行 attack → attack，不插入 idle。近战行的 `attack_wait_s` 必须为 0。
- `attack_wait_s` 仅用于远程，表示攻击动画结束后的等待时间；远程保持 attack → idle → 等待 → attack，攻击周期为 2/3 秒动画加该等待值。远程行的 `attack_rate_s` 必须为 0。
- 表中不适用的节奏字段写 0，不保留空白；当前导表工具会把空白数字转换成 null，而运行时数据校验只接受数值。
- HP、攻击力按等级表倍率计算；升级金币与英雄碎片按等级表扣除。第 30 行即使 can_upgrade=1，没有第 31 行也不扣费升级。
- 数字英雄 ID 通过 HERO_TABLE_IDS 映射原有字符串 ID，保留旧等级、金币、碎片；模型支持 hero_config 中的全部 19 名英雄，初始上阵和开放状态读取 `initially_unlocked`，其余英雄通过养成界面或测试开放。战斗资源仍在进入战斗或攻击测试时按需加载。
- 本地原型保存累计净星，胜 +1、负 -1（最低 0）、平不变；按 rank_config 决定展示段位与敌方 AI。AI 的敌方等级、瞄准误差、力度误差和增益/撞出权重按表应用。
- item_config 用于碎片关联校验、奖励名称；27 档军功奖励供页面预览。真实排行榜、军功进度与领取仍通过服务适配器接入，客户端不擅自授予奖励。
- 单场金币/碎片奖励暂沿用原型策略，六张表未定义该部分，不冒充表配置。

六张配置 JSON 仅约 23 KB，放在主包 resources 中可避免启动时为了读表先下载整个 UI 子包。修改源 Excel 后重新导出，再运行 npm test、npm run check:boundaries 和 npm run check:prefabs。
