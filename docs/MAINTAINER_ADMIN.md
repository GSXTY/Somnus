# Somnus 本机管理后台

在 Windows 开发电脑双击 `tools/启动 Somnus 管理后台.cmd`。启动器使用 Python 环境中的 FastAPI 和 Uvicorn，并自动打开浏览器。配置源码目录或 Python 环境时可以运行 `tools/start_maintainer_admin.ps1`。

后端只监听 `127.0.0.1:8895`。浏览器由启动器打开后完成授权。同一个标签页刷新可以继续使用。如果标签页已经关闭，先关闭标题为 Somnus Maintainer Admin 的终端窗口，然后重新双击启动器。

## 默认模型共享

页面检查 `127.0.0.1:8894` 的模型中继。共享开关保存在本机配置目录，重启有效。暂停共享后，中继拒绝朋友发起的新请求。朋友的连接还需要 HTTPS 转发和个人邀请令牌。HTTPS 转发目标只设为模型中继的 8894 端口。

## 标准版

发布草稿保存版本号、说明、签名方式和 Project Handoff 默认插件设置。提交时会核对标准版工作区和 GitHub Actions 凭据，将发布配置提交到标准版 `main` 并启动 GitHub Actions。公开下载仓库在构建和校验成功后更新。

GitHub Actions 需要发布令牌。签名的 Windows 安装包另需代码签名证书及证书密码。未签名的 beta 预览版由客户端提供手动下载链接。
