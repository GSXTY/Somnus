# 用户运营总览接口约定（v2）

此文件是主 agent 与页面/检测 agent 的本轮协作接口。数据库尚未确定，先实现只读数据源适配层；默认未接数据库，不用 CSV 跨度推算用户数或使用时间。

## 总览

`GET /api/dashboard?source=live|demo&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`。日期为含首含尾的 Asia/Shanghai 自然日，默认最近 30 天，最多 366 天。`source=live` 当前返回未连接；`source=demo` 返回明确标记的演示数据。无效日期/来源返回 400。

```json
{
  "schema_version": 2,
  "scope": "users",
  "source": {"mode": "unconfigured", "connected": false, "label": "未连接数据库"},
  "period": {"start_date": "2026-10-11", "end_date": "2026-11-09", "timezone": "Asia/Shanghai"},
  "metrics": {"total_users": null, "new_users": null, "active_users": null, "avg_daily_usage_minutes": null, "total_usage_minutes": null, "active_user_days": null},
  "daily": [],
  "users": [],
  "definitions": {},
  "warnings": ["尚未连接用户数据库。"]
}
```

连接后或演示模式的 daily 元素：`{date,new_users,active_users,usage_minutes,avg_daily_usage_minutes}`。users 元素：`{user_id,display_name,registered_at,usage_minutes,active_days,avg_daily_usage_minutes,recordings_available:false}`。当前 users 是本次结果的用户汇总，仅供演示/后续数据接口设计，不承诺真实数据库分页能力。无活动的平均值为 null，不能显示为 0 分钟。

口径：total_users 为截止结束日的去重注册用户；new_users 为所选日期内注册用户；active_users 为范围内有有效实际使用区间的去重用户；active_user_days 为每天活跃用户数之和；avg_daily_usage_minutes = total_usage_minutes / active_user_days。同一用户的重叠使用区间合并，跨午夜按上海日期拆分，范围外部分裁剪。不使用波形 CSV 首尾跨度替代真实使用区间。数据库适配器必须提供用户标识、注册时间以及实际使用开始/结束时间，时间带偏移或先经过明确的时区转换。

默认未连接返回 null 而非伪造零值；演示 source.mode=demo、connected=false，所有用户和趋势均为合成，页面必须持续显示演示标识。

## 检测模块

原本地文件汇总调整为 `GET /api/recording-overview`，继续返回原 files / summary / current_recording 结构，仅供单份数据检测工作区使用，不能混入用户运营总览。主 agent 负责后端改路由和更新 tests/test_dashboard.py，检测 agent 不要修改该服务文件或测试文件。

`/events` 仍为单份本地 CSV 的独立检测工具。当前无真实用户与文件关联，不能仅根据 URL 的 user_id 宣称已选定某用户数据。检测页面需明确当前目标是所打开记录，未关联数据库用户。总览用户列表可展示“记录待接入”，不要启用无真实数据映射的用户检测按钮。现有本地文件入口可直接使用。

## 文件归属

- 页面 agent：page_design/ 下总览 HTML/JS/CSS、页面测试 tests/test_user_dashboard.cjs；保持现有本地 Bootstrap 资源和事件页面样式资源。
- 检测 agent：仅 event_detection/index.html 的模块定位/目标提示（保留 ID）、event_detection/README.md、docs/EVENT_DETECTION_MODULE.md；不调整算法，不改 viewer.py/viewer.js，不改 page_design/。
- 主 agent：agent_core/ 数据层、event_detection/viewer.py 的 HTTP 集成、根目录启动/打包、tests/test_dashboard.py 与运营统计测试、总体设计文档。

所有 agent 均须保留现有用户改动，不覆盖其他 agent 的文件。数据库未定不安装数据库驱动，不添加真实连接凭据。
