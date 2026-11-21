# SomnusNext 构建与本机更新

本文记录基于固定发布归档的兼容更新方式。完整上游源码已另行接入 `vendor/dsh-next/`，新的隔离源码编译入口和 CI 说明见 [完整源码开发](../../docs/SOURCE_BUILD.md)。源码构建不读取这里的原始 `upstream/app.asar`；现有程序和兼容更新方式保留，不能把新流程的源码检查成功当作完整桌面验收成功。

## 常规更新

固定上游 DSH Next 提交为 `f2483c6d26104b3594cb0e22f56c0331b55dfffe`，版本为 `0.2.2-rc.2.20261115.31`。本地未修改构建输入在 `upstream/app.asar`，版本、来源及 SHA-256 记录在 `upstream/manifest.json`。不要用已修改的 Somnus ASAR 替换该文件。

关闭当前 SomnusNext 后，在项目根目录执行：

```powershell
python -B tools/rebuild_next.py --check
python -B tools/rebuild_next.py
```

修改工作台或配置页时，第二条命令加 `--frontend`，同时运行项目本地 TypeScript、Vite 和页面嵌入生成工具，并把生成页面同步到程序的后端资源目录。

命令从本项目的固定基线和源码重建桌面覆盖层，备份当前 ASAR，再更新 `app/resources/app.asar` 与源码维护的宿主模块。只更新本机可运行目录，不生成安装包或分发压缩包。不需要其他 Somnus 项目的源码或缓存。

默认构建与备份位置为同级 `SomnusNext-Storage`；没有写权限时显式加 `--storage <源码目录外的可写位置>`。依赖从本项目的 `electron/node_modules` 和 `page_design/frontend/node_modules` 读取。重新安装依赖时使用各目录的锁文件和 pnpm；不要使用其他工程的 node_modules 路径。

## Python 后端

ASAR 更新不会重建 Python 可执行程序。修改 Python 后端前，先安装本项目 `requirements-electron.txt` 等构建依赖，并确保工作台页面已构建，再运行：

```powershell
python -B build_electron.py --backend-only
```

输出在外置存储的 `artifacts/build/electron/backend/SomnusBackend`。关闭程序后将该完整目录的内容同步至 `app/resources/backend`。用户配置、数据、事件标记和历史批次不属于后端程序资源，不应被覆盖。

## 首次从上游发布物生成程序目录

`next-release.json` 固定完整上游安装程序的版本、提交、来源与 SHA-256。具备已解包的原始上游 Windows 应用目录、该版本安装程序及冻结后端后，可使用底层 staging：

```powershell
python -B build_electron.py --shell-only --next-extracted <上游应用目录> --next-installer <上游安装程序>
```

该命令生成隔离 staging 目录。验收后仅把完整程序更新到本项目 `app/`；日常使用上述本地覆盖层重建命令。

## 运行与配置

唯一程序入口为本项目 `app/Somnus.exe`，根目录 `启动 SomnusNext.cmd` 指向它。配置、会话和运行状态使用独立的 `%APPDATA%/VVFLY/SomnusNext`。不自动迁移旧 Agent、Provider、API Key 或历史记录。

新会话默认 Somnus，使用原生 DSH。未配置模型供应商时先完成接入；未接入或验证失败的 ACP Agent 不应提供虚构的可选模型。测试可传入 `--user-data-dir=<源码外隔离目录>`，不要使用真实用户档案发送验收模型请求。

Database 与 Text-to-SQL 的保护边界、同源工作台与 `/events` 的服务接口继续保留。当前工作副本的独立 Git 修复和 PR 流程见根目录 `CONTRIBUTING.md`。


完整环境、staging 和安装包边界见 [构建与发布流程](../../docs/BUILD_AND_RELEASE.md)。上述更新与打包命令只在用户明确安排构建时执行；日常修改先通过 PR。
