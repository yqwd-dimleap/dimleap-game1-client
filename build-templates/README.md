# 构建模板预留

双端目前使用 Creator 3.8.8 自带模板。项目没有覆盖 `game.js`、`game.json` 或引擎适配器。
`subpackages` 由 Asset Bundle 构建配置生成；手写空数组覆盖会破坏分包。

确有模板差异时，再在 `wechatgame/` 或 `bytedance-mini-game/` 添加最小覆盖文件。
平台启动/前后台事件优先通过 Cocos 和 `scripts/sdk/` 收口，不复制两套业务代码。
