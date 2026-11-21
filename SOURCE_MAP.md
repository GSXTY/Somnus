# SomnusNext 源码导航

打开根目录 `Somnus-Source.code-workspace` 可编辑完整源码。启动、构建和独立配置说明见 [README.md](README.md)。工作前读取 [AGENTS.md](AGENTS.md)，跨模块变更先约定所有权。

当前 Next 桌面入口由 `desktop/dsh_next/host/standalone-main.mjs` 实现，界面覆盖层在 `desktop/dsh_next/client/`；`page_design/frontend` 提供工作台和配置页。不能仅修改旧版聊天选择器就认为 Next 桌面已更新。

| 目录 | 负责内容 |
| --- | --- |
| `page_design/frontend/src/app` | 应用布局、侧栏、导航、主题与全局样式 |
| `page_design/frontend/src/chat` | 聊天、输入框、群聊、会话管理、文件审阅、右侧文件与终端 |
| `page_design/frontend/src/runtime` | 子会话、Agent 运行状态、轨迹与运行时桥接 |
| `page_design/frontend/src/configuration` | 配置中心、Provider、权限和应用设置 |
| `page_design/frontend/src/dashboard` | 主页、数据指标、SQL 查询 |
| `page_design/frontend/src/documents` | 个人与共享文档库、文档选择与导入 |
| `page_design/frontend/src/plugins` | 插件市场、管理、MCP、Skill 与界面扩展 |
| `page_design/frontend/src/analysis` | 分析、图表、深度分析和工具入口 |
| `page_design/frontend/src/shared` | 公共类型、API、格式化、Markdown 与剪贴板工具 |
| `page_design/frontend/src/assets`、`agent-icons` | 图片与 Agent 图标 |
| `page_design/frontend/src/main.tsx` | 唯一前端启动入口 |
| `electron` | 桌面窗口、托盘、原生接口、ACP 与 DSH 宿主 |
| `ai_assistant`、`agent_core` | Agent 服务、会话持久化、任务与数据查询后端 |
| `event_detection`、`server_detection` | 波形、CSV 与事件检测及检测服务 |
| `data_gateway` | 公司数据网关 |
| `plugins`、`skills` | 仓库内插件与 Skill 内容；不同于插件管理页面 |
| `tests`、`page_design/frontend/tests` | 后端/集成验收与前端回归测试 |
| `tools` | 开发、诊断与验收脚本 |

## 桌面与构建

- `desktop/dsh_next/host/`：Next 启动、配置档案、原生 Host 和 ACP 服务。
- `desktop/dsh_next/client/`：实际 Next 界面覆盖层及模型选择窗口。
- `desktop/dsh_next/upstream/`：本项目固定上游构建输入与 SHA-256 清单。
- `electron/`：工作台共享宿主、预加载、ACP、工作区、文件和终端等模块，仍由 Next 使用。
- `tools/rebuild_next.py`：从本项目固定基线重建覆盖层、同步本机 `app`；加 `--frontend` 更新工作台页面。

## 生成资源与数据

`app/` 是唯一的本机可运行目录，`启动 SomnusNext.cmd` 指向 `app/Somnus.exe`。`page_design/web` 是工作台构建资源，不直接编辑。`node_modules` 等是锁定依赖，不随意清理。真实 CSV/EDF、事件标记、人工复核、历史批次和用户配置属于数据与证据，不作为页面重构的清理对象。

开发缓存和备份默认由路径工具放到同级 `SomnusNext-Storage`；`.git` 正式 gitfile 仍引用已有外置 Git 历史，尚未迁移。见 [开发存储说明](docs/DEVELOPMENT_STORAGE.md)。不要递归跟随目录链接检索依赖或运行产物。

## 验证

先运行 `python -B tools/rebuild_next.py --check` 验证本地构建输入。前端在 `page_design/frontend` 中运行类型检查及对应测试。菜单/宿主测试位于 `desktop/dsh_next/client`、`desktop/dsh_next/host` 与 `electron`。程序资源更改后需构建同步，Python 后端更改还需重新冻结。

历史源码移动映射保留在 [SOURCE_FILE_MOVES.json](docs/SOURCE_FILE_MOVES.json)。清理清单见 [PROJECT_CLEANUP.json](docs/PROJECT_CLEANUP.json)。


## 源码基线与协作

当前源码根目录是 `D:\VVFLY\SomnusNext`；`app/` 是现有运行程序。桌面原生主页、文档、工具入口在 `desktop/dsh_next/client`，共享页面在 `page_design/frontend/src`。开发遵循 [分支与 PR 流程](CONTRIBUTING.md)，打包见 [构建与发布](docs/BUILD_AND_RELEASE.md)。

完整上游源码在 `vendor/dsh-next/`：桌面实现为 `apps/desktop/src`，桌面 Host 为 `apps/desktop-host`，界面插件为 `packages/client`，运行时与工具为其他 `packages` 分组。该目录是固定提交的 Git 子模块；Somnus 的源码适配和构建入口在 `desktop/dsh_next/source-*.mjs`，详见 [完整源码开发](docs/SOURCE_BUILD.md)。
