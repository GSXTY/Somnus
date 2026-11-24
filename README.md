<p align="center">
  <img src="electron/brand/somnus.png" alt="Somnus" width="104" />
</p>

<h1 align="center">Somnus</h1>

<p align="center">
  <strong>连接 AI Agent、业务数据与研发工具的桌面工作台。</strong>
</p>

<p align="center">
  基于 DSH Next Desktop 构建，让对话、数据查询、文档和呼吸波形分析在同一客户端中协同使用。
</p>

<p align="center">
  <a href="https://github.com/GSXTY/Somnus-Releases/releases/tag/v0.3.0-beta.9">下载 Windows 预览版</a> ·
  <a href="#主要功能">主要功能</a> ·
  <a href="#与-dsh-的关系">与 DSH 的关系</a> ·
  <a href="#开发与构建">开发文档</a> ·
  <a href="https://github.com/GSXTY/Somnus/issues">问题反馈</a>
</p>

---

## Somnus 是什么

Somnus 面向需要同时使用 AI、业务数据与专业工具的研发人员。它以桌面会话为入口，把模型与 Agent 接入、项目文档、只读 SQL、深度分析和呼吸波形工具放在一个工作台中。

项目由 VVFLY 研发场景出发：既支持日常的资料整理与项目协作，也为设备使用数据查询、波形查看和工程分析提供专门入口。模型负责理解问题和解释结果，数据访问与分析由对应工具执行。

Somnus 的产品交付以客户端为主。界面采用 React，业务能力通过插件、MCP 和独立服务模块扩展。

## 下载与安装

当前公开安装包为 **Windows x64 预览版 v0.3.0-beta.9**，发布于 2026-11-18。

| 文件 | 下载 |
| --- | --- |
| Windows x64 安装程序 | [Somnus-Setup-0.3.0-beta.9-windows-x64.exe](https://github.com/GSXTY/Somnus-Releases/releases/download/v0.3.0-beta.9/Somnus-Setup-0.3.0-beta.9-windows-x64.exe) |
| 版本说明与 SHA-256 校验文件 | [打开发布页](https://github.com/GSXTY/Somnus-Releases/releases/tag/v0.3.0-beta.9) |

1. 升级用户请先从系统托盘完全退出正在运行的 Somnus；首次安装可跳过此步。
2. 下载并运行安装程序，从开始菜单打开 **Somnus**。
3. 按所用版本的设置入口配置模型或 Agent；需要查询公司数据时，再配置相应数据源与访问权限。

预览版尚未签名。请从上述发布页下载，并按需核对校验文件。安装包不包含开发者账号、API Key 或真实业务数据。

> **安装包与源码版本不同步发布。** v0.3.0-beta.9 对应[该版本源码](https://github.com/GSXTY/Somnus/commit/f0d128ca2b3ec35af9bea0fc642cb66a11644929)，不包含 main 分支最近的主页与工具插件化等更新。下面介绍的是当前源码能力；体验这些更新需要按开发文档构建，后续安装包发布后可直接升级。

## 主要功能

### AI 会话与 Agent 接入

- 使用配置的模型 Provider 发起会话，并接入受支持的外部 ACP Agent。
- 将会话放在项目上下文中，结合文档、工具与授权工作目录开展任务。
- 根据接入运行时的实际能力展示执行状态、审批、停止与结果。

**模型 API 与 ACP 是两种接入方式。** Provider 配置决定模型服务；ACP 连接已有 Agent 的执行能力。接入多个 Agent 不代表系统已实现自动分工、自动派发和自动汇总。

### 插件化主页与工具

主页与业务工具按插件组织，客户端保留统一入口。工具插件注册自己的页面与卡片，避免每增加一种工具都修改桌面外壳。

| 工具 | 能做什么 | 使用条件 |
| --- | --- | --- |
| 数据查询 | 通过自然语言辅助生成只读 SQL，查询获准的数据与表结构 | 配置数据库或数据网关及访问权限 |
| 深度分析（试用） | 上传 CSV 等表格，提交分析任务，查看生成的图表与报告 | 配置独立分析模型、Docker 及执行镜像 |
| 波形分析 | 打开 CSV，查看与缩放呼吸波形，运行工程候选检测、复核与导出 | 明确选择本机记录 |
| 主页 | 按已配置的数据来源展示指标与趋势 | 配置数据连接；未配置时显示明确空态 |

当前深度分析为 DashScope 试用 / DeepAnalyze 协议兼容接入，不表示已随客户端部署 DeepAnalyze 8B，配置见[深度分析说明](deep_analysis/README.md)。波形检测输出是工程筛查候选，不作为临床诊断或临床 AHI。

### 文档与桌面体验

- 个人与共享文档入口，支持目录浏览、列表/网格、排序与拖拽导入。
- 统一的 Somnus 界面与侧栏，在客户端内打开文档和工具。
- 应用菜单提供运行配置、故障恢复和日志入口，便于隔离设置与排查启动问题。

### 插件、Skill 与 MCP

Somnus 保留 DSH 的插件扩展方式，并用 MCP 接入业务工具。插件可提供界面或执行能力，Skill 组织任务知识与操作流程，MCP 为 Agent 提供工具接口。

插件兼容性取决于固定的上游版本、宿主接口及插件依赖；不能仅凭“DSH 插件”名称推断其可用。接入外部工具仍需配置权限与凭据，详见[兼容性说明](docs/SOMNUS_PROVIDER_PLUGIN_COMPATIBILITY.md)。

## 与 DSH 的关系

Somnus 是基于 DSH 生态构建的独立应用，沿用上游的智能体与插件基础，并加入面向研发和业务数据的界面、工具与宿主适配。

| 项目 | 与 Somnus 的关系 |
| --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 提供核心智能体、工具调用、会话与插件机制，是技术基础 |
| [DSH Next](https://github.com/xue-ding-e/DSH-Next) | 当前客户端的直接构建上游；完整源码以固定版本子模块保存在 `vendor/dsh-next/` |
| [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop) | 同属 DSH 桌面生态，是桌面体验与插件设计的参考项目；不是本仓库当前直接构建源 |
| **Somnus** | 提供自身品牌与交互、业务数据接入、文档、SQL、深度分析和呼吸波形工具，以及对应集成与构建适配 |

当前 DSH Next 来源固定在提交 [`f2483c6`](https://github.com/xue-ding-e/DSH-Next/commit/f2483c6d26104b3594cb0e22f56c0331b55dfffe)。Somnus 的自有改动主要位于 `desktop/dsh_next/`、`electron/` 及业务模块中，构建时与固定上游组合。

这里的名称用于说明技术来源与兼容关系，不表示 Somnus 是 DeepSeek 官方产品。感谢 DeepSeek Harness、DSH Next、DSH Desktop 及相关开源社区的工作；上游许可证与第三方声明随对应源码保留。

## 文档导航

| 想了解什么 | 文档 |
| --- | --- |
| 当前源码与开发目录 | [源码地图](SOURCE_MAP.md) |
| 完整上游、工具链与隔离源码构建 | [源码构建说明](docs/SOURCE_BUILD.md) |
| 本机更新、构建与发布的区别 | [构建和发布流程](docs/BUILD_AND_RELEASE.md) |
| Agent 执行、任务与插件边界 | [运行时说明](docs/PLATFORM_RUNTIME.md) |
| 插件与 Provider 兼容性 | [兼容性说明](docs/SOMNUS_PROVIDER_PLUGIN_COMPATIBILITY.md) |
| 现有使用说明与历史版本操作 | [使用说明](USER_GUIDE.md) · [发布记录](RELEASE_NOTES.md) |
| 参与开发与提交 PR | [贡献约定](CONTRIBUTING.md) |

## 开发与构建

获取包含固定上游子模块的源码：

```powershell
git clone --recurse-submodules https://github.com/GSXTY/Somnus.git SomnusNext
cd SomnusNext
```

已有工作副本可执行 `git submodule update --init --recursive` 补齐上游。随后按[源码构建说明](docs/SOURCE_BUILD.md)安装对应工具链与依赖，执行源码检查或隔离构建。Somnus 前端和上游使用各自锁定的依赖与 pnpm 版本，请勿混用。

| 开发内容 | 主要目录 |
| --- | --- |
| 原生界面、宿主与上游适配 | `desktop/dsh_next/`、`electron/` |
| 主页与独立工具插件 | `plugins-ui/` |
| 客户端复用的 React 业务组件 | `page_design/frontend/src/` |
| Agent、数据与分析服务 | `ai_assistant/`、`agent_core/`、`data_gateway/`、`deep_analysis/` |
| 波形与事件检测 | `event_detection/`、`server_detection/` |
| 固定上游源码 | `vendor/dsh-next/` |

开发构建与备份默认写入同级 `SomnusNext-Storage`。`app/` 是本机可运行目录，不属于仓库源码。合并 PR、更新本机程序和发布安装包是独立步骤。

请从最新 main 创建任务分支，完成相关检查后通过 PR 提交。不要提交账号密钥、本地配置、真实用户数据或构建二进制，具体流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 反馈与参与

欢迎通过 [Issues](https://github.com/GSXTY/Somnus/issues)反馈问题或提出建议。反馈时请附版本、系统、复现步骤与经过脱敏的日志；涉及工具或插件时，也请说明接入方式和插件版本。
