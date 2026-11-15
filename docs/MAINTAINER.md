# Somnus 维护与发布

## 从哪里改

| 要改的内容 | 入口 |
| --- | --- |
| 会话、布局、设置与模型选择 | `page_design/frontend/`，前端构建输出到 `page_design/web/` |
| 默认 Agent 的提示词、工具循环和上下文 | `ai_assistant/service.py`、`ai_assistant/conversation_context.py` |
| 默认 Agent 的公司模型与 Provider 请求 | `ai_assistant/company_runtime.py`、`ai_assistant/provider_transport.py` |
| Codex、DSH、其他 ACP Agent 的接入与工具桥 | `electron/acp-agents.cjs`、`electron/acp-ipc.cjs`、`electron/acp-mcp.cjs` |
| DSH 插件市场与用户扩展 | `electron/acp-dsh-market.cjs`、`electron/acp-dsh-community.cjs`，本地插件和 Skill 另见 `plugins/`、`ai_assistant/skill_library.py` |
| 公司数据查询和远程授权 | `agent_core/sql_access.py`、`data_gateway/sql_policy.py` |
| 深度分析、波形检测与历史复核 | `deep_analysis/`、`event_detection/` |
| Windows 桌面启动和应用更新 | `electron/main.cjs`、`electron/acp-somnus-updater.cjs`、`build_electron.py` |

默认 Agent 由 Somnus 的 Python 循环调度，可以调用 DeepSeek 模型。Codex 和 DSH 在 Windows 桌面由 Electron 通过 ACP 启动，各自负责推理和执行。Somnus 通过工具桥向符合权限的会话提供业务能力。模型、运行时和工具注册分别管理。

## Windows 本机开发

按 [Electron 构建说明](ELECTRON_MIGRATION.md) 准备依赖并生成前端。运行 `python build_electron.py --dir` 后，双击 `dist/electron/win-unpacked/Somnus.exe`。只更新当前电脑时沿用这个可运行目录。关闭旧窗口后替换应用文件，移动时保留整个目录和独立的用户数据。

桌面启动 `launcher.py` 构建出的本机服务，由同一个回环地址提供工作台、波形页和 API。远程同事的客户端连接 [数据网关](DATA_GATEWAY.md)，迁移时将网关及其私有配置放在能够访问公司数据库和模型服务的主机。深度分析所需的 Docker 随网关主机部署。HTTPS 更新目录只托管发布产物，可与网关独立部署。数据库凭据、模型密钥、网关私钥、访问令牌和用户数据均由各自运行环境保管。

## Windows 签名安装包及应用更新

以下为启用分发时的流程。当前本机版本可手动更新。没有配置更新源的客户端会在「设置 → 通用 → 应用更新」显示未配置。

1. 同时更新 `app_version.py` 和 `electron/package.json` 的版本号。构建前端和本机服务，在干净的 Windows x64 构建机上为 Electron Builder 提供组织的 Authenticode 签名配置。当前构建配置的 `win.signExecutable` 为 `false`。正式发布覆盖为 `true`，并启用 `forceCodeSigning`，让签名缺失时直接失败。签名凭据通过构建环境提供。
2. 用 NSIS 目标构建，通过 Electron Builder 配置 `publish.provider=generic`、`publish.url=https://updates.example.com/somnus/windows/`、`publish.channel=latest`。将示例地址替换为团队可访问的 HTTPS 静态目录。使用 `--publish never` 可在本地生成产物和更新清单。现有 `build_electron.py` 负责常规试用构建，发布时需为 Electron Builder 额外提供上述配置。
3. 校验安装程序的 Authenticode 签名、`resources/app-update.yml` 中预期的签名发布者及生成的 `latest.yml`。先上传签名安装程序和构建生成的 `.blockmap`，最后更新 `latest.yml`。签名后的文件与清单中的名称和 SHA-512 必须一致，签名和生成清单完成后使用原始产物。
4. 首次安装支持更新的签名版时，用可信渠道向同事提供安装程序。之后在单独的 Windows 安装环境中，用较早版本按「检查更新 → 下载更新 → 重启并更新」验证真实升级，并检查原会话和配置还能读取。应用退出时不会自动安装。

客户端更新源按 `SOMNUS_UPDATE_URL`、`%APPDATA%\RespiratoryViewer\somnus-updates.json` 的 `url`、安装包自带 `resources/app-update.yml` 的顺序读取。前两项可用于本机调试或预发布验证。正式用户安装带更新源配置的版本后，默认使用随包地址。
