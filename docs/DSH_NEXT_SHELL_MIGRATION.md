> 历史迁移记录：其中旧目录与临时路径属于当时证据，不是当前 SomnusNext 的启动或构建入口。当前流程见根目录 README.md 与 desktop/dsh_next/NEXT_BUILD.md。

# Somnus 迁移到 DSH Next 壳：目标架构与实施约定

状态：方案稿。已确认产品方向，待 P0 实现与验收。
适用范围：Windows 探索版本机桌面；不改变 Python 检测算法、历史数据与证据链。

## 1. 目标

Somnus.exe 启动后只呈现 DSH Next 的主界面：会话、项目、插件、Skills、MCP、设置、子 Agent、模式等全部沿用上游功能与 UI。Somnus 只额外提供自己的领域功能，并保留 Somnus 品牌色。

已确认的三个决策：

1. 领域页入口放在 DSH 侧栏，内容显示在 DSH 主区面板。
2. 旧 Somnus 聊天/项目/群聊/文件审阅退役，历史只读归档；聊天统一用 DSH 会话。
3. 领域页先保证功能可用，再逐页按 DSH 设计语言重写。

## 2. 现状

- `desktop/dsh_next/host/standalone-main.mjs`：先 `workbench.openHome()` 打开旧 React 工作台，再后台启动 DSH 引擎。用户看到的主窗口仍是旧工作台。
- `desktop/dsh_next/client/somnus-workbench.tsx`：只注册一个 `main` 面板和 `sidebar.panellist` 图标，面板里两个按钮用独立 `BrowserWindow` 打开旧工作台/波形。
- `desktop/dsh_next/branding.json`：只覆盖 5 个主题 token；品牌绿 `#176D61` 已用于按钮主色。
- 旧 React 工作台（`page_design/frontend`）包含看板、SQL、深度分析、文档、会话、插件等页面，自带 AntD 5 + ECharts 与 `#176D61` 主色。
- 波形页（`event_detection/`）是原生 JS 单页应用，由 Python 服务在 `/events` 提供。

## 3. DSH Next 的硬约束

这些是上游明确规则，不是偏好：

1. **不要把 Host 页面塞进 iframe。** iframe 拿不到 `--dsw-*` 主题 token、深色模式和 `ctx.locale`，不可能做到与宿主一致的 UI。
2. **不要 `require('@deepseek-ai/dsh-client-ui-primitives')`。** 上游组件随时变化，抛错会让整个 slot 空白；需要控件时复制宿主结构、样式和行为，类名加自己的前缀。
3. **只用 `--dsw-alias-*` token 着色。** 字面色仅用于插画/图表数据色。
4. **通过 slot 注册 UI。** 不操作 slot 之外的 DOM，不向 `document.body` 追加第二套应用。
5. 客户端插件用 `ctx.effect` 管理资源，可卸载、可重装。

现有 `somnus-workbench.tsx` 直接导入了 `Button`，违反第 2 条，P0 一并修掉。

## 4. 目标架构

```
Somnus.exe
└─ DSH Next 主窗口（上游 UI，含全部上游功能）
   ├─ 侧栏「Somnus」
   │   ├─ 工作台        main panel: somnus-dashboard
   │   ├─ 数据查询      main panel: somnus-sql
   │   ├─ 深度分析      main panel: somnus-deep-analysis
   │   ├─ 文档          main panel: somnus-documents
   │   └─ 波形分析      main panel: somnus-waveform（特殊，见 §7）
   └─ Python 后端（127.0.0.1:8765）
        ├─ /api/workbench、/api/sql、/api/deep-analysis、/api/documents、/api/assistant
        └─ /events、/api/open、/api/detect、/api/events 等检测链路
```

领域页的 React 代码来自现有 `page_design/frontend/src`，由 DSH 客户端插件打包加载；不再保留旧 App 外壳（侧栏、顶栏、聊天页）。DSH 已提供的聊天/项目/插件页不重复实现。

## 5. 主题与颜色

DSH 主题通过 `ctx.theme.overrideTokens(source, tokens)` 注入，每个 token 必须同时给 `light` 与 `dark`。

Somnus 色板（以现有运行时代码为准）：

| 角色 | 浅色 | 深色 |
|---|---|---|
| 主色 | `#176D61` | `#86CDBD` |
| 主色 hover | `#12584F` | `#A1DECF` |
| 成功 | `#00A887` | `#5BD3B8` |
| 背景 base | `#F5F8F7` | `#171D1B` |
| 背景 layer-1 | `#F5F8F7` | `#18211F` |
| 背景 layer-2 | `#FFFFFF` | `#202A28` |
| 主文字 | `#202A28` | `#E7EFEB` |
| 次文字 | `#526762` | `#A4B9AE` |

P0 补齐其余 token：`--dsw-alias-bg-base`、`bg-overlay`、`border-l1`、`border-l2`、`brand-primary`、`label-secondary`、`state-error-primary`、`state-idle-primary`、`state-success-primary`、`state-warn-primary`、`--dsw-specific-sidebar-fill`。

领域页内部继续使用 Somnus 的 AntD `ConfigProvider`（主色 `#176D61`），与 DSH 壳的颜色保持一致；波形页保留其数据色（流量青、压力蓝、漏气棕、候选紫）。

## 6. 数据访问契约

DSH 渲染进程的源不是 Python 服务，相对 `/api/...` 会打到 DSH。领域页不能直接 `fetch('/api/...')`。

方案：在 `project-preload.cjs` 暴露 `window.somnusApi`：

```ts
interface SomnusApi {
  request(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer }):
    Promise<{ status: number; headers: Record<string, string>; body: ArrayBuffer }>
  openExternal?(url: string): Promise<void>
}
```

- 渲染进程调用 → IPC → 主进程用 `net.fetch` 请求 `http://127.0.0.1:<实际端口>`，附带 `RESPIRATORY_VIEWER_PROJECT_TOKEN`。
- 主进程负责校验 path 只能是以 `/` 开头的本机 API 路径，拒绝跨源与路径穿越。
- 二进制上传（CSV/EDF）走 `ArrayBuffer`，不在渲染进程直连 8765，避免 CORS。
- SSE（如仍需流式）用 `MessagePort` 或分块 IPC；领域页首版不做流式聊天，因为聊天已交给 DSH。

现有页面里的 `shared/api.ts` 与 `event_detection/viewer.js` 的 `fetch` 调用点需要收敛到一个适配层，不逐处改 URL。

## 7. 波形页的特殊处理

波形页是原生 JS 画布应用，无法直接作为 React 组件打包，且 UI 与 DSH 设计语言差异最大。三选一：

- **A（推荐过渡）** 独立窗口：侧栏入口仍在 DSH，点击后用 `BrowserWindow` 打开 `/events`；功能零损失，但它是独立工具窗口，不参与 DSH 主区布局。
- **B** `WebContentsView` 嵌入主区：功能可用，需要同步面板边界、处理窗口缩放和关闭；视觉仍是旧页。
- **C** 原生重写后进主区：视觉最终统一，工期最长。

P1 先按 A 保功能；波形重写排在其他四页之后。若必须 P1 就进主区，选 B，但要在验收记录里明确“视觉未统一”。

## 8. 分阶段与验收

### P0 换壳（先做）

- `standalone-main.mjs`：DSH 主窗口为主；旧工作台只作为服务启动，不默认打开。
- `somnus-workbench.tsx`：拆成 `somnus-panels.tsx`，注册 5 个侧栏项和主面板占位；去掉 primitives 导入。
- `branding.json`：补齐完整 token 表。
- 验收：启动只有一个 DSH 窗口；侧栏出现 Somnus 5 项；主区可切换占位面板；颜色与 Somnus 一致；DSH 原有会话/插件/设置可用。

### P1 领域页保功能

- 打包现有 4 个页面组件（看板、SQL、深度分析、文档）为客户插件模块，经 `somnusApi` 访问后端。
- 波形按 §7 A 或 B 接入。
- 验收：看板指标加载；SQL 只读查询；深度分析任务提交与产物；文档读取；波形打开/扫描/复核/导出；旧数据未被修改。

### P2 视觉统一

- 逐页按 DSH 设计重写（先看板/SQL，后深度分析/文档，最后波形）。
- 每页独立验收，未重写的页保留 P1 形态。

### P3 收口

- 旧聊天 UI 下线，`assistant.sqlite3` 只读归档与导出。
- 打包走 `build_electron.py --next-extracted`；`tools/platform_gate.py` 与隔离 Profile 验收。
- 文档、发布说明、数据目录说明更新。

## 9. 文件所有权与分工

| 范围 | 负责 |
|---|---|
| `desktop/dsh_next/host/*`、`electron/project-preload.cjs`、`electron/backend.cjs` | 桌面宿主 agent |
| `desktop/dsh_next/client/*`、`branding.json`、`page_design/frontend` 页面适配 | 页面 agent |
| `event_detection/`、`server_detection/` | 事件检测 agent |
| `ai_assistant/` 归档与接口 | 模型服务 agent |
| 方案、接口、验收 | 主 agent |

跨模块接口（`somnusApi`、面板 id、token 表）先在本文件冻结，再各自实现。

## 10. 风险

| 风险 | 应对 |
|---|---|
| 上游 anchor 漂移 | 客户端贡献收敛为独立 bundle，只改最小的注入点；升级前跑 `validate.mjs` |
| AntD/ECharts 与 DSH 样式冲突 | 页面容器加命名空间前缀；不覆盖 `body` 与全局 token |
| 大文件上传经 IPC 复制 | 分块或临时文件句柄；单文件上限在接口层校验 |
| 两套会话历史 | 明确 DSH 为唯一会话源；旧数据只读导出，不双写 |
| 波形页视觉不统一 | P1 记录为已知差异，P2 重写后关闭 |
| 安装包体积增加 | 客户端 bundle 只打包用到的 AntD/ECharts 子集，构建后检查体积 |

## 11. 已确认（2026-11-19）

1. 主色以 `#176D61` 绿为准；图表/波形数据色保留现有蓝青棕紫。
2. 波形页 P1 用独立窗口保功能，P2 再原生重写进主区。
3. P0 立即开工，允许下载并解包固定版本的上游安装程序做真实验收。

## 12. P0 实施记录（2026-11-19）

已完成代码改动：

- `desktop/dsh_next/host/standalone-main.mjs`：DSH 主窗口成为启动主界面；先显示轻量启动页，引擎 ready 后加载 Host 提供的 DSH 地址；托盘/二次启动优先聚焦 DSH 窗口；安全模式或引擎失败时回退旧工作台。
- `desktop/dsh_next/host/somnus-desktop.ts`：新增 `setPrimaryFocus`，让托盘和 `openHome` 能聚焦 DSH 窗口而不是旧工作台。
- `desktop/dsh_next/client/somnus-workbench.tsx`：去掉对上游 `ui-primitives` 的直接导入；注册不再依赖 `window.somnusNext`；面板改为 5 个领域入口 + 占位说明。
- `desktop/dsh_next/branding.json`：主题 token 从 5 个补到 16 个，覆盖浅色/深色。
- `desktop/dsh_next/stage-next.mjs`：接入 `buildInstalledClientOverlay`。此前 Next 构建只改 Host，从未注入 Somnus 客户端面板、品牌和主题。

验收中发现的两个真实问题：

1. `stage-next.mjs` 的客户端 overlay 缺失，导致 DSH Next 壳里没有 Somnus 入口。
2. 旧的冻结后端缺少 `/api/assistant/dsh-next-runtime`，引擎启动时报 `Somnus Host capability is unavailable (404)`；必须用当前源码重建 `SomnusBackend`。

待验证：重建后端后 DSH 窗口是否正常渲染、Somnus 面板是否出现、主题是否生效、DSH 原有会话/插件页是否可用。P0 暂不接桌面 preload 的窗口控制、账号与文件拖拽 IPC；这些属于 P1。

### P0 验收结果（2026-11-19）

隔离预览：`D:\VVFLY\Somnus-Explorer-Storage\cache\tmp\somnus-next-stage-aZMh6C\win-unpacked`

- 启动后只有一个主窗口，标题 `Somnus`；引擎日志出现 `Somnus engine ready`。
- 界面为中文 DSH Next；侧栏出现 `Somnus` 入口，主区有工作台、波形分析、数据查询、深度分析、文档 5 个标签。
- 主题生效：背景 `#F5F8F7`，主色 `#176D61`，浅色模式正常。
- DSH 原生插件页、会话入口、工作区切换可用。
- 截图：[somnus-dsh-p0.png](images/somnus-dsh-p0.png)。

已知 P0 边界：

- 未接 DSH 桌面 preload/IPC，窗口控制、账号、文件拖拽等桌面集成仍缺。
- 首次运行仍会出现 DSH 的 Preview Notice，需要手动继续。
- 面板里的“打开”按钮是占位，P1 才接真实页面。
- 侧栏是 1 个 Somnus 入口 + 5 个内部标签，不是 5 个独立侧栏图标。

## 13. P1 工作台（2026-11-19）

已接入第一页：

- 新增 `electron/dsh-somnus-preload.cjs`，向 DSH 页面暴露 `window.somnusApi.request`。
- 主进程新增 `somnus:api:request` IPC：校验发起窗口、只允许 `/api/` 本机路径、附带 `X-Data-Agent-Native` 令牌后用 `net.fetch` 转发到 Python 服务，避免跨源与 CORS。
- 新增 `desktop/dsh_next/client/SomnusDashboard.tsx`：按 DSH 主题 token 渲染工作台，数据契约仍是 `/api/workbench`；实时源显示未连接与未知值，演示源显示合成指标和 7 天趋势。
- 面板“工作台”标签直接渲染该页；其余四页仍是占位。

实现选择：没有把旧 AntD 看板原样打包进 DSH，因为会引入第二套设计系统并和宿主主题冲突；改为同一数据接口上的轻量原生视图，功能和数据口径不变。

验收：

- 实时源：显示“暂时无法连接只读数据库”，四项指标为 `—`，无伪造零值。
- 演示源：显示“合成演示数据”、8 位活跃用户、44 小时治疗时长、66 次候选，2 张趋势图。
- 截图：[somnus-dsh-p1-workbench.png](images/somnus-dsh-p1-workbench.png)。

下一步：波形分析（独立窗口）、数据查询、深度分析、文档。

## 14. 方向调整：Somnus UI 为主（2026-11-19）

用户确认目标界面为 Somnus 自己的左侧导航（新建会话、会话管理、主页、文档、工具、配置中心、插件、工作区、数据目录、设置），右侧是原 Somnus 主页内容；不要 DSH 自己的侧栏，也不要 DeepSeek 登录。

默认行为调整为：

- `Somnus.exe` 直接打开旧 Somnus 工作台，窗口标题 `Somnus · 工作台`。
- 不启动 DSH 引擎，不显示 DSH UI，因此没有 DeepSeek 账号、Welcome 或 Preview Notice。
- 托盘、二次启动、项目目录、文档库等仍由 Somnus 宿主提供。
- 截图：[somnus-home-default.png](images/somnus-home-default.png)。

DSH 壳保留为可选模式，默认关闭：

- `SOMNUS_DSH_UI=1`：启动 DSH 引擎并显示 DSH 主窗口。
- `SOMNUS_DSH_CLIENT=1`：构建时注入 Somnus 面板、品牌和主题 overlay。
- 两者都不设置时，走 Somnus UI。

差异说明：用户截图中的 `IM 机器人` 和 `测试` 项目不在当前源码导航与示例数据中；需要确认是否来自标准版或另一分支，再决定是否补齐。

## 15. 侧栏合并与对应页面（2026-11-19）

最终确认的目标：保留 DSH 侧栏（插件、自动化任务、更多、工作区），把 Somnus 的导航项加进去；每项在右侧显示对应的 Somnus 页面，而不是整体替换成旧 Somnus UI。

实现：

- 默认启动 DSH UI；`SOMNUS_DSH_UI=0` 才回退到完整旧 Somnus 窗口。
- 客户端注册 5 个侧栏项：主页、文档、工具、配置中心、IM 机器人；插件沿用 DSH 原生页。
- 每个主面板用 iframe 加载 `{origin}/workbench-assets/embed.html#<view>`：
  - 主页 `#dashboard`
  - 文档 `#documents`
  - 工具 `#plugins`
  - 配置中心 `#config`
- 旧页面嵌入模式：`embed.html` 注入 `data-somnus-embed` 并用 CSS 隐藏旧顶栏和旧侧栏，避免双导航。
- `embed.html` 由 `page_design/frontend/scripts/make-embed.mjs` 在前端构建后生成，避免写死资源哈希。
- `dsh-somnus-preload.cjs` 提供 `somnusApi.request` 与 `somnusApi.origin`；主进程转发 `/api/*` 并返回服务源地址。

验收：

- 侧栏顺序：插件、自动化任务、主页、文档、工具、配置中心、IM 机器人、更多。
- 主页、工具、配置中心显示对应旧页面，旧侧栏已隐藏。
- 不需要 DeepSeek 登录。
- 截图：[somnus-dsh-merged-nav.png](images/somnus-dsh-merged-nav.png)、[somnus-dsh-config.png](images/somnus-dsh-config.png)。

已知边界：

- 文档页显示“请在 Somnus Windows 桌面版使用文档库”：iframe 没有桌面文档 IPC，需要补桥。
- IM 机器人目前是占位说明，需要 DSH 插件宿主接入。
- iframe 内的旧页面主题独立于 DSH token，深色切换不会同步。
- 插件入口使用 DSH 原生页，没有重复添加 Somnus 插件页。

## 16. 移除 DSH 登录、反馈和模型设置（2026-11-19）

按用户要求，DSH 只保留壳和通用设置，账号相关能力不再出现：

- `dsh-client-ui-settings-account` 的账号菜单只保留“设置”，移除“意见反馈”和“登录/退出登录”。
- 移除 `settings.models.sign-in` 注册，避免模型设置页再出现登录/API Key 引导。
- `dsh-client-ui-settings-models` 的 `settings.section`（模型）整段移除。
- 模型配置统一由 Somnus 配置中心承担。

验收：

- 侧栏底部“更多”菜单只剩“设置”。
- DSH 设置只剩：通用设置、内置插件、Agent 预设。
- 截图：[somnus-dsh-account-menu.png](images/somnus-dsh-account-menu.png)、[somnus-dsh-settings.png](images/somnus-dsh-settings.png)。

遗留：DSH 的“新会话”和聊天输入框仍在，但没有配置 DSH 模型时会显示“请选择模型”。如果 DSH 聊天也不需要，可以下一步隐藏新会话、默认打开 Somnus 主页。

## 17. iframe 桌面访问修复（2026-11-19）

现象：配置中心显示“模型配置仅可从本机 Windows 桌面访问（desktop_required）”。

原因：Somnus 页面在 DSH 里通过 iframe 加载，是普通网页请求；`/api/assistant/models` 要求 `respiratory_desktop` cookie 或 `X-Data-Agent-Native` 令牌，iframe 都没有，所以 `DesktopAccess.local()` 判定失败。

修复：

- DSH 窗口启动后，主进程为 `http://127.0.0.1:<port>/*` 的请求注入 `X-Data-Agent-Native` 令牌。
- 同时写入 `respiratory_desktop` cookie（由项目令牌 HMAC 派生，与服务端算法一致）。
- 只作用于 Python 服务端口，不影响 DSH Host 请求。

验收：配置中心不再报 `desktop_required`，可以进入 Provider 页；截图 [somnus-dsh-config-fixed.png](images/somnus-dsh-config-fixed.png)。

仍然缺桌面 IPC 的页面：

- 文档：显示“请在 Somnus Windows 桌面版使用文档库”，需要 preload/IPC 或改用 HTTP 文档接口。
- IM 机器人：需要 DSH 插件宿主。

## 18. 欢迎页品牌与 Provider 桥接（2026-11-19）

欢迎页：

- `dsh-client-ui-conversation` 的 `hero.headline` 全部替换为 `Somnus`。
- 移除“预览版”徽标。
- 欢迎页鱼类 Logo 替换为 Somnus 图标。
- 移除 DSH 的 API Key onboarding 弹窗（`desktop-onboarding` 与 `settings.onboarding`）。
- 截图：[somnus-dsh-welcome.png](images/somnus-dsh-welcome.png)。

Provider 桥接：

- `ai_assistant/dsh_next_runtime.py` 在“仅使用已配置 Provider”模式下改为创建 `ProviderRosterLease`，把配置中心的可用模型以 `models` 列表交给 DSH Host。
- 生成的 `somnus.cordis.patch.yml` 已包含 `vvman-company` provider 和两个配置中心模型（默认模型为第一个）。
- 后端已重建并装入 `D:\VVFLY\Somnus-Next`。

未完成：DSH 的模型菜单仍显示“暂无可用模型”，说明生成的 provider 路由还没有被 DSH 客户端激活。下一步需要检查 `@deepseek-ai/dsh-llm-pi-ai` 的加载/模型目录事件，或改为写入 DSH 的设置文档。

## 19. DSH Provider 路由修正（2026-11-19）

原因：`dsh-base` 已经挂载了一个 dormant 的 `llm-pi-ai` 行（id `llm-pi-ai`），provider 配置应由这一行的 `config.providers` 提供。之前 overlay 新增了一个同名插件的第二个实例（`somnus-company-model`），所以模型没有进入选择器。

修正：

- `dsh-next-host-adapter.mjs` 的 `providerRows` 改为按 id 覆盖已有的 `llm-pi-ai` 行，写入 `config.providers`。
- provider 显示名改为 `Somnus`。
- 模型条目增加 `name`，显示 `deepseek-flash` / `deepseek-v4-pro`，不再只显示内部 `m_...` ID。
- 默认模型仍由 `agent-default-model` 指向第一个配置项。
- 后端 `dsh_next_runtime.py` 的 provider models 增加 `name` 字段。
- 恢复 DSH “新会话”入口（之前为规避空模型而临时隐藏）。

验证：DSH 输入框已能显示默认模型 ID；模型显示名与 provider 名称的最终效果待重建后端后确认。

### 最终验证（2026-11-19）

- DSH `新会话` 的模型选择器显示 provider **Somnus**。
- 模型列表：`deepseek-flash`（默认选中）、`deepseek-v4-pro`。
- 模型 ID 仍是内部 `m_...`，但显示名已改为真实模型名。
- 截图：[somnus-dsh-provider.png](images/somnus-dsh-provider.png)。

至此，配置中心的 provider 已经作为 DSH runtime 的 `Somnus` provider 工作，DSH 会话可以直接选择并使用。

## 20. 侧栏收口与工具页适配（2026-11-19）

侧栏：

- 删除 `会话管理` 入口；会话统一使用 DSH `新会话`，模型来自 `Somnus` provider。
- 移除 DSH 的 `更多` 菜单（`sidebar.panellist.actions` 的 `entry-customization` 注册）。
- 最终顺序：插件、自动化任务、主页、文档、工具、配置中心、IM 机器人。
- 隐藏底部账号菜单触发器，不再出现多余的“更多”。
- 截图：[somnus-dsh-sidebar-final.png](images/somnus-dsh-sidebar-final.png)。

工具页：

- Somnus 页面 iframe 下移 40px，避开 DSH 窗口标题栏和原生窗口控制按钮，工具页不再被最小化/最大化/关闭按钮遮挡。
- 截图：[somnus-dsh-tools.png](images/somnus-dsh-tools.png)。

启动：

- 启动页继续使用 Somnus 品牌与加载动画。
- 已移除 DSH 的 API Key onboarding 和模型设置入口；本次验证启动时未再出现 Harness 更新提示。
- 如果仍看到 DSH 自己的加载页或更新提示，需要再补客户端 overlay 定位。

## 21. 顶部栏与内容避让（2026-11-19）

现象：Somnus 窗口没有顶部栏，DSH 页面直接顶到窗口控制按钮下面，工具页和会话页与最小化/最大化/关闭按钮重叠。

修复：

- `BrowserWindow` 的 `titleBarOverlay` 改为不透明 Somnus 背景色 `#F4F8F6`，高度 40px。
- DSH 页面加载后注入 `body { padding-top: 40px }`，并插入固定的 `Somnus` 标题栏。
- iframe 不再自行偏移 40px，避免双重下移。
- 工具页、会话页现在都从标题栏下方开始，不再与窗口按钮重叠。
- 截图：[somnus-dsh-titlebar.png](images/somnus-dsh-titlebar.png)。

注意：截图中显示的 `deepseek HARNESS` 窗口是 DeepSeek Harness 本体，不是 `Somnus.exe`。Somnus 构建的顶部栏为 `Somnus`，启动动画也是 Somnus。

## 22. 顺序、设置入口与启动引导（2026-11-19）

- 左侧顺序调整为：主页、文档、工具、配置中心、IM 机器人、插件、自动化任务。
- 恢复左下角 `设置`（账号菜单触发器，文案从“更多”改为“设置”；菜单内只有设置）。
- 顶部栏左侧补上 Somnus 图标和标题，不再只有空白文字。
- DSH Web 启动引导的 `HARNESS` / `Loading plugins…` 替换为 `Somnus` / `正在启动 Somnus…`。
- 截图：[somnus-dsh-final.png](images/somnus-dsh-final.png)。

## 23. 顶部应用菜单（2026-11-19）

- 顶部栏补齐 `切换侧栏 / 应用 / 编辑`，与 Harness 顶部菜单结构一致。
- `应用`：重新加载、退出。
- `编辑`：撤销、重做、剪切、复制、粘贴、全选。
- 菜单为 Somnus 自绘，位于 40px 标题栏内，不会再和窗口控制按钮重叠。
- 截图：[somnus-dsh-menubar.png](images/somnus-dsh-menubar.png)、[somnus-dsh-appmenu.png](images/somnus-dsh-appmenu.png)。

## 24. 对话区与启动加载收口（2026-11-19）

- 隐藏 DSH 右侧边栏（工作区文件/终端/浏览器）和 `管理目录` 入口，对话区恢复全宽，不再被右侧面板压住或截断。
- 隐藏右侧边栏开关、分栏、新标签页等按钮。
- 启动引导页 `[data-dsh-boot]` 在 HTML 层面直接隐藏，启动时只保留 Somnus 自己的加载动画。
- 截图：[somnus-dsh-conversation.png](images/somnus-dsh-conversation.png)。

## 25. 恢复 DSH 右侧栏（2026-11-19）

- 恢复 DSH 右侧栏：工作区文件、终端、浏览器、更多工具。
- 默认窗口加宽到 1440×900，右侧栏打开时对话区仍有足够宽度，不再被覆盖或截断。
- 只保留 `管理目录` 隐藏；右侧栏开关、分栏、新标签页等恢复。
- 截图：[somnus-dsh-sidebar-right.png](images/somnus-dsh-sidebar-right.png)。

## 26. 文档库 HTTP 通道（2026-11-19）

- iframe 文档页不再依赖 Electron preload，改为走 `/api/assistant/documents`。
- 个人文档：可新建文件夹/文本文件、导入、删除（移动到个人文档 `.trash`，不直接永久删除）。
- 共享文档：只读，只允许列表和读取；不提供新建、导入、删除。
- 个人目录由 `SOMNUS_DOCUMENTS_DIR` 指向原 `%APPDATA%\RespiratoryViewer\documents`，共享目录由 `SOMNUS_SHARED_DOCUMENTS_DIR` 指向 `resources/shared-documents`。
- 后端已重新打包，文档页在 iframe 内可直接使用。
- 截图：[somnus-dsh-documents.png](images/somnus-dsh-documents.png)。

## 27. 发送键与 Somnus 身份（2026-11-20）

- 发送键改为浅绿色 `#BFE3D1`，悬停 `#A9D8C1`。
- DSH 系统提示词身份 `You are an AI agent powered by DeepSeek Harness.` 替换为 `You are Somnus, an AI coding assistant.`。
- 新建会话实测回复为“我是 Somnus”，不再自称 DeepSeek Harness。
- 截图：[somnus-dsh-chat-somnus.png](images/somnus-dsh-chat-somnus.png)。

## 28. IM 机器人插件接入（2026-11-20）

- 将本机可用的 `@xmanrui/dsh-im` 5.10.0 安装到 Somnus 的 DSH profile。
- 兼容性标记扩展到 DSH `0.2.2-rc.2`。
- 侧栏直接出现插件自己的 `IM机器人` 面板，支持微信、飞书、钉钉、企业微信、QQ、Slack、Telegram、Discord、WhatsApp、iMessage、邮箱。
- 插件 UI 中 `DeepSeek Harness` / `Harness` / `DSH-IM` 替换为 Somnus / Somnus IM。
- 侧栏顺序保持：主页、文档、工具、配置中心、IM机器人、插件、自动化任务。
- 截图：[somnus-dsh-im.png](images/somnus-dsh-im.png)。

注意：插件文件安装在用户 profile 的 `node_modules/@xmanrui/dsh-im`，不是 app.asar 内；换机器或重装 profile 时需要重新分发该插件。

## 29. 波形分析页高度修复（2026-11-20）

- 现象：工具 → 波形分析只剩顶部筛选条，下面整块空白。
- 原因：`analysis-workspace-panel` / `analysis-workspace-frame` 高度塌成 150px。
- 修复：embed 外壳给分析面板设置 `height: calc(100vh - 36px)`，iframe 高度 100%。
- 截图：[somnus-dsh-waveform.png](images/somnus-dsh-waveform.png)。

## 30. Codex ACP 接入（2026-11-20）

- 新增 `lib/acp-host.mjs`：独立 ACP Host，管理 Codex ACP 子进程，提供本地 HTTP/SSE。
- DSH 启动时自动拉起 ACP Host，端口和 token 通过 `somnus:acp:info` 暴露给渲染层。
- 侧栏新增 `Codex` 页面，可直接和 Codex ACP 对话。
- 已验证 ChatGPT 登录、`session/new`、`session/prompt`、流式文本和用量返回。
- Codex 模型：`gpt-6.2-sol`。
- 截图：[somnus-dsh-codex.png](images/somnus-dsh-codex.png)、[somnus-dsh-codex-chat.png](images/somnus-dsh-codex-chat.png)。

当前是独立 Codex 会话页，还不是 DSH 主对话里的按会话 Agent 切换；下一步再做会话选择器与路由。

## 31. Codex Agent 切换与模型选择（2026-11-20）

- Codex 页顶部增加 `Codex / Somnus` Agent 胶囊。
- `Somnus` 胶囊会切回 DSH 新会话；`Codex` 保持 ACP 会话。
- 右上角增加 Codex 模型下拉，模型列表来自 ACP `session/new` 的 `models/configOptions`。
- 当前 ChatGPT 账户只暴露一个模型：`6.2 Sol`。
- 截图：[somnus-dsh-codex-agents.png](images/somnus-dsh-codex-agents.png)。

仍然是“页面级 Agent 切换”，还不是 Vibex 那种同一个输入框内按会话切换。

## 32. Codex 作为 DSH Provider 的尝试（2026-11-20）

尝试把 Codex 作为第二个 provider 注入 DSH `llm-pi-ai`：

- 新增 `somnus-acp` provider，`api: openai-completions`，指向 ACP Host
- ACP Host 增加 `/v1/chat/completions` 兼容端点
- 结果：Somnus 模型恢复正常，但 Codex provider 没有出现在 DSH 模型选择器里
- 说明 DSH 当前的 provider 选择器只展示活动 provider 的模型，不展示并列 provider

因此统一输入框必须走 DSH 会话适配层，单纯加 provider 不可行。

## 33. Codex 并入 Somnus Provider 的第二次尝试（2026-11-20）

- 把 Codex 作为 Somnus provider 的模型（不是第二个 provider）
- provider 改为 `openai-completions`
- 后端 `/provider/chat/completions` 对 `model=codex` 转发到 ACP Host
- ACP Host 增加 OpenAI 兼容 `/v1/chat/completions`
- 结果：Somnus 模型正常，Codex 仍未出现在 DSH 模型列表
- 说明 DSH 的模型选择器只读取了 provider 的默认模型集合，额外注入没有生效

当前可验收：左侧栏、Codex 页、Agent 胶囊、Codex 模型下拉、ACP 对话。
统一输入框仍需改 DSH 会话层，provider 方案已排除。

## 34. DSH 主会话 + Codex MCP 子 Agent（2026-11-20）

- 新增 `resources/somnus/acp-mcp.mjs`：MCP stdio 桥，暴露 `codex` 工具，内部调用 ACP Host。
- DSH Host 自动注册 `somnus-codex` MCP server，传入 ACP URL/token。
- 输入框工具栏新增 `Codex` 按钮：点击后插入“使用 codex 工具处理：”，这一轮由 DSH 主 Agent 调用 Codex。
- Codex 结果写回同一条 DSH 会话，左侧栏和主会话保持不变。
- 实测：DSH 主会话调用 Codex 返回“我是 Codex……”，历史连续。
- 截图：[somnus-dsh-codex-tool.png](images/somnus-dsh-codex-tool.png)。

限制：目前 Codex 的工具/审批事件只以文本结果回传，还没有映射成 DSH 工具卡片；下一步补事件映射。

## 35. Codex 工作区与执行结果（2026-11-20）

- Codex 默认工作目录改为 DSH 的 `default-workspace`，不再在系统临时目录执行。
- 实测 `Get-Location` 返回 `C:\Users\Administrator\Documents\deepseek-harness\default-workspace`。
- 输入框 `Codex` 按钮增加激活态。
- Codex 执行命令的结果会写回同一条 DSH 会话。
- 截图：[somnus-dsh-codex-exec.png](images/somnus-dsh-codex-exec.png)、[somnus-dsh-codex-cwd.png](images/somnus-dsh-codex-cwd.png)。

## 36. 输入框 Agent 自动路由（2026-11-20）

- 输入框右下角新增 `Somnus / Codex` 切换。
- 选 Codex 后发送，会自动加上 ACP 委派指令，用户不需要手输前缀。
- 实测：选 Codex，输入“运行 Get-Location，只回答目录”，结果写回同一条 DSH 会话。
- 切回 Somnus 后继续普通对话。
- 截图：[somnus-dsh-agent-switch.png](images/somnus-dsh-agent-switch.png)。

仍需补：Codex 工具/审批原生卡片、其他 ACP Agent。

## 37. ACP 工具事件验证（2026-11-20）

抓取 Codex ACP 原始 `session/update` 后确认：

- `tool_call`：`Get-Location`，`kind: execute`
- `tool_call_update`：终端输出、`status: completed`
- `session/request_permission`：权限请求
- ACP Host 现在会汇总为 `tools` 数组，随 `/chat` 的 `done` 事件返回
- MCP 桥会把执行记录附加到结果文本

当前审批仍是自动批准（`auto-approved`），还没有交互式审批。

## 38. 多 ACP Agent 切换（2026-11-20）

- 右下角扩展为 `Somnus / Codex / CodeBuddy`
- CodeBuddy 使用随包 `resources/agents/codebuddy`，通过 ACP `--acp` 启动
- MCP 桥新增 `codebuddy` 工具，按选择的 Agent 自动路由
- 截图：[somnus-dsh-agents-three.png](images/somnus-dsh-agents-three.png)

CodeBuddy 首次使用需要它自己的登录态；未登录会返回 ACP 错误。

## 39. 右下角 Codex 模型选择（2026-11-20）

- `Codex` 激活后，右下角显示 ACP 模型下拉（当前 `6.2 Sol`）。
- 选择结果通过 `somnus:acp:model` 写入临时文件，MCP 桥在调用时读取并传给 ACP Host。
- 切换器现在是：`Somnus / Codex / CodeBuddy / Codex 模型`。
- 截图：[somnus-dsh-agent-model.png](images/somnus-dsh-agent-model.png)。

## 40. ACP 审批策略（2026-11-20）

- 右下角新增审批策略选择：`自动批准 / 只读`。
- 策略写入临时文件，ACP Host 读取后决定 `session/request_permission`：
  - 自动批准：`allow_once`
  - 只读：`cancelled`
- 审批结果记录为 `auto-approved` / `denied`，随执行记录回传。
- 截图：[somnus-dsh-approval.png](images/somnus-dsh-approval.png)。

交互式“弹窗批准”还没有；当前是策略级控制。

## 41. 逐条审批（2026-11-20）

- 新增 `询问` 审批模式：`自动批准 / 询问 / 只读`。
- Codex 请求权限时，ACP Host 暂存审批并通过 `/approvals` 暴露。
- DSH 右下角轮询，弹出允许/拒绝对话框，结果回传 ACP。
- 工作区内的写入按 `workspace-write` 策略直接执行，不弹审批；工作区外才会触发。
- 已清理测试文件 `somnus-approval-test.txt`。

## 42. CodeBuddy 接入与 ACP Host 容错（2026-11-20）

- ACP Host `/agents` 现在返回 `Codex` 和 `CodeBuddy Code`。
- CodeBuddy 未登录时返回 `502 Authentication required`。
- Host 增加顶层请求容错：单个 Agent 初始化失败不会让整个 ACP Host 退出。
- 已验证失败后 `/agents` 仍可访问，DSH 主会话不受影响。
- 右下角 `CodeBuddy` 已可选；首次使用需要 CodeBuddy 自己的登录态。

## 43. DSH ACP LLM Adapter（2026-11-20）

- 新增 `resources/somnus/somnus-acp-adapter.mjs`，通过 `ctx.llm.registerAdapter(['somnus-acp'], ...)` 注册。
- Adapter 直接调用 ACP Host `/chat`，把 ACP 流式文本映射为 DSH `StreamChunk`。
- 暴露模型：`codex`、`codebuddy`。
- DSH 模型菜单已验证出现：
  `ACP Agents / Codex / CodeBuddy Code`
- 这条路径不再经过 DSH 主 Agent 的 MCP 工具，是 B 方案的核心。
- 下一步：把右下角 Agent 切换直接切到该 provider/model，替换现有 MCP 委派。

## 44. 直接 ACP 接管完成（2026-11-20）

- 右下角 `Somnus / Codex / CodeBuddy` 已改为直接调用 `ctx.modelDirectories.directoryFor(sessionId).select(...)`。
- 选 Codex/CodeBuddy 会直接切到 `somnus-acp` provider，不再走 MCP 委派。
- 实测 Codex `Get-Location` 在 DSH 主会话直接执行，模型标签变为 `Codex`。
- 审批弹窗由 ACP Host `/approvals` 驱动，允许后 Codex 继续执行并返回目录。
- 截图：
  [somnus-dsh-direct-acp.png](images/somnus-dsh-direct-acp.png)、
  [somnus-dsh-direct-acp-approved.png](images/somnus-dsh-direct-acp-approved.png)。

剩余：Codex 工具调用还没有映射成 DSH 原生工具卡片，目前通过审批弹窗和文本结果呈现。

## 45. 直接 provider 切换验证（2026-11-20）

- DSH 模型菜单出现 `ACP Agents / Codex / CodeBuddy Code`。
- 选中 `ACP Agents / Codex` 后，DSH 回合直接走 `somnus-acp` adapter，不经过 MCP。
- 已实测 `Get-Location` 直接执行、审批弹窗、允许后返回目录。
- 右下角自定义切换器读取 `modelDirectories` 服务时在 plugin context 中拿不到实例，会自动回退到原来的 MCP 委派；DSH 原生模型菜单不受影响。
- 下一步：用 DSH 提供的 hook/服务注入方式接入 `modelDirectories`，让右下角按钮也直接切 provider。

## 46. 右下角直接切换完成（2026-11-20）

- 通过 `ctx.inject(['modelDirectories'], ...)` 取得模型目录服务。
- 右下角 `Somnus / Codex / CodeBuddy` 已直接调用 `directoryFor(sessionId).select(...)`。
- 实测切换：
  - 当前 Codex -> 点 Somnus -> `deepseek-flash`
  - 点 Codex -> `Codex`
- 选中 Codex 后 DSH 回合直接走 `somnus-acp` adapter，不再 MCP。
- 审批弹窗、允许后结果写回同一条 DSH 会话。
- 兜底：找不到 Somnus 分组时使用默认 `vvman-company/deepseek-flash`。

## 47. 移除重复的自定义 Agent 条（2026-11-20）

- DSH 原生模型菜单已经能切 `ACP Agents / Codex / CodeBuddy`，右下角自定义 Agent 条是重复入口。
- 已移除 `conversation.input.right` 的 `Somnus / Codex / CodeBuddy` 条。
- 现在只用 DSH 原生模型选择器；左下角仍保留模型/Agent 当前值。
- 截图：[somnus-dsh-native-model.png](images/somnus-dsh-native-model.png)。

审批策略条也随自定义条移除；ACP Host 仍支持 `auto/ask/readonly`，默认 `auto`。

## 48. 按 Agent 分组的模型与推理强度（2026-11-20）

- ACP adapter 拆成两个 provider：`somnus-codex`、`somnus-codebuddy`。
- DSH 模型菜单按 Agent 分组：
  - `Codex`：6.2 Sol、6.2 Astra、6.1 Terra、6.1 Sol、6 Astra、6 Sol、6 Luna、5.6 Sol、5.6 Terra、5.6 Luna
  - `CodeBuddy Code`
  - `Somnus`
- Codex 模型带推理档位：Low / Medium / High / Xhigh / Max / Ultra。
- adapter 把 `reasoningEffort` 传给 ACP Host，Host 通过 `session/set_config_option` 设置 `reasoning_effort`。
- 截图：[somnus-dsh-grouped-models.png](images/somnus-dsh-grouped-models.png)。

## 49. 推理等级入口（2026-11-20）

- DSH 模型根菜单现在显示 `推理等级` 行，不再只有模型。
- 每个 Codex 模型带 `reasoning.defaultEffort` 与 `reasoning.efforts`：
  Low / Medium / High / Xhigh / Max / Ultra。
- 底部模型按钮会显示类似 `6.1 Sol Low`。
- 截图：[somnus-dsh-reasoning.png](images/somnus-dsh-reasoning.png)。

## 50. 按 Agent tab 的自定义模型选择器（2026-11-20）

- 隐藏 DSH 原生单列模型菜单，改为自定义 tabbed picker。
- 顶部 Agent tabs：`Codex / CodeBuddy / Somnus`。
- 每个 tab 只列该 Agent 的模型。
- 底部 `推理等级` 行，支持 Low/Medium/High/Xhigh/Max/Ultra。
- 选择通过 `ctx.remote.session.selectModel` 写回 DSH 会话。
- 截图：[somnus-dsh-tabbed-models.png](images/somnus-dsh-tabbed-models.png)。
- 注意：面板使用 portal + `role="menu"`；不要加回 `aria-label="选择模型"`，会被隐藏原生菜单的 CSS 误伤。

## 51. 选择器定位修正（2026-11-20）

- 面板改为按触发按钮坐标定位：`left = rect.right - 300`，`top = rect.top - 440`。
- 使用 portal 到 `body`，避免 composer 的 overflow 裁剪。
- 修正了之前 `right/bottom` 相对视口导致“跑到左下角”的问题。
- 截图：[somnus-dsh-tabbed-anchored.png](images/somnus-dsh-tabbed-anchored.png)。

## 52. 每个 Agent 独立推理等级（2026-11-20）

- Codex：Low / Medium / High / Xhigh / Max / Ultra。
- CodeBuddy：Low / Medium / High。
- Somnus：Low / Medium / High。
- 每个 tab 下独立显示“推理等级”行，不是只有 Codex。
- 截图：[somnus-dsh-agent-reasoning.png](images/somnus-dsh-agent-reasoning.png)。

## 53. 固定高度与滚动模型列表（2026-11-20）

- 面板最大高度 `340px`，接近 Vibex 的窗口高度。
- 模型列表 `flex: 1 1 auto; min-height: 0; overflow-y: auto`，模型多时内部滚动。
- tabs 和“推理等级”固定在顶部/底部，不随列表滚动。
- 截图：[somnus-dsh-scroll-models.png](images/somnus-dsh-scroll-models.png)。

## 54. 选择器开关与首页鲸鱼（2026-11-20）

- 模型按钮改为点击切换：第一次打开，再点关闭。
- 首页像素鲸鱼动画隐藏：`[data-home-whale], .JgOtAa_canvas { display:none !important; }`。
- 验证：第一次点击面板 `1`，第二次 `0`；鲸鱼 canvas 计算样式为 `none`。

## 55. VibeX 风格选择器（2026-11-20）

- 点击面板外部关闭：document 捕获 `pointerdown`，命中 `.somnus-model-panel` / 触发按钮之外的区域即关闭。
- 增加搜索框、Agent 分组标题与模型数、模型图标、收藏星标、`配置 Agent` 底部入口。
- 保留 Agent tabs、固定高度滚动、推理等级。
- 鲸鱼 canvas 用 CSS 隐藏。
- 截图：[somnus-dsh-vibex-picker.png](images/somnus-dsh-vibex-picker.png)。

## 56. Somnus 默认在左与配置跳转（2026-11-20）

- Agent tab 顺序改为 `Somnus / Codex / CodeBuddy`，Somnus 默认选中。
- 总选择器默认显示 Somnus 的 `deepseek-flash`。
- `配置 Agent` 调用 `ctx.layout.selectPanel('somnus-config')`，跳到左侧“配置中心”。
- 截图：
  [somnus-dsh-somnus-first.png](images/somnus-dsh-somnus-first.png)、
  [somnus-dsh-config-jump.png](images/somnus-dsh-config-jump.png)。

## 57. 移除左侧 Codex 页面（2026-11-20）

- 左侧栏删除独立的 `Codex` 页签，Codex 只保留在模型选择器和配置中心。
- 侧栏顺序：主页、文档、工具、配置中心、IM 机器人、插件、自动化任务。
- 截图：[somnus-dsh-no-codex-page.png](images/somnus-dsh-no-codex-page.png)。

## 58. 删除会话与重复模型入口（2026-11-20）

- 输入框右侧新增 `删除` 按钮，确认后调用 `ctx.uiWorkspace.archiveSession(sessionId, { stopActivity: true })`。
- 删除是从会话列表归档移除，不是物理抹除。
- 原生 `请选择模型` 控件已隐藏，只保留自定义模型选择器。
- 截图：[somnus-dsh-delete-session.png](images/somnus-dsh-delete-session.png)。

## 59. 会话菜单：归档 + 彻底删除（2026-11-20）

- 移除输入框旁的 `删除` 按钮。
- 在会话右键菜单注入 `彻底删除会话`，带图标并对齐原生菜单项。
- 原生 `归档会话` 保留。
- 彻底删除：二次确认 → 删除 `dsh-home/sessions` 与 desktop profile 下对应 session 目录 → 再归档移出列表。
- 截图：[somnus-dsh-purge-menu.png](images/somnus-dsh-purge-menu.png)。

修复：菜单项之前先 purge 再 archive，且 `ctx.uiWorkspace` 未注入导致归档失败，列表不消失。现在通过 `ctx.inject(['uiWorkspace'])` 取服务，先归档再删除目录；已用测试会话验证删除后列表移除。
