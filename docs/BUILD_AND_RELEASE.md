# Somnus 构建与发布

本轮只整理并同步源码，不更新本机程序、不生成安装包、不创建发布 tag。以下命令是后续构建说明。

## 三种不同操作

| 操作 | 入口 | 结果 |
| --- | --- | --- |
| 源码检查 | `python -B tools/source_checks.py` | 语法、目录、类型和回归测试；不构建程序 |
| 本机前端/宿主更新 | `python -B tools/rebuild_next.py --frontend` | 更新已有 `app/resources`，备份 ASAR；不生成安装包 |
| 完整 Windows 程序 staging | `build_electron.py` 加 `--next-extracted` / `--next-installer` | 冻结 Python 后端、组合固定 DSH Next 和 Somnus 覆盖层，生成待验收程序目录 |

当前桌面界面来自 `desktop/dsh_next/client`，宿主来自 `desktop/dsh_next/host`；`page_design/frontend/src` 提供共享 React 界面。不能直接用旧 `build_windows.py`、旧 Electron 默认壳或已删除的旧 CI 工作流替代当前 Next 程序。

## 环境和依赖

Windows x64，Python 3.13，Node.js 24，pnpm 11.25.0。使用项目的两个锁文件，不引用其他 Somnus 工程的依赖目录。构建目录默认是源码目录同级 `SomnusNext-Storage`，可以用 `SOMNUS_DEV_STORAGE` 指定源码目录外的位置。

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-electron.txt -r requirements-test.txt
pnpm --dir page_design/frontend install --frozen-lockfile
pnpm --dir electron install --frozen-lockfile
```

构建机还需准备对应的原生终端依赖和第三方许可。当前 staging 会从已有 `app/resources` 复制可选的 node-pty、Agent、共享文档与许可证，因此**尚不能承诺仅全新 clone 就生成与当前程序完全一致的分发包**。首次正式发布前，应补齐这些资源的可重复获取流程并做干净机器验收；不要把真实用户配置或工作文档当成内置资源复制。

## 固定上游输入

上游仓库为 `xue-ding-e/DSH-Next`，提交 `f2483c6d26104b3594cb0e22f56c0331b55dfffe`、版本 `0.2.2-rc.2.20261115.31`。下载地址及安装包 SHA-256 在 `desktop/dsh_next/next-release.json`。解包该安装程序，保留含 `DSH Next.exe` 和 `resources/app.asar` 的完整应用目录；把未修改的 ASAR 放到 `desktop/dsh_next/upstream/app.asar`，按照同目录 `manifest.json` 校验。

安装包与原始 ASAR 的校验值分别是：

```text
adff1317548f436cb2c4072bc57ad4b6e7fc8da910566bb41bfcb4b72cbc7525
575dacb11c91686c635460839f7a2a71c38b719349f5b0312ffe65b696e62cd2
```

这些二进制不进入源码仓库。已改过的 Somnus ASAR 不能充当原始上游输入。

## 后续构建顺序

1. 从已经合并并验收的 main 提交开始；版本号变更也先走 PR，同步 `app_version.py` 与 `electron/package.json`。
2. 安装锁定依赖，准备并校验固定上游输入；执行源码检查及原生覆盖层测试。
3. 构建共享前端，然后构建后端和 Next staging：

```powershell
python -B tools/source_checks.py --native
pnpm --dir page_design/frontend build
python -B build_electron.py --next-extracted C:\build-inputs\dsh-next --next-installer C:\build-inputs\dsh-next-installer.exe
```

`build_electron.py` 自带平台检查门禁。后端在外置存储的 `artifacts/build/electron/backend/SomnusBackend`；staging 在 `cache/tmp/somnus-next-stage-*/win-unpacked`，脚本输出实际目录并写入相邻 `stage.json`。staging 仍然只是完整程序目录，不等于可分发安装包。

4. 使用隔离用户目录验收启动、Provider、会话、数据库权限、主页、文档、SQL、深度分析、波形与插件，检查终端依赖和许可证；不得用真实用户档案跑自动化验收。
5. 用户明确需要分发时，再对已验收的 **Next staging 目录**制作 NSIS 安装程序。应使用 electron-builder 的 `--prepackaged` 路径，并单独核对 Next 的 appId `com.vvfly.somnusnext`、安装/卸载、升级和用户数据目录。现有默认配置仍包含旧 appId，此次没有新增或验证安装包配方，不能直接把默认配置当作已验证的 Next 发布流水线。
6. 测试安装/升级后生成 SHA-256、记录源码提交和上游版本、整理发布说明；经项目负责人授权再创建 tag、上传到 `GSXTY/Somnus-Releases`。源码同步到 `GSXTY/Somnus` 不等于发布安装包。

目前 GitHub 仅启用源码检查工作流；PR、合并和 tag 都不会自动打包发布。以后要启用发布自动化，需单独 PR 实现上述 Next 分发流程，并验收后启用。
