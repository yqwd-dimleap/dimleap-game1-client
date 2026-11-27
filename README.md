# 符石战场原型

Cocos Creator 3.8.8 / TypeScript / 750×1334 / Box2D。

启动场景为 `assets/scenes/boot.scene`。配置、版本和游客会话准备完成后先进入轻量 `main` 场景，大厅 UI 在首屏背景上异步加载。流程为：大厅 → MatchView → VS → 选卡部署 → 自动战斗 → BattleSettlement。

## Bundle 结构

| Bundle | 交付方式 | 优先级 | 依赖 | 职责 |
| --- | --- | ---: | --- | --- |
| 主包 | 本地主包 | - | - | 启动场景、轻量主场景、全部业务脚本、启动配置/表 |
| `ui_bundle` | 本地分包 | 6 | - | 大厅壳、首页、导航、PlayerInfo、ModalLayer、共享按钮和头像 |
| `settings_ui` | 远程包 | 4 | `ui_bundle` | 玩家设置、头像设置和昵称修改 |
| `heroes_bundle` | 远程包 | 4 | `ui_bundle` | 英雄页 Prefab、英雄肖像与卡牌底图 |
| `battle_runtime` | 本地分包 | 5 | `ui_bundle` | 战斗场景、核心 HUD、匹配/VS、手牌、单位、教程地图、暂停、回合结算与最终结算 |
| `combat_shared` | 远程包 | 4 | `ui_bundle` | 公共战斗底座、兵种批量 Spine 与战斗特效 |
| `combat_heroes` | 远程包 | 4 | `ui_bundle` | 各英雄专属 Spine 与攻击特效 |
| `map_bundle` | 远程包 | 4 | - | 24 张常规地图 Prefab 与地图内部资源 |
| `season_content` | 远程包 | 4 | `ui_bundle` | 赛季页、排行榜、共享段位 Prefab、段位图、军功奖励与领奖动画 |

Bundle 是资源加载边界，不是代码模块。业务脚本统一留在主包 `assets/scripts`，不得在远程包放 `.js`/`.ts`。所有跨包资源通过 `ResourceScope.load(bundle, path, type)` 加载，并由场景、页面或弹窗作用域释放；Prefab 的静态跨包引用必须写入 `assets/resources/config/app.json` 的依赖声明。

Bundle 名称集中定义在 `assets/scripts/core/Bundles.ts`。公共战斗素材与英雄专属素材分别发布到 `combat_shared`、`combat_heroes`，共享段位 Prefab 与段位图统一发布到 `season_content`；远程包可以依赖优先级更高的共享包，但必须保持无环，公共 UI 和设置页只从本地 `ui_bundle` 加载。

远程源目录直接按 Bundle 名称平铺，不额外增加业务分类层：

```text
assets/bundles/remote/
├─ combat_heroes/
├─ combat_shared/
├─ heroes_bundle/
├─ map_bundle/
├─ season_content/
└─ settings_ui/
```

## 性能边界

- 微信主包预算 4 MiB，主包加本地分包预算 20 MiB；`npm run audit:wx` 和 `npm run audit:tt` 会在超出预算、远程包误入本地目录、启动预载异常时失败。
- 启动只预载 `resources`、`main`、`ui_bundle`。新玩家在 LoadingView 阶段按需加载 `battle_runtime` 及其中的教学地图；老玩家不会加载新手引导资源。
- 老玩家的 Loading 会挂到持久 `GlobalUI`，预加载主场景、MainShell、HomeView 和 ModalLayer，并等待 `HomeView` 首屏初始化完成后再隐藏，避免露出只有背景和底部导航的中间状态。
- 老玩家进入匹配时才加载 `battle_runtime`；战斗场景与战斗 UI 从同一 Bundle 获取。
- 战斗展示资源全部随 `battle_runtime` 本地分包加载；进入战斗时一次性准备好暂停、回合结算和最终结算，不再依赖远程战斗展示包。
- 调参和英雄攻击 GM Prefab 存放在不入 Bundle 的 `assets/prefabs/debug`，正式包不会携带这些调试资源。
- 教学结束后只预取英雄/地图 Bundle 配置，以及公共战斗和当前阵容所需的英雄战斗资源；不再预热设置、赛季和全部地图。
- 设置页改为远程 Bundle，在大厅中按操作加载并显示加载状态。
- 抖音构建将 WASM 资源与代码拆入平台子包，主包从接近 4 MiB 降至约 3.22 MiB。
- 英雄页先显示已编排界面和卡片状态，头像、品质底图、详情/上阵弹窗在首帧后并行预热；不再让详情 Prefab 阻塞整个页面入口。
- 军功奖励短按进入领取界面，长按进入奖励详情；未领取、已领取和锁定状态都支持长按。奖励表只展示编号大于 0 的最多 6 个物品；详情卡片保持 0.4 倍，并锚定在对应军功节点上方，领取界面为 1:1。
- 战斗保留 Spine 按纹理/混合模式分页合批、对象池、虚拟列表和单位深度批量重排；移动平台维持 30 FPS，避免无收益的高频逻辑与发热。
- 当前构建显式设置 `skipCompressTexture: true`，所有资源保持原始纹理格式；正式上线前统一验证并启用纹理压缩。
- 正式包必须配置真实 AppID 和 HTTPS CDN。远程资源的下载、缓存、弱网和真机帧率仍需在微信开发者工具及 iOS/Android 真机复测。

## 常用命令

```sh
npm run verify
npm run prepare:wx -- --local
npm run prepare:tt -- --local
npm run audit:wx
npm run audit:tt
npm run stage:wx
npm run stage:tt
```

本地试构建使用 `--local`。正式构建前必须在 `config/release.json` 填写真实 AppID，并在 `assets/resources/config/app.json` 的 `remoteBaseUrl` 中填写微信/抖音 HTTPS CDN；缺少任一项时构建与发布暂存会直接失败。

编辑器 Game View 与浏览器预览会自动改用 `app.json` 的 `devApiBaseUrl`（默认 `http://127.0.0.1:3000/api/v1`），真机构建和小游戏包始终使用 `apiBaseUrl`。预览需要连正式服时把 `devApiBaseUrl` 置空；该字段只接受 `127.0.0.1`/`localhost` 的 HTTP 地址。

## 远程资源版本目录

远程包使用不可变版本目录，禁止用新构建覆盖线上同名目录。CDN 结构如下：

```text
<cdn-root>/
├─ config/remote_version.json
├─ remote_v1.0.0/remote/<bundle>/
├─ remote_v1.0.1/remote/<bundle>/
├─ remote_v1.2.0/remote/<bundle>/
└─ remote_v1.3.0/remote/<bundle>/
```

启动时 `RemoteVersionManager` 先拉取 `<platform-remote-base>/config/remote_version.json`，再让每个远程 Bundle 从 `remote_v<version>/remote/<bundle>/` 加载。清单按平台域名分别部署；`app.json` 的 `remoteVersion` 是首次安装、清单不可用且本地没有有效缓存时使用的主包兜底版本。

每次发布新远程资源：

```sh
npm run stage:remote -- 1.3.0 --source build/wechatgame/remote
npm run verify:remote
```

脚本会在 `release/` 生成新的 `remote_v1.3.0/remote/`、发布摘要和 `config/remote_version.json`。它拒绝覆盖已存在的版本目录。先上传整个新版本目录，再最后上传版本清单，避免玩家提前看到半成品。

回滚只改版本清单，不删除或重传远程文件：

```sh
npm run rollback:remote -- 1.0.0
```

上传新的 `config/remote_version.json` 并刷新该 URL 的 CDN 缓存后，玩家下次冷启动会读取旧目录；已经进入游戏的玩家继续使用当前内存中的版本。建议保留最近 2～3 个版本目录。`remote_version.json` 应设置 `Cache-Control: no-cache`，版本目录中的资源可长期缓存；构建必须保持 `md5Cache: true`。微信与抖音后台都需配置 CDN 的 request/downloadFile 合法域名，COS 还需允许远程 Bundle 的跨域读取。

版本清单支持 `bundles` 单独指定某些 Bundle 的目录，也预留了 `next` + `gray_percent` 设备稳定灰度。正常回滚直接修改 `current`，不要依赖 `rollback_to` 长期覆盖。

发布脚本会保留已下线或改名的 Bundle 映射。例如 `combat_content` 拆分为 `combat_shared`、`combat_heroes` 后，清单仍会把旧客户端显式指向旧目录，避免新版本切换导致旧主包 404；`battle_presentation` 合并回本地 `battle_runtime` 后，新版本不再生成该目录，但清单仍让它指向 `remote_v1.2.0`，供尚未更新的旧客户端继续使用。确认旧版本玩家清空后再删除该兼容映射。

`verify` 检查 Bundle 元数据与清单、优先级、依赖方向/循环、跨包静态引用、脚本层依赖、动态资源路径、启动资源边界、远程包禁用脚本、空目录/临时文件和 Prefab 内部 ID。`check-maps` 检查 25 张地图清单、路径、ID 和 Prefab 文件集合是否一致；`check-prefabs` 检查 Prefab JSON、`.meta` 和组件 `fileId` 唯一性。
