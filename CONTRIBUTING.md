# Somnus 开发流程

从本次源码基线开始，功能、修复、重构和文档修改都采用：**新分支 → 提交 → PR → 检查和审查 → 合并 main**。不要直接向 main 推送，也不要以修改本地 `app` 代替源码提交。

## 每个任务

从干净且最新的 main 创建一个任务分支：

```powershell
git switch main
git pull --ff-only origin main
git switch -c feat/event-comparison
```

分支使用 `feat/`、`fix/`、`refactor/`、`chore/` 或 `docs/` 前缀。一个分支解决一个明确问题；未提交的修改不要混入另一个任务。

完成后运行检查，检查暂存差异，再提交和推送任务分支：

```powershell
python -B tools/source_checks.py
git add <本次修改的文件>
git diff --cached --check
git diff --cached
git commit -m "feat: compare event detection runs"
git push -u origin feat/event-comparison
```

在 GitHub 创建以 main 为目标的 PR，填写变更行为、验证、限制和截图。源码检查必须通过；与修改有关的 Python、桌面、数据接口和算法回归另外执行并记录。原生桌面改动还要运行 `python -B tools/source_checks.py --native` 和必要的实际界面验收。默认 CI 不含上游二进制，不代表原生桌面或完整后端已验收。

审查完成后通过 PR 合并（推荐 Squash），再同步 main、删除任务分支。Agent 可以准备提交、推送分支和创建 PR；合并由项目负责人执行，除非负责人另行明确授权。修改发布版本号、生成安装包、创建 tag、发布 Release 是单独任务。

## GitHub 强制规则

仓库设置入口：<https://github.com/GSXTY/Somnus/settings/rules>。

为默认分支 main 建立启用状态的规则：要求 PR；要求 `source-checks` 成功并与目标分支保持最新；禁止强推和删除；不要给日常开发账号设置绕过规则的权限。多人协作时增加至少一位审查者；只有仓库负责人一人时，不要设置必须由本人无法批准的强制审查人数。

**提交流程文档和 CI 不会自动开启服务器端分支保护。** 当前 GitHub 连接没有管理规则的写入工具，规则需要仓库管理员在上述页面启用。未启用前，本项目按这里的约定操作，但 GitHub 仍可能允许管理员直接推送。

## 当前工作目录的首次 Git 修复

此工作副本原来的 `.git` 指向旧 `Somnus-Explorer` 的元数据；当前环境禁止改写这个文件。整理工作使用独立的 `.somnus-git`，不修改旧项目。

在本机普通 PowerShell 中，从 `D:\VVFLY\SomnusNext` 执行一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/use-independent-git.ps1
git status --short --branch
```

脚本将原指向备份在 `.somnus-git/previous-gitfile.txt`，再把当前工作副本接到独立 Git 历史。完成前不要在此目录运行普通 `git add/commit/push`；临时使用 `git --git-dir=.somnus-git --work-tree=.`。从 GitHub 全新 clone 的目录不需要修复，不要对它运行此脚本。

源码位置见 [SOURCE_MAP.md](SOURCE_MAP.md)，构建与发布见 [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md)。
