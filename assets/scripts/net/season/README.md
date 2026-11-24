# 赛季接口占位

后续在此添加 SeasonApi，请求由现有 net/Api 与平台 SDK 执行。
接口至少区分赛季信息、分页排行榜、本人排名和军功奖励领取。
DTO 定义在 net 层，game/season 负责转换成 model/season 数据；net 不导入 UI 或 game。
尚未配置后端，不创建虚假排名、虚假领奖结果或自动网络请求。

GameApp.seasons 为应用级 SeasonStore。真实适配器完成后，通过 configure(source) 返回 SeasonSnapshot（season、entries）接入，不假设服务端路径。
同时请求共用 Promise，成功数据缓存 30 秒，页面淘汰后仍有效；失败后可重试。
切换账号、赛季或领奖成功时应 invalidate，完成对局时已自动 invalidate；旧请求结果不会覆盖新缓存。
默认尚未配置 source，赛季页显示待接入。分页、领奖和头像加载仍待后端接入。
