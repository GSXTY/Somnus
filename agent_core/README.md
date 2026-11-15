# 主 Agent 与用户数据服务

主聊天负责此目录：定义任务范围、统计口径与数据源接口，并整合、验收页面和检测模块。

`analytics.py` 提供数据库无关的用户/实际使用区间模型、只读 `AnalyticsRepository` 协议和统计实现。`dashboard()` 是用户总览服务；默认无适配器时返回未连接及 null 指标，显式 demo 才返回合成数据。生产适配器替换只读 Repository，页面和检测算法不直接访问数据库。

接口实现：`snapshot(start_at, end_at) -> Snapshot(users, sessions)`。users 必须覆盖截止结束日累计用户，sessions 覆盖与范围相交的全部实际使用区间。分页/截断数据不能被当成完整人口；时间必须携带时区。示例与口径见 `../docs/USER_ANALYTICS_CONTRACT.md`。

当前由 `event_detection.viewer` 托管 HTTP 并调用本目录服务，根目录 `launcher.py` 启动；可通过服务对象 `analytics_repository` 注入只读适配器。数据库未定时不安装驱动、不保存凭据，不提供网页上传任意数据库配置的入口。

这里实现的是协调与数据服务基础；通用自然语言任务路由和大模型连接尚未启用。预期任务、角色、数据库接入及用户记录校验边界见 `../docs/AGENT_PLATFORM_PLAN.md`。
