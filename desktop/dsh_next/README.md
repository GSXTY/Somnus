# Somnus 的 DSH Next 桌面构建

当前 Windows 基座是 `xue-ding-e/DSH-Next`。构建和本机验收步骤见 [Windows 构建](NEXT_BUILD.md)。

## 早期的 anywhere-labs 源码验证

基线是 [DSH NEXT v2.0.23-next](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.23-next) 的签名提交 `59dce7d3289bb875415430082e75ee3b23326a54`，桌面包使用 DeepSeek Harness Web `0.2.2-rc.3`。`upstream.json` 锁定桌面源码和依赖版本，验证脚本从该提交的 Git tree 读取并核对 `deepseek-harness` 子模块提交。

## Windows 源码验证

从 Somnus 仓库运行。上游构建需要 Node.js `>=24.9.0`、Corepack 和 Yarn `4.18.0`。使用专用检出，当前 Somnus 工作台和已安装 DSH NEXT 的个人数据与它分开。

```powershell
git clone --branch v2.0.23-next --recurse-submodules https://github.com/anywhere-labs/dsh-desktop.git .tmp/dsh-next-source
node desktop/dsh_next/validate.mjs source .tmp/dsh-next-source
Push-Location .tmp/dsh-next-source
corepack yarn install --immutable
Pop-Location
node desktop/dsh_next/validate.mjs check .tmp/dsh-next-source
node desktop/dsh_next/validate.mjs brand .tmp/dsh-next-source
node desktop/dsh_next/validate.mjs check .tmp/dsh-next-source
node desktop/dsh_next/validate.mjs dev .tmp/dsh-next-source
```

`check` 运行上游 `check:next`，包括 Host、Web 前端、恢复与类型检查。`brand` 在专用检出应用 Somnus 名称、窗口标题、图标和浅深主题。`dev` 运行上游 `dev:next`，每次使用新建的 `DSH_DESKTOP_NEXT_HOME`。上游应用内数据目录选择优先于环境变量，因此这个命令会拒绝已有选择的检出。上游远程控制插件及其身份另外管理。本预览范围只覆盖本机桌面与本机 Host。

也可以对已安装 DSH NEXT 的 `resources/app.asar` 做只读核验。此命令使用 Somnus 当前 Electron 构建依赖提供的 ASAR 读取器。

```powershell
node desktop/dsh_next/validate.mjs installed '替换为 DSH NEXT 安装目录\resources\app.asar'
```

## 迁移边界

| 层 | 接入位置 |
| --- | --- |
| Electron 与 Host | 上游 `src/main.ts`、`NextDesktopRuntime` 和 `@deepseek-ai/dsh/profile-boot` 管理桌面、Profile、恢复和 Web 前端启动。源码覆盖只改名称、主窗标题和图标。 |
| 品牌与主题 | 上游客户端插件在 Cordis 生命周期中通过 `ctx.theme.overrideTokens` 应用浅色、深色值。侧栏名称和图标由上游单例品牌插槽的既有注册提供，后续应在组合层替换其单一提供方。 |
| 公司面板 | 通过上游 `sidebar.panellist` 和设置插槽接入。现有 Somnus `launcher.py`、公司数据接口和波形页面作为兼容边界保留，用同一明确版本逐项接入。 |
| 会话、Agent 和数据工具 | 尚待接入并对照验收。保持现有代理选择、会话授权和公司数据库／Text-to-SQL 两个受保护 MCP 的调用合同与权限，先用隔离环境检查会话和工具能力，再接生产数据。 |

Somnus 当前可运行目录仍由原来的 `build_electron.py` 生成。这里的源码预览用上游运行路径，迁移期间用现有桌面版访问原会话、插件和工程记录。
