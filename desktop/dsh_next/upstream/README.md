# 固定上游构建输入

`app.asar` 是固定 DSH Next 版本的未修改上游桌面归档；来源、版本、提交和 SHA-256 记录在 `manifest.json`。它只用于重新构建 SomnusNext 源码覆盖层，程序实际运行 `app/resources/app.asar`。

此构建输入留在本项目目录，使本地更新不依赖其他 Somnus 工程目录。二进制不纳入 Git；源码分享时应按照固定上游发布信息准备同一归档并验证清单。不得用已修改的 Somnus ASAR 代替上游归档。
