# Somnus

SomnusNext 是基于 DSH Next Desktop 的 Somnus 桌面工作台，包含多 Agent 会话、公司数据接入、文档、SQL、深度分析与呼吸波形工具。

本目录是完整可编辑源码。当前源码基线尚未发布新安装包；本机已有程序从 `app/Somnus.exe` 或 `启动 SomnusNext.cmd` 打开。`app/` 不属于源码，不同步到 GitHub。

## 从哪里开始修改

| 内容 | 源码位置 |
| --- | --- |
| 桌面主页、文档、工具及原生界面 | `desktop/dsh_next/client/` |
| 桌面启动、IPC、Agent 接入 | `desktop/dsh_next/host/`、`electron/` |
| 共享 React 页面、配置、SQL、分析界面 | `page_design/frontend/src/` |
| Agent 与服务 API | `ai_assistant/`、`agent_core/`、`server/` |
| 波形、事件检测 | `event_detection/`、`server_detection/` |
| 数据接入、深度分析 | `data_gateway/`、`mcp_connectors/`、`deep_analysis/` |

完整目录表见 [SOURCE_MAP.md](SOURCE_MAP.md)。使用 `Somnus-Source.code-workspace` 可按功能浏览源码。

## 修改、检查、合并

每个任务从最新 main 新建分支，通过 PR 检查和审查后才合并。详细步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)。当前工作副本的 `.git` 仍指向旧项目，首次使用 Git 前请按该文档执行独立 Git 修复；全新 clone 不受影响。

```powershell
pnpm --dir page_design/frontend install --frozen-lockfile
python -B tools/source_checks.py
```

检查环境为 Python 3.13、Node.js 24、pnpm 11.25.0；不需要运行程序或构建安装包。源码 CI 检查语法、目录、类型与前端回归，后端和原生桌面改动仍需相应专项验收。

## 构建与运行

[完整构建和发布流程](docs/BUILD_AND_RELEASE.md) 区分源码检查、本机更新、完整程序 staging 与安装包发布。[Next 本机更新命令](desktop/dsh_next/NEXT_BUILD.md) 和 [开发产物位置](docs/DEVELOPMENT_STORAGE.md) 提供细节。

默认构建与备份写入源码目录同级 `SomnusNext-Storage`；可用 `SOMNUS_DEV_STORAGE` 指定源码目录外的位置。当前用户配置、会话等使用 `%APPDATA%/VVFLY/SomnusNext`。新会话默认 Somnus，模型供应商在配置页接入。

`.env`、本地 MCP 配置、用户数据、检测运行结果、依赖、上游 ASAR 和构建产物不进入源码仓库。开发截图保留本机，不默认同步公开仓库。第三方源码、必要图标/字体及其许可证保留。

现有使用说明见 [USER_GUIDE.md](USER_GUIDE.md)，历史发布说明见 [RELEASE_NOTES.md](RELEASE_NOTES.md)。合并 PR 不自动生成或发布安装包。
