# FastAPI 统一服务

统一入口 `launcher.py` 已改用 FastAPI + Uvicorn，工作台 `/`、数据分析 `/events`、原有数据接口和 AI 会话流式接口仍在同一个服务端口。`/docs` 提供 FastAPI 接口文档，`/openapi.json` 提供机器可读契约。本实现不会在后台另起旧 HTTP 服务或代理到第二个端口。

## 本机启动

安装 `requirements.txt` 后，原来的“启动 AI Agent”启动文件仍可使用。命令行兼容已有选项：

```powershell
python launcher.py --no-browser --port 8765 --data-dir ./data
```

可选位置参数仍可传入一份 CSV。没有文件时工作台和 AI 会话可正常打开，数据分析显示等待导入。默认监听 `127.0.0.1`，本机默认 `shared` 模式兼容原浏览器与无 Cookie 的本机 MCP；默认开发数据目录仍为项目的 `data/`，聊天继续使用原 `assistant.sqlite3`。冻结程序使用原来的 LocalAppData 路径，不会重建或清空已有事件库。模型环境配置继续沿用 `ai_assistant/README.md`。

## 服务器进程

Linux / 容器可使用下面的应用工厂，数据目录应挂载到持久卷：

```sh
export AI_AGENT_DATA_DIR=/srv/ya70/data
export WEB_CONCURRENCY=1
uvicorn server.app:create_app --factory --host 127.0.0.1 --port 8765 --workers 1
```

也可以使用 `python launcher.py --no-browser --host 127.0.0.1 --port 8765 --data-dir /srv/ya70/data --session-mode isolated`。直接使用应用工厂默认 `isolated`；启动器非 loopback 地址默认 `isolated`，拒绝在非本机地址启用 `shared`。环境变量 `AI_AGENT_SESSION_MODE` 可显式选择，两种方式都会在健康响应中说明。服务没有增加宽松 CORS，浏览器跨站写入会返回 403；这不是登录认证。

**本轮交付的是服务器服务框架迁移，不是可直接暴露到公网的账号系统。** 对外上线还需统一登录、账号授权、会话所有者和记录访问控制。`shared` 保留原本机共享历史；`isolated` 为每个随机 HttpOnly 浏览器上下文使用 `assistant_sessions/` 中的独立聊天库，不会读取或删除原 `assistant.sqlite3`。同浏览器 Cookie 保留后可恢复该上下文；丢失 Cookie 不等于删除旧库，但没有账号恢复机制。这个浏览器隔离不能替代多人账号权限。

## 当前分析隔离与单 worker 限制

`isolated` 的浏览器当前文件和缓存按随机 HttpOnly 会话标识分开，避免两个浏览器互相替换“当前 CSV”；`shared` 明确保持本机所有客户端共用当前文件。现有事件算法经进程内适配器调用，未改阈值、默认 v3 / 8 秒窗口 / 10 秒持续时间或旧事件证据。

过渡适配层仍需串行绑定原检测模块状态，因此**必须保持一个 Uvicorn worker**，不要启用 `--workers 2`、多副本负载均衡或在同进程同时运行旧 MCP 对全局记录的操作。`WEB_CONCURRENCY` 非 1 会拒绝启动。不同浏览器的上下文隔离不是账号权限；相同文件的复核历史仍共享原有指纹和修订控制。

下一阶段应提取不依赖 HTTP 宿主的解析/记录服务，以显式 `recording_id` 和权限作为输入，再开放多 worker 和异步批处理。

## 独立深度分析试用

`/api/deep-analysis/*` 为新增独立 **DashScope 试用 / DeepAnalyze 协议兼容** 模块，普通 `/api/assistant/*` 不变。深度分析使用独立 `DEEP_ANALYSIS_*` 配置与 `data/deep_analysis/`，不回退到普通聊天密钥或聊天上下文；真实 DeepAnalyze 8B 未在此服务部署。模型与 Docker 缺任一条件时，状态明确为不可执行，不自动安装 Docker、拉镜像或在宿主运行生成代码。具体配置与执行资源限制见 [模块说明](../deep_analysis/README.md)。

`isolated` 下深度分析和聊天共享一个随机 HttpOnly 浏览器身份，但文件、任务、产物仍按 owner 校验并独立保存，不把分析输入加入普通聊天。身份标记保存在 `data/browser_sessions/`；单独访问深度分析无需创建聊天库。`shared` 仍仅本机使用，所有客户端为 `local_shared`。Cookie 不是账号授权，不得据此直接开放公网。关闭服务会通知未结束的深度分析任务取消；底层模型在途请求仍以配置超时为界退出。

## 日报接入边界

这次没有数据库类型、表结构或正式日报接口，`/api/workbench?source=live` 继续返回未连接和未知值；不会自动下载或执行用户提供的脚本，也不会内置其中的登录凭据。下一步在后台接入 YA70 每日明细，按 `userid + record_date` 保存、汇总，再调用现有分析工具计算波形缺失率。首页读取保存的结果，保持业务数据与 CSV 质量结果分层。

## 验证与兼容

测试依赖见 `requirements-test.txt`。重点运行：

```sh
python -m unittest discover -s tests -p 'test_fastapi*.py' -v
```

旧 `event_detection.viewer` 保留供既有模块回归和兼容测试，不再由 `launcher.py` 启动。`/api/health` 的 app_id/version/入口/算法版本字段保留，增加 `framework: fastapi` 与运行边界。`isolated` 人工脚本若分多次请求打开文件/读取波形，需要保留服务返回的会话 Cookie（例如 requests.Session / urllib CookieJar），不能每次请求都使用全新客户端；旧 MCP 默认不保留或配对浏览器 Cookie，因此只在本机 `shared` 模式兼容当前文件。真实进程烟测：`python tests/fastapi_server_smoke.py`。

本轮交付源码服务器启动流程，未重新制作 Windows EXE。已有 EXE 是旧版本，不会因为源码改变而自动升级。重新打包前需要将新服务模块与 Uvicorn 的动态依赖纳入 PyInstaller 并验证，不能直接复用此前的二进制作为迁移证据。
