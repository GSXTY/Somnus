# Somnus 当前运行时与插件边界

本文描述 Windows 探索版当前平台实现。业务功能的历史架构说明保留在 [AGENT_PLATFORM_PLAN.md](AGENT_PLATFORM_PLAN.md)，不作为当前运行时完整规格。升级及候选审查步骤见 [PLATFORM_UPGRADE_GATE.md](PLATFORM_UPGRADE_GATE.md)。

## 模块责任

- Somnus React 页面负责聊天、项目、群聊、审批与结果呈现。页面是任务账本的投影，不是执行任务的唯一持有者；模型 Provider 不改变 Somnus 身份。外部 ACP Agent 保留自己的身份。
- `electron/runtime/registry.cjs` 是实际调用的集中适配层；通过注入的 DSH native 与 ACP 引擎调用原有稳定执行循环，不另造 Agent 循环。`contracts.cjs` 区分宿主保证、协商能力和未知能力；不因 Provider 名称推断运行时能力。
- `ai_assistant/runtime_tasks.py` 与服务接口负责统一任务账本、所有权、序号、租约、重启中断和终态。任务必须先由原会话预留，宿主不能自造归属。
- `trace.cjs` 从真实事件提取步骤、子任务、审批决定、用量及结果；不将原始工具参数写入进度或审批历史。`result-outbox.cjs` 仅保存待落盘结果，不能触发模型重跑。
- 波形、数据、文档与已有插件页面继续由自己的模块维护，不因这层适配改写算法或数据历史。

## 任务、审批与恢复

每项调用按会话、Agent、预留回复 ID 精确隔离。同一会话的不同 Agent 可以独立执行。首个 claim 和 running 状态均确认后才开始实际调用；claim 回应丢失可以用同一所有权重取凭据。未启动任务可安全 abandon，不能留下假运行状态。

页面导航或渲染进程重建只断开显示，不撤销已授权的宿主任务。实际结果由宿主直接提交后台，再返回页面；旧页面重复 finish 不能覆盖终态。重新打开页面可读取当前任务及宿主持有的待审批请求，新的批准/取消操作仍校验当前页面和精确任务。旧任务的停止操作不能取消后续新任务。

短暂失联依靠租约显示断开，恢复后可确认仍在执行的任务。后台重启则将原执行标为中断并撤销继续执行授权，不自动重放模型或工具。已产生的完整结果可凭执行前签发、绑定所有权的收据迟到补交，并明确标注延迟同步；只产生部分结果则保留中断语义。用户取消是意图，最终以实际取消或实际完成结果为准。

审批轨迹只保存请求 ID、工具类别、决定与时间，不保存命令或参数。ACP 的批准按选项声明的 `kind` 判断，不把自定义选项 ID 当权限语义。问答请求不冒充审批。

## 结果缓存边界

宿主使用系统 safeStorage 加密待保存结果，缓存有数量、体积和七天有效期限制；加密不可用时只在内存保存，不写明文。恢复只重试保存真实结果，绝不重发任务。清空缓存、超限、系统凭据不可用或进程在结果产生前中断，都不能保证无损恢复。不能继续的任务应由用户检查后决定是否重新发起。

## 两种插件格式

两种格式保留各自实际安装器，不将 DSH npm 包冒充文本 Skill 包。两者的只读 contract 都报告格式、是否旧包、能力、最低 Somnus 版本和兼容结论；声明仅说明兼容性，不授予工具权限。

### 可移植文本包 `somnus.plugin.v1`

实际校验入口为 `ai_assistant/plugin_package.py`。顶层保留 `format`、`minimum_somnus_version`、`manifest`、`skills`，可选 `contract`：

```json
{"schema_version":1,"runtime":"somnus","capabilities":["skills","mcp"]}
```

模板与验证通过 `tools/plugin_contract.py`，与导入使用同一校验。MCP 引用绑定安装用户已有配置，不携带凭证、不自动授权。文本包不安装浏览器组件；`ui.*` 声明会被拒绝。旧合法包继续支持并标为未验证声明。

### DSH bundle 包

实际校验接入 `electron/acp-dsh-community.cjs` 的安装/启用流程；插件页面扫描也验证声明。可在 `package.json` 的 `dsh.somnus.contract` 声明：

```json
{"schema_version":1,"minimum_somnus_version":"0.3.0-beta.9","capabilities":["tools","skills","mcp","owned-pages"]}
```

允许能力为 `tools`、`skills`、`mcp`、`owned-pages`、`settings-extensions`、`message-extensions`、`sidebar-extensions`。最低版本按 SemVer 比较，包括数字预发行标识与 build metadata。无声明的旧包仍走原验证流程并标为未验证；非法或版本不符的声明禁止新安装及打开相关页，但市场列表保留安全的不兼容原因，不使整页失败。

DSH 原生 UI slot 不能因名字相同就被视为兼容。Somnus 已有安全页面与设置/侧栏入口可继续使用；任意消息组件、浏览器运行时或原厂 slot 仍需明确适配。`requires-adapter` 表示需要适配，不等于已支持。现有入口详情见 [SOMNUS_PROVIDER_PLUGIN_COMPATIBILITY.md](SOMNUS_PROVIDER_PLUGIN_COMPATIBILITY.md)。

## 构建与升级边界

`runtime/resources.cjs` 为实际 stage 流程枚举宿主资源；`required-host-files.json` 强制检查新适配模块、关键宿主与插件验证入口，不只复制顶层 `.cjs`。Electron 的资源规则包含嵌套 runtime 和必要 `.mjs`。运行时模块只依赖 Node 内置模块或同层模块，原执行引擎通过依赖注入接入。

本地升级门禁运行真实状态、权限、模型、模式、群聊、插件、生命周期、HTTP 与资源契约检查，并核对前端源码和构建资产指纹。Next 桌面来源与 DSH 执行运行时的版本来源分别固定，不能混为同一版本。门禁失败不得生成可提升候选；通过也不自动同步标准版或发布 GitHub，仍由开发者审查决定。
