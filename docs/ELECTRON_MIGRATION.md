# Electron 桌面版构建

Somnus 的 Electron 窗口启动随包附带的 FastAPI 服务，并通过回环地址打开工作台。服务使用原有 `launcher.py` 入口，成功监听后报告实际端口，窗口关闭后通过标准输入管道通知服务退出。Windows 使用 x64 构建，macOS 使用 Apple Silicon 和 Intel 两种原生构建。

## 本机打包

准备 Python 3.12、Node.js 24 和 pnpm 11.25.0。在 Windows x64 或相应架构的 Mac 上，从项目根目录运行：

```sh
python -m pip install -r requirements-electron.txt
pnpm --dir page_design/frontend install --frozen-lockfile
pnpm --dir page_design/frontend build
pnpm --dir electron install --frozen-lockfile
python build_electron.py
```

Windows 生成 `dist/electron/Somnus-Setup-<版本>-windows-x64.exe`。使用 `python build_electron.py --dir` 可只构建可运行目录，启动 `dist/electron/win-unpacked/Somnus.exe`。目录内的 `resources/backend/SomnusBackend.exe` 由 Electron 启动。请将整个目录一起移动。macOS 生成 `dist/electron/Somnus-<版本>-electron-macos-arm64.zip` 或 `...-macos-x64.zip`。解压后可把 `Somnus.app` 移到「应用程序」。历史试用包仍使用发布时的文件名。Mac 试用包使用临时签名，正式分发需要配置 Developer ID 签名与 Apple 公证。Windows 试用安装包暂未签名。

在 GitHub Actions 中手动运行 **Electron desktop trial build**，可在 Windows x64、Apple Silicon 和 Intel Mac 分别构建并下载试用产物。工作流验证打包的后端启动和退出、界面资源及合成 CSV 筛查，macOS 作业还会解包检查架构和签名。面向使用者分发前，在目标系统双击启动并检查工作台、文件打开和退出。

## Windows 随附 Codex

需要直接使用 ChatGPT 登录的构建，需在桌面运行目录下提供 `resources/agents/codex/node.exe` 和 `resources/agents/codex/node_modules/@agentclientprotocol/codex-acp/dist/index.js`。保留适配器的 `package.json`、完整 Windows x64 依赖树和第三方许可。当前运行目录使用固定版本的 Codex ACP 2.6.0 和随附的 Node.js，用户无需另外安装 npm。重新构建桌面目录后，将已准备的运行组件连同许可放回相同位置。组件缺失时，仍可检测本机安装或手动接入其他适配器。

首次点击「使用 ChatGPT 登录」会显示 Windows 确认框。Codex 需要登录时在系统浏览器打开授权页，凭据由 Codex 保存在 Somnus 桌面配置下的独立 `codex-home` 目录。

## 数据与配置

Windows 托盘提供「运行配置」和「故障恢复」。默认配置沿用既有路径。新建配置分别保存模型连接、外部 Agent、Skill、MCP、个人插件、DSH 账号及插件组合，以及该配置的会话、扫描和上传数据。新配置从空白开始，切回默认配置可继续使用原来的记录。随应用安装的工具、文档和 DSH 运行组件由配置共用，用户选择的工作目录仍指向磁盘上的原目录。

Somnus 启动失败时会显示独立恢复窗口，也可在启动时传入 `--recovery`。恢复窗口可退回上次成功启动的配置、在安全模式下重试、停用或恢复当前配置的 DSH 插件组合，以及导出启动诊断。诊断文件只包含启动状态、应用版本及系统信息。停用 DSH 扩展会备份当前 ACP/Web 的插件清单和补丁。安全模式跳过本机环境文件，暂时关闭外部 Agent、Dot 接入和插件开发入口，并继续使用当前配置的数据目录。

默认目录沿用本地存储路径，支持用 `AI_AGENT_DATA_DIR` 指定其他位置。

| 系统 | 默认数据与配置目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\VVFLY\Somnus` |
| macOS | `~/Library/Application Support/VVFLY/RespiratoryViewer` |

Windows 首次启动时会沿用旧 `RespiratoryViewer` 目录中的配置和历史。旧版 `.env` 若放在 EXE 同级目录，请在本机复制到上表的数据目录，模型与数据源配置会从那里加载。安装包不含 `.env`、密钥、原始记录或本机数据库。旧的 Windows 打包脚本和 macOS 原生窗口构建脚本可继续维护已有试用环境。
