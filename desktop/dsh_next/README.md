# Somnus 的 DSH Next 桌面接入

- `client/`：Somnus 原生 React 页面、侧栏、模型选择和页面样式。
- `host/`：桌面启动、IPC、Agent 与后端接入。
- `overlay.mjs`、`stage-next.mjs`：对固定上游归档生成并校验 Somnus 覆盖层。
- `next-release.json`、`upstream/manifest.json`：固定上游来源及校验值。
- `oar/`：宿主接入依赖；保留源码及许可信息。

当前 Windows 基线为 `xue-ding-e/DSH-Next` 的 `0.2.2-rc.2.20261115.31`，不要混用旧实验环境或其他上游构建。

完整上游源码在根目录 `vendor/dsh-next/`。`source-lock.json` 固定其提交和依赖锁文件；`source-build.mjs` 管理隔离源码构建，`source-overlay.mjs` 加入 Somnus 启动入口与自有界面/宿主适配。该流程不以已有发布归档为输入，具体命令和验证状态边界见 [完整源码开发说明](../../docs/SOURCE_BUILD.md)。

[本机更新说明](NEXT_BUILD.md) · [完整构建与发布流程](../../docs/BUILD_AND_RELEASE.md) · [开发与 PR 流程](../../CONTRIBUTING.md)
