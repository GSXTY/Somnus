# Somnus v0.3.0-beta.9

Windows x64 桌面试用版。请在[发布页](https://github.com/GSXTY/Somnus-Releases/releases/tag/v0.3.0-beta.9)下载 `Somnus-Setup-0.3.0-beta.9-windows-x64.exe`；同名 `.sha256` 文件用于校验下载内容。

- 桌面宿主切换到 DSH Next 架构，保留 Somnus 工作台、项目会话与多 Agent 协作。
- 公司数据库和 Text-to-SQL 通过默认 MCP 接入，继续使用已配置的数据来源和访问权限。
- 更新插件、Skill、MCP 管理和会话执行过程展示。
- 保留呼吸波形查看、工程候选标记、人工复核和历史批次入口。

安装前，请先从系统托盘退出正在运行的 Somnus。升级保留用户配置和历史数据；首次使用的数据连接、账号和访问令牌需由使用者自行配置。安装包不包含开发者的账号凭据、真实记录或本机数据库。

本版本为未签名的 Windows x64 预览版，提供手动下载安装。[对应构建源码](https://github.com/GSXTY/Somnus/commit/f0d128ca2b3ec35af9bea0fc642cb66a11644929)

## v0.3.0-beta.8

Windows x64 桌面试用版。下载安装程序，退出托盘中正在运行的 Somnus 后安装。

- 执行过程默认折叠。展开后可查看成功和失败次数及失败原因，回复状态独立显示。
- 后台任务成功时移除工作台右上角的重复提示，继续通过 Windows 系统通知提醒。
- 移除 SQL 函数白名单，继续检查只读语句、授权表和返回行数。通过独立数据网关查询时，由网关部署版本决定 SQL 策略。
- 使用自己的 Codex 账号时，可通过配置好的数据网关查询获准的表。网关需启用 SQL，并为用户分配访问令牌。

本次发布提供未签名的 Windows x64 安装程序，请从 GitHub 发布页手动下载。全新安装时可直接使用随附的 Codex ACP 适配器和 Node.js。DeepSeek Harness 与 CodeBuddy 可从已安装的官方本机运行时接入。

## v0.3.0-beta.7

- 托盘常驻、运行配置切换、独立故障恢复和分类任务通知。
- 在 Somnus 内接入 DeepSeek Harness、Codex 及其他受支持的 ACP Agent；管理 Skill、插件和已授权的项目工具。
- 公司默认 DeepSeek Flash 会话的窗口配置为 1,000,000 tokens。实际可用长度取决于上游和转发服务。
- 提供项目工作树、差异审阅、授权 PowerShell、公司数据查询、深度分析及呼吸波形复核。
