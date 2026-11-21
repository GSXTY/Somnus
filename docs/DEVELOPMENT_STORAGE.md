# SomnusNext 开发目录与产物

| 内容 | 位置 | 是否提交 |
| --- | --- | --- |
| 当前可编辑源码 | 项目根目录各功能文件夹 | 是 |
| 现有运行程序 | `app/Somnus.exe` | 否 |
| 固定上游构建输入 | `desktop/dsh_next/upstream/app.asar` | 否，提交来源与校验清单 |
| 构建结果 | 外置存储 `artifacts/build`、`artifacts/dist` | 否 |
| ASAR 重建临时目录 | 外置存储 `cache/next-rebuild` | 否 |
| 程序备份 | 外置存储 `backups/local` | 否 |
| 用户配置、会话与状态 | `%APPDATA%/VVFLY/SomnusNext` | 否 |
| 批量试验运行结果 | `batch_analysis_trial/runs`、`docker_runs`、`local_output_check` | 否，保留本机 |
| 开发截图 | `docs/images`、根目录波形截图 | 否，保留本机 |

外置存储默认是源码目录同级 `SomnusNext-Storage`。路径逻辑在 `storage_paths.py` 和 `desktop/storage-paths.mjs`；用 `SOMNUS_DEV_STORAGE` 或本机重建命令的 `--storage` 指定源码目录外的位置。

Python 检查使用 `-B`，不重新污染源码目录。不要把运行数据、依赖或二进制当作源码。清理记录见 `SOURCE_BASELINE_CLEANUP.json`，较早的迁移清理记录见 `PROJECT_CLEANUP.json`。

此工作副本原 `.git` 指向旧工程，当前整理使用独立 `.somnus-git`。普通 Git 命令前的一次性修复见 [开发流程](../CONTRIBUTING.md)；新 clone 不需要修复。
