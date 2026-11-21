# ACP Agent 切换方案（Codex 优先）

目标：让 Somnus 的 DSH 会话可以按会话切换执行 Agent：

- `Somnus`：使用配置中心 provider 提供的模型
- `Codex`（后续 Claude Code、Gemini CLI 等）：使用原生 ACP 会话

参考：Vibex 把 ACP 作为唯一的在线 Agent 传输，Agent 直接作为会话运行，而不是把 ACP 包装成模型。

## 现状

已有：

- 旧版 Somnus 的 ACP 运行时：`electron/acp-agents.cjs`、`acp-stdio.cjs`、`acp-live.cjs`、`acp-project.cjs`
- 随包 Codex 运行时：`resources/agents/codex`（`node.exe` + `@agentclientprotocol/codex-acp`）
- ACP Agent 注册表：`%APPDATA%\RespiratoryViewer\external-acp-agents.json`
- 旧版后端的外部 Agent 回合 API：`begin_external_turn`、`prepare_external_turn`、`finish_external_turn`
- DSH 的 Agent 预设选择器、模型选择器

缺口：

- DSH 会话协议没有“执行 Agent”切换
- ACP 运行时目前只存在于旧版 Electron 主进程，DSH 窗口没有加载
- DSH 输入框只有模型选择，没有 Agent 选择

## 架构

```text
DSH Client
  ├─ 模型选择器（现有）
  ├─ Agent 选择器（新增，按会话）
  └─ 消息发送
        │
        ▼
DSH Host / Somnus ACP Host
  ├─ agent = somnus  -> 现有 provider 转发
  └─ agent = codex   -> ACP 会话桥 -> Codex ACP 子进程
```

ACP Host 负责：

- 启动/复用 Codex ACP 子进程
- 初始化、`session/new`、`session/prompt`
- 把 ACP 的流式更新映射成 DSH 的文本/工具事件
- 取消、超时、审批
- 按会话保存 ACP session id

## 阶段

### 阶段 1：ACP Host 与 Codex 握手（先不做 UI）

- 把旧版 ACP 运行时抽成可在 DSH 主进程加载的 Node 模块
- 读取 `external-acp-agents.json`，补充检测随包 Codex
- 用测试脚本完成一次：
  - 启动 Codex ACP
  - `initialize`
  - `session/new`
  - `session/prompt` 返回文本
- 验证失败时记录可复现日志

验收：不经过 UI，命令行能拿到 Codex 的 ACP 回复。

### 阶段 2：Agent 选择器与按会话路由

- DSH 输入框旁增加 Agent 下拉：
  - Somnus
  - Codex
- 按会话保存 `agent_id`
- 选 Somnus 走现有 provider
- 选 Codex 走 ACP Host
- 先支持纯文本、流式输出、取消

验收：同一个 DSH 窗口里切换 Agent，消息分别由 provider 和 Codex 回复。

### 阶段 3：工具、审批、文件

- ACP 工具调用映射到 DSH 工具卡片
- 权限审批
- 文件修改/终端输出
- ACP session 复用与历史回放

验收：Codex 执行命令、改文件、请求权限时，DSH UI 能显示并处理。

## 风险

- DSH 会话协议是内部的，接 Agent 路由需要改 Host 或加适配层
- Codex ACP 登录态依赖本机 Codex 配置
- ACP 工具事件与 DSH 工具事件不是一一对应
- 不能把 ACP 简单包装成 OpenAI 模型，否则会丢失工具/审批语义

## 阶段 1 进展

已用随包 Codex 验证：

- ACP 进程可启动
- 协商到 ACP v1
- Codex ACP 版本 `2.6.0`
- 当前状态 `authentication: required`
- 登录方式：ChatGPT（浏览器）

说明 ACP 运行时本身可用，下一步是完成 Codex 登录，再接 DSH 会话层。

## 阶段 1 结果（2026-11-20）

Codex 已完成 ChatGPT 登录，并通过真实 ACP 回合：

- `session/new` + `session/prompt` 成功
- 返回模型：`gpt-6.2-sol`（6.2 Sol）
- 返回用量：`input 16618 / output 47`
- 结束原因：`end_turn`

测试时使用了一个最小 project client（没有附加项目）来建立 live turn；真实实现需要替换成 Somnus 的项目上下文适配器，否则会把“没有附加项目”写进提示词。

下一步：把这次脚本级调用封装成常驻 ACP Host，再接 DSH 会话的 Agent 选择器。

## 下一步

阶段 1：先做 ACP Host + Codex 握手脚本，确认随包 Codex 能正常 `initialize` / `session/new` / `prompt`，再动 UI。
