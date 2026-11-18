# Somnus 桌面版与 DSH Next

Windows 桌面版以 [`xue-ding-e/DSH-Next`](https://github.com/xue-ding-e/DSH-Next) 的 `f2483c6d26104b3594cb0e22f56c0331b55dfffe` 为基座。当前构建使用该提交的 `0.2.2-rc.2.20261115.31` Windows x64 发布产物，沿用上游的 Electron、Desktop Host、Web 界面和权限实现。`next-release.json` 固定来源、版本及上游安装程序的 SHA-256。

## 构建 Windows 可运行目录

安装 Node.js 24 和项目的 Electron 构建依赖。先从 `page_design/frontend` 运行 `pnpm build`。下载固定版本的上游安装程序，用 7-Zip 解包至临时目录。脚本需要包含 `DSH Next.exe` 和 `resources/app.asar` 的目录。通过以下命令冻结 `launcher.py` 并构建 Somnus。

```powershell
python build_electron.py --next-extracted <解包后的上游应用目录> --next-installer <上游安装程序完整路径>
```

已经冻结后端时可以跳过重建。

```powershell
python build_electron.py --shell-only --next-extracted <解包后的上游应用目录> --next-installer <上游安装程序完整路径>
```

`stage-next.mjs` 将上游版本、提交和修改锚点与发布物逐一比对，构建后输出独立的 `win-unpacked` 路径。先用隔离配置验收。

```powershell
& '<输出路径>\Somnus.exe' '--user-data-dir=D:\VVFLY\Somnus-Explorer\.tmp\somnus-next-test-profile'
```

此参数隔离 Electron 配置、Harness 和 Somnus 后端数据。验收完成后退出正在运行的 Somnus，保留原有 `dist/electron/win-unpacked` 备份，然后将通过验收的目录移入该位置。

## 应用行为

- `Somnus.exe` 先打开原 Somnus 工作台，沿用 Windows AppUserModelID、原图标以及旧版配置目录。原版设置过的「打开时进入聊天」会复制到工作台的隔离浏览器会话。
- Desktop 主进程启动 `launcher.py` 生成的本机服务。原工作台和波形共用实际服务端口，原工作台仍能访问历史对话和已配置的自定义 ACP Agent。
- Somnus 负责工作台、托盘、启动、恢复及账号入口。固定提交提供内部 Host、配置加载和 Agent 组件。
- 内部 Host 使用当前 Somnus Profile 的 `engine/harness` 目录，读取 Somnus 已有的并发和子 Agent 配置。各 Somnus Profile 独立维护运行时配置。
- Database 和 Text-to-SQL 由应用启动时以固定配置加入 Host，应用层限制其运行参数和数据权限。
- 本机版本使用 Somnus 产品标识，使用单独的协议和 Profile。缺省上游更新源停用，等待 Somnus 发布通道提供此桌面架构的后续版本。

`validate.mjs`、`stage.mjs` 和 `upstream.json` 对应 早期的 `anywhere-labs/dsh-desktop` 验证路线。该版本与上面的 `xue-ding-e/DSH-Next` 发布物各自独立。

