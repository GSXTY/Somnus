# 深度分析：DeepAnalyze 协议兼容试用

这是独立实现的 `<Code>` / `<Answer>` 协议试用模块，参考官方项目，不是安装、移植或运行官方 DeepAnalyze-8B / DA-Studio。没有 vendor 官方代码；不声称本模块获得官方模型的能力。参考版本为官方仓库提交 `afc697a11675c59683b9f6596c3ab3b3d661182a`：

- https://github.com/ruc-datalab/DeepAnalyze/blob/afc697a11675c59683b9f6596c3ab3b3d661182a/demo/chat_v2/README.md
- https://github.com/ruc-datalab/DeepAnalyze/blob/afc697a11675c59683b9f6596c3ab3b3d661182a/API/README.md

## 当前行为

用户明确上传一份 CSV、输入问题，服务在独立任务中请求兼容 Chat Completions 的分析模型。模型返回完整代码后，只能在 Docker 中执行；执行输出反馈给模型继续分析，完整报告与图表通过同源受控附件接口返回。至少一次成功执行代码，才允许任务成功；模型直接回答不能冒充已计算。只展示代码、执行结果、状态与最终报告，不输出 Analyze / Understand 思考过程。

没有 Docker、Docker daemon 不就绪、没有已有镜像或模型未配置时，可以上传 CSV 并创建任务，但状态明确为 `blocked`，不会请求模型、执行宿主机代码或生成假报告。`configured` 不是联网成功，只有本进程完成分析后才设置 `connection_status=verified`。当前本机缺 Docker；mock 测试通过不代表真实模型+容器已经跑通。

## 独立模型配置

见 `.env.example`，把其中 `DEEP_ANALYSIS_*` 项配置到服务器环境或已有 `.env` 后重启。**不会读取 `AI_ASSISTANT_*` 作为 fallback，也不会覆盖聊天密钥。** DashScope 的具体地域、兼容地址与模型名称以你的控制台为准，示例只是传统兼容地址。不要把密钥提交版本库。服务不自动探测或发外网请求。

每个真实任务会把用户问题、列名、CSV 行数和容器执行输出发给所配置的独立模型服务。CSV 只读挂载容器，由生成代码读取；因此原始值可能出现在执行输出并发送给模型。先只使用 `/api/deep-analysis/sample.csv` 提供的合成日报测试，经过公司批准后再使用真实业务数据。样例为固定合成 80 用户 × 7 天，带 `synthetic=true`，其中波形缺失率为合成的已计算输入值，不是患者检测结果。

## Docker 准备（人工操作）

应用不会安装 Docker、下载 8B 模型、拉取或自动构建镜像。管理员准备 Docker Linux 容器模式后，在项目根目录手动构建：

```powershell
docker build -t ya70-deep-analysis:trial -f deep_analysis/Dockerfile.exec deep_analysis
```

该命令需要联网下载基础镜像和包。构建上下文仅为 `deep_analysis/`，`.dockerignore` 只允许 Dockerfile，不把整个仓库、`.env`、用户 CSV 或运行工作区发送给 Docker builder。Docker 状态检查只运行本机 `docker info` 与 `docker image inspect`，缓存 15 秒，不自动拉取镜像。

执行容器使用 `--pull=never`、禁网络、非 root、只读根文件系统、cap-drop/no-new-privileges、512MiB 内存、1 CPU、64 PID 及超时。只读挂载当前 CSV 到 `/input/data.csv`，仅当前任务 `/work` 可写；仓库、`.env`、SQLite、聊天记录、Docker socket 和其他用户文件不挂入容器。stdout 上限 2MiB，工作区每轮检查最多 500 项/50MiB（轮询限额不是磁盘硬配额，严格生产环境还需独立卷配额）。停止任务或服务会取消执行并主动移除已登记容器。模型 HTTP 在途请求最多等待请求超时，不继续覆盖取消状态。

## 存储和接口

数据在宿主指定 data-dir 下的独立 `deep_analysis/analysis.sqlite3`、`uploads/`、`tasks/`。原始上传指纹保留；试用副本统一为 UTF-8 便于容器读取，不修改原 CSV。任务保存问题、代码轮次/输出、最终报告、指纹与方法版本；重启遗留任务标记 interrupted，不自动重新收费运行。

- `GET /api/deep-analysis/status`
- `GET /api/deep-analysis/sample.csv`
- `POST /api/deep-analysis/files`：原始 CSV body、`X-Filename: encodeURIComponent(name)`，返回 `{file}`。
- `POST /api/deep-analysis/tasks`：`{file_id, question}`，返回 202 `{task}`。
- `GET /api/deep-analysis/tasks/{id}`：返回 `{task}`。
- `POST /api/deep-analysis/tasks/{id}/cancel`：返回 `{task}`。
- `GET /api/deep-analysis/artifacts/{id}`：受控图片预览/其他附件下载。

文件默认 5MiB、100000 行、200 列。默认同时最多 2 个任务、4 轮、总时限 240 秒、每轮代码 60 秒。可配置项见 example。仅支持 CSV；字段名须唯一、字段数一致，空/损坏/二进制文件拒绝。产物最多 30 个、单个 10MiB/总 30MiB；不提供 HTML/SVG inline，也不跟随 URL 或符号链接，附件内容指纹不一致会拒绝读取。用户手动上传脚本不受支持。

共享模式以 local_shared 保留本机兼容；服务器隔离模式由宿主提供 opaque cookie owner。文件、任务、附件均校验 owner，ID 不充当授权。浏览器隔离不等于账号认证；当前单 worker，正式内部多人部署仍需要统一登录、授权、配额和保留策略。

本模块不连接生产数据库、不调用暂停/低通气检测、不替代每日固定统计或你定义的波形缺失率算法；不会读取现有用户 CSV 或更改标记。

## 验证

```powershell
python -m unittest discover -s tests -p 'test_deep_analysis*.py' -v
```

测试使用临时目录、模拟模型与模拟 Docker 执行器，不发外网、不执行模型代码。真正端到端应在 Docker 和独立模型配置就绪后由用户上传合成样例验证；成功状态必须同时有已完成执行记录和报告。
