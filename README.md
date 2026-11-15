<p align="center">
  <img src="page_design/frontend/src/assets/somnus-mascot.png" width="120" alt="Somnus 水獭标志">
</p>

<h1 align="center">Somnus</h1>

Somnus 是面向团队的桌面 AI Agent，将会话、本地项目和企业授权数据放在同一个工作台。你可以使用公司配置的默认 Agent，也可以接入自己的 Agent、模型供应商和扩展。

## 核心能力

- **项目会话**　关联本地工作目录，按项目组织聊天。同一会话切换 Agent 时，可带上最近对话和较早内容的摘要。
- **项目协作**　搜索项目文件并审阅修改差异，确认后写入。在支持的桌面 Agent 会话中，可以查看 Git 差异，并在确认后运行已配置的测试。
- **企业数据分析**　连接公司数据网关后，Agent 可按授权查询业务数据，并在配置了分析服务时发起深度分析。

## 技术架构

| 层 | 实现 |
| --- | --- |
| 桌面与服务 | Electron 启动本机 Python FastAPI 服务，由同一个回环地址提供 React 工作台与 API。 |
| Agent 调度 | Somnus 提供内置 Python Agent 循环，处理模型请求、上下文和工具调用。Electron 也可通过 ACP 启动 Codex、DSH 等运行时，经工具桥提供获准的 Somnus 能力。 |
| 企业数据 | 独立的 HTTPS 数据网关管理授权和只读数据库查询。数据库凭据保存在网关侧。 |

## 扩展生态

默认 Agent 可使用公司提供的模型。用户也可配置自己的模型供应商、接入 ACP Agent，或导入 MCP 服务与 Skill。DSH 的兼容插件由 DSH 运行时加载。

## Windows 下载

Windows x64 安装包发布后，从独立公开发布页下载并运行 `Somnus-Setup-<版本>-windows-x64.exe`。目前尚未发布安装包。 [Windows 下载和版本说明](https://github.com/GSXTY/Somnus-Releases/releases)

[维护指南](docs/MAINTAINER.md)
