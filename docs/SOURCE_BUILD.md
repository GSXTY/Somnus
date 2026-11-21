# Somnus 的完整上游源码

## 源码位置

| 内容 | 位置 |
| --- | --- |
| 完整 DSH Next 上游源码 | `vendor/dsh-next/` |
| 上游桌面窗口与启动实现 | `vendor/dsh-next/apps/desktop/src/` |
| 上游桌面 Host 应用 | `vendor/dsh-next/apps/desktop-host/` |
| 上游界面插件 | `vendor/dsh-next/packages/client/` |
| 上游 Agent、工具和运行时 | `vendor/dsh-next/packages/` |
| Somnus 的页面、样式和模型配置定制 | `desktop/dsh_next/client/` |
| Somnus 的宿主与后端接入 | `desktop/dsh_next/host/`、`electron/` |
| Somnus 的共享 React 页面 | `page_design/frontend/src/` |

上游源码通过 Git 子模块固定在 `xue-ding-e/DSH-Next` 的 `f2483c6d26104b3594cb0e22f56c0331b55dfffe`，保留其 MIT 许可证及第三方声明。子模块是完整的独立 Git 源码仓库，不是从旧 ASAR 解出来的文件。

打开根目录 `Somnus-Source.code-workspace` 或直接打开项目文件夹，都可以浏览和搜索 `vendor/dsh-next`。编辑器隐藏的是 Git 元数据、依赖及临时构建缓存，不再隐藏整个 vendor 源码目录。

## 获取源码

新电脑使用：

```powershell
git clone --recurse-submodules https://github.com/GSXTY/Somnus.git SomnusNext
```

已有工作副本使用：

```powershell
git submodule update --init --recursive
```

这两条命令读取当前分支记录的上游提交。功能尚在 PR 中时，应先检出对应的功能分支；main 合并前不会包含新的子模块记录。

## 构建材料与生成物

源码构建的材料应是固定上游源码、Somnus 源码、锁文件中的依赖和工具链；原始 `desktop/dsh_next/upstream/app.asar` 与当前 `app/resources/app.asar` 都不应充当该流程的输入。

编译后仍然可能生成 ASAR，这是 Electron 的正常程序资源格式。本次编译生成的 ASAR 属于中间或最终生成物，与“下载一个旧 ASAR 并依赖它才能重新构建”不同。

原来的 `tools/rebuild_next.py` 是基于固定发布归档的本机更新入口。保留该入口用于现有版本维护，不把它描述为源码构建。现有 `app/` 保持原样，新的构建验证在隔离目录完成。安装包、发布 tag 与 Release 仍需要单独安排。

## 修改与更新

日常 Somnus 页面与功能继续在本项目的自有源码目录修改，并按 `CONTRIBUTING.md` 新建分支、测试、提 PR。上游源码按固定依赖维护，Somnus 的适配在 `desktop/dsh_next/` 留下可审查的记录。

若需要修改上游底层实现，把修改做成受版本控制的 Somnus 源码适配，或在可推送的上游 fork 提交并更新子模块地址与提交。不要把只存在于本机的未提交修改当成别人 clone 后也会获得的功能。

当前适配针对上述固定提交编写。升级上游或切换 fork 时，还需要在同一个 PR 更新来源锁定和兼容性检查；只改下载地址不能代替适配与验证。

上游使用自己的锁文件和 pnpm 版本；Somnus 共享前端、Electron 支持模块也各有锁文件。不要把它们混成一个依赖目录，或用另一个项目的 node_modules 代替安装。

## 构建命令

使用 Node.js 24.9 或更新的 24.x，以及上游锁定的 pnpm 11.28.5。Somnus 自身前端和 Electron 支持模块继续按各自锁文件安装依赖，Python 构建依赖为 `requirements-electron.txt` 和 `requirements-test.txt`。

先检查源码，不联网、不编译：

```powershell
python -B tools/prepare_dsh_source.py --check
node desktop/dsh_next/source-build.mjs --check
```

仅验证源码编译与上游聚合类型检查，不生成完整程序目录：

```powershell
node desktop/dsh_next/source-build.mjs --compile
```

生成供验收的 Windows x64 程序目录，需要先从 Somnus 源码构建前端和 Python 后端：

```powershell
$env:SOMNUS_DEV_STORAGE = 'D:\SomnusBuild'
pnpm --dir page_design/frontend build
python -B build_electron.py --backend-only
$backendDir = Join-Path $env:SOMNUS_DEV_STORAGE 'artifacts/build/electron/backend/SomnusBackend'
node desktop/dsh_next/source-build.mjs --build --storage $env:SOMNUS_DEV_STORAGE --backend-dir $backendDir
```

`--backend-only` 会执行现有平台门禁，再冻结后端。成功后写入 `somnus-backend-build.json`，源码构建检查该记录，并拒绝从当前 `app/` 取后端。pnpm 不在 PATH 或其启动器无法定位时，可给源码构建命令加 `--pnpm-entry <pnpm.mjs 的绝对路径>`；版本仍必须匹配上游锁定版本。

默认工作区在外置存储 `s/f2483c6d2610/`，复制固定源码后应用 Somnus 的入口与适配。不会修改维护用的 `vendor/dsh-next/`。重复构建复用依赖并重新应用自有适配。产物位置与实际状态写入工作区的 `somnus-source-build.json`；编译成功、程序目录生成、实际界面验收是不同状态，不能互相代替。

Windows 的内置 Python 原生模块对深目录仍有限制，Git 长路径设置不能替代 DLL 加载验证。构建入口会在安装依赖前检查预留路径长度；若提示路径过长，用较短的外置存储目录，或传入 `--workspace D:\SomnusBuild\w`。该目录必须位于源码之外，且为空或已有本工具的所有权记录；不会跳过上游文档运行测试。

受限环境下的 `--local-workspace` 只允许使用项目内专属 `.source-build-cache/` 子目录，这是用于诊断的显式例外，不是普通构建的默认位置。该目录不提交 Git；不要把它当作源码。

## CI 与验收

`Source checks` 验证子模块提交、源码与本项目回归。涉及源码构建的 PR 另外触发 `Source compilation`，在干净 Windows runner 中构建共享前端、冻结后端、编译上游并组装 Somnus 程序目录。它只上传构建报告，不上传程序、不创建安装包或 Release。

构建报告里的 `uiAccepted: false` 表示还没有执行实际桌面界面验收。正式分发前仍需检查启动、主页、文档、工具、Provider、ACP、终端、数据权限和安装升级。当前任务不修改已有 `app/`。
