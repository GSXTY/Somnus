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

在目标系统检查工作台、文件打开和退出。Windows 可用 `python tests/electron_package_smoke.py dist/electron/win-unpacked/resources/backend/SomnusBackend.exe` 验证本机服务。签名安装包和应用内更新的配置见 [维护与发布](MAINTAINER.md)。

## Windows 随附 Codex

需要随桌面版提供 Codex 时，将经审核的 Windows x64 运行组件置于桌面运行目录。使用 `resources/agents/codex/node.exe` 和 `resources/agents/codex/node_modules/@agentclientprotocol/codex-acp/dist/index.js`，保留适配器的 `package.json`、完整依赖树及第三方许可。若组件缺失，可检测本机安装或手动接入适配器。

首次点击「使用 ChatGPT 登录」会显示 Windows 确认框。Codex 需要登录时在系统浏览器打开授权页，凭据由 Codex 保存在 Somnus 桌面配置下的独立 `codex-home` 目录。

## 数据与配置

默认目录沿用本地存储路径，支持用 `AI_AGENT_DATA_DIR` 指定其他位置。

| 系统 | 默认数据与配置目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\VVFLY\RespiratoryViewer` |
| macOS | `~/Library/Application Support/VVFLY/RespiratoryViewer` |

原 Windows 桌面版的默认数据目录也在这里，已有会话、标记和扫描历史可以继续使用。旧版 `.env` 若放在 EXE 同级目录，请在本机复制到上表的数据目录，模型与数据源配置会从那里加载。安装包不含 `.env`、密钥、原始记录或本机数据库。旧的 Windows 打包脚本和 macOS 原生窗口构建脚本可继续维护已有试用环境。
