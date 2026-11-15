# 事件检测模块

对应独立聊天：**事件检测 · 功能维护**。检测 agent 在本目录维护检测算法、波形查看、候选标记、人工复核、批次历史及反馈导出。

- `viewer.py`：原本机服务、CSV 解析与 HTTP 接口。
- `index.html`、`viewer.js`、`annotation-model.js`：检测工作区及标记交互。
- `detector.py`：检测方案调度；各 `dynamic_baseline_*` 等文件保留各方案实现。
- `event_store.py`、`recording_cache.py`、`feedback_export.py`：事件存储、缓存和反馈。
- `signal_analysis.py`：只读证据分析。
- `respiratory_mcp.py`：MCP 实现，通过根目录 `mcp_launcher.py` 启动。

从项目根目录执行 `python launcher.py`，通过 `/events` 进入检测工作区。不要直接执行本目录的 Python 文件；离线脚本使用模块方式，例如 `python -m event_detection.dynamic_baseline_comparison "文件.csv"`。

数据、依赖、事件库仍位于原根目录位置，移动代码不迁移或重建用户数据。代码使用 `event_detection.*` 包导入。页面资源与打包目录保持同一布局，外部网页 API 地址保持不变。

总览界面位于 `../page_design/`，用于全体用户运营指标；本模块仅分析当前打开的 CSV 记录，尚未关联数据库用户。多文件列表用于切换记录，不会合并检测，也不能根据 URL 中的 `user_id` 认定当前文件属于该用户。

未来入口流程为“用户 → 该用户记录 → 选定记录检测”，需先由数据层提供真实的用户与记录映射，再加载选定记录；目前仍直接使用本地 CSV 入口。原本地文件汇总接口调整为 `GET /api/recording-overview`，不作为用户运营统计。`GET /api/dashboard` 的用户运营约定见 [用户统计接口约定](../docs/USER_ANALYTICS_CONTRACT.md)。

跨模块接口由主 agent 协调，验收测试集中于根目录 `tests/`。扫描、候选保存、人工复核、批次历史和反馈导出沿用现有流程；自动候选仍待人工复核，不能输出临床 AHI 或据此调整设备。模块边界与后续接入要求见 [事件检测模块说明](../docs/EVENT_DETECTION_MODULE.md)。
