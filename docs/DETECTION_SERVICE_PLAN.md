# 远端批量检测服务 · 实施计划

> 目标：把「某一天、某个型号段的全部记录」的检测交给服务器并行执行，结果集中保存；
> Somnus 里能提交、看进度、看结果，不用再登录服务器手动操作。
> 本地单文件复核能力保留，不替代。

---

## 1. 边界

做：

- 服务器侧的批次任务 API + Worker 池（并行跑现有检测算法）
- 结果统一入库（批次、逐文件结果、证据包）
- Somnus 侧：聊天里提交/查询 + 批次列表与详情（分期）
- 每天定时自动建批次（cron）

不做（首版）：

- 不在服务器上跑波形交互式复核（先只提供事件表 / 结果摘要，波形二期评估）
- 不引入 Redis / Celery / Kubernetes（单机 DB 队列够用，接口预留可替换）
- 不改动现有只读数据网关（`data_gateway` 职责不变）

---

## 2. 服务器上要运行什么程序

| # | 程序 | 说明 | 是否必需 |
|---|---|---|---|
| 1 | **PostgreSQL 或 MySQL（可写）** | 批次/任务/结果库。现有 RDS 是只读账号，不能复用写权限；建议同实例新建库 + 写账号，或独立小实例 | 必需 |
| 2 | **控制 API**（FastAPI） | 提交/查询/取消批次，鉴权，进度汇总。只做控制面，不跑算法 | 必需 |
| 3 | **Worker 进程池**（N 个 Python 进程） | 执行检测。复用仓库 `event_detection/` 算法，Docker 镜像或 venv 均可 | 必需 |
| 4 | **对象存储客户端** | 不单独运行；内置在 Worker 里（OSS SDK / boto3），从桶里直接下载原始记录、写回结果 | 必需（接入 OSS 时） |
| 5 | **HTTPS 反向代理**（Caddy 或 Nginx） | 对外只暴露 443，证书自动续期；API 只监听 127.0.0.1 | 必需 |
| 6 | **系统 cron / systemd timer** | 每天 02:00 调内部接口建「昨日批次」，不需要额外软件 | 必需 |
| 7 | （可选）**Somnus 数据网关** | 若要远程看主页/查数，沿用现有 `data_gateway` | 可选 |
| 8 | （可选）**Redis** | 仅当单日 > 几千份或需多机扩展 | 首版不需要 |

### 进程拓扑

```
caddy :443
  └─ control-api 127.0.0.1:8788        （提交/查询，不计算）
        └─ DB  （batches / tasks / results）
worker-1..N （同镜像，各自从 DB 队列取任务，单进程单任务）
cron 02:00 → POST /internal/batches    （内部令牌）
```

### 资源建议

- CPU：4~8 核（并行度 = 核数 - 1）
- 内存：8~16 GB（**内存是主要瓶颈**：每份记录解析后可达几十~几百 MB，峰值 × N 不能超内存）
- 磁盘：系统盘 100 GB 足够（原始数据留 OSS，本地只做临时缓存并清理）
- 网络：与 OSS 同区域，否则下载会成瓶颈

---

## 3. 接口（控制面）

外部（Somnus 桌面端，令牌 A）：

```
POST /api/detection/batches          { date, models[], profiles[], params{} } → { batch_id, created }
GET  /api/detection/batches/{id}     → { status, done, total, failed, errors[] }
POST /api/detection/batches/{id}/cancel
GET  /api/detection/batches?date=     → 列表
GET  /api/detection/records/{file_id}  → { events[], settings, algo_version, artifact_url }
```

内部（cron，令牌 B）：

```
POST /internal/batches  { date, models[], profiles[] }   → 计划批次
GET  /internal/health   → { db, queue_depth, workers_alive, version }
```

约定：

- 同步只做校验与入库，**立即返回** `batch_id`，计算全在 Worker
- 参数白名单：`date`（ISO）、`models`（枚举）、`profiles`（枚举，默认 `patient_flow_v4`）、`params`（单选/数值，逐项校验范围）
- 错误码：`400 参数非法` / `401 令牌无效` / `409 批次已存在` / `429 队列过载` / `503 服务不可用`

---

## 4. 数据模型（首版五张表）

```
batches    id, date, models, profiles, params_hash, params,
           status(queued|running|done|failed|partial|canceled),
           total, done, failed, created_by, created_at, started_at, finished_at

tasks      id, batch_id, object_key, file_id, fingerprint,
           status, attempts, started_at, finished_at, error_code, error_message,
           UNIQUE(object_key, algo_version, params_hash)      -- 幂等
           INDEX(batch_id, status)

records    file_id, revision, events_json, meta_json, algo_version, updated_at
           -- 与本地 event_store 的 records/scans 字段对齐，便于两边合并展示

artifacts  id, task_id, kind(summary|events_csv|report|manifest), size, sha256, object_key

audit      id, actor, action(submit|cancel|internal_batch), payload, ip, created_at
```

幂等规则：

- 同一 `object_key + algo_version + params_hash` 只允许一条 `tasks`
- 重复提交同一批次 → 返回既有 `batch_id`（`created=false`）
- 算法升级 → `algo_version` 变化，旧结果保留、新任务新建，不做覆盖

---

## 5. 并行执行

- Worker 用**多进程**（GIL 限制，线程无效）；每个进程同时只跑 1 个任务
- 并发度 `N = min(cpu_count() - 1, floor(内存预算 / 单任务峰值内存), 8)`
- 单个任务超时（默认 10 分钟）→ 终止进程、记失败、按策略重试（最多 2 次）
- **单写者**：Worker 只产出结果，写库由统一写入路径完成（或 Worker 写独立的 OSS 结果对象，主进程汇总引用），避免并发写冲突
- 下载并发单独限流（如 8），失败指数退避
- 取消：设置任务标志 + 终止正在跑的进程；已完成的不回滚

**前置测量**：先量单份「下载 / 解析 / 检测」耗时占比，再定并行数与是否要流式解析。若解析占 80%，并行收益会被 IO 限住。

---

## 6. 鉴权与安全

- 全部走 **HTTPS**；token 长度 ≥ 32，随机生成
- 令牌分两种：桌面端（只读+提交）、内部 cron（建计划批次）
- **令牌只保存在 Somnus 本机后端**（`.env`），渲染层不接触；Somnus 用本机后端代理请求
- 接口参数白名单 + 体积限制；拒绝任意 SQL / 任意路径
- 审计表记录每次提交（who / what / when / ip）
- 数据合规：结果库与原始数据同属内部资产，访问范围按人控制

---

## 7. Somnus 侧接入

### 7.1 配置（本机 `.env`）

```ini
DETECTION_SERVICE_URL=https://detect.example.com
DETECTION_SERVICE_TOKEN=<32~256 位>
```

未配置 → 全部功能回落本地，不报错。

### 7.2 聊天里说（最先做，成本最低）

新建 Python 插件 `plugins/detection-service/`（`plugin.json` + `tools.py`），声明两个工具：

- `start_detection_batch(date, models)` → 调 `POST /api/detection/batches`
- `get_detection_batch(batch_id | date)` → 调 `GET`

用户可以直接说：「跑昨天 70 系的全部检测」「昨天那批跑完了吗」。

### 7.3 工具页「远程批次」（第二期）

- 列表：日期、型号、状态、done/total、失败数
- 详情：逐文件结果、事件表（波形二期）
- 提交表单：日期 + 型号 + 检测方案

### 7.4 结果合并

本地结果与远程结果都映射到同一套 `records/scans` 语义（`file_id + algo_version`），列表里标注来源（本机 / 服务器）。

---

## 8. 分阶段计划

| 阶段 | 内容 | 验收 | 参考工期 |
|---|---|---|---|
| **M1 服务可跑** | 库 + 控制 API + Worker 池；命令行/HTTP 提交一个批次 | 提交昨日 70 系 → 全部完成，数量与源对象一致 | 1~2 周 |
| **M2 聊天可控** | Somnus 插件两工具（提交/查询） | 聊天里能提交并查到进度与失败原因 | 3~5 天 |
| **M3 结果可见** | 工具页远程批次列表 + 详情（事件表） | 不登录服务器也能看每份结果 | 1~2 周 |
| **M4 定时与运维** | cron 每日批次、审计、健康接口、失败通知 | 连续跑 3 天无需人工干预 | 2~3 天 |

---

## 9. 验收场景（必须全部通过）

1. 提交「昨日 + 70 系」→ 批次进入队列，Worker 并行完成，`done == total`
2. 同参数重复提交 → 返回既有批次，不重复计算
3. 停掉一个 Worker → 任务被重试，批次最终完成
4. 提交后关闭 Somnus → 任务继续；重开能查到进度
5. 算法版本升级 → 旧结果保留，新任务使用新版本
6. 令牌错误/缺失 → 401，不泄漏内部信息
7. 参数越界（未来日期、未知型号）→ 400 且不建批次

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 下载/解析是瓶颈 | 与 OSS 同区域部署；先测量再定并行度 |
| 内存被并发打爆 | 按内存预算计算并发上限；单任务内存上限 + 超时终止 |
| 结果库与只读 RDS 混用 | 写库独立（新库/新实例），只读账号不动 |
| 算法版本漂移 | 结果表存 `algo_version` + `params_hash`；不接受“同参数不同结果” |
| 失败无人知晓 | 批次状态 + 健康接口 + 失败通知（邮件/IM，渠道待定） |
| 数据合规 | 访问控制 + 审计表；原始数据不落地成长期缓存 |

---

## 11. 待决策（开工前需要确认）

1. 结果库放在哪：现有 RDS 同实例新建库，还是独立实例？
2. 批次粒度：按「日 + 型号段」，还是允许按「用户/设备」再细分？
3. 失败通知渠道：邮件、企业微信，还是只在 Somnus 里提示？
4. 波形是否远程查看（影响 M3 范围与工作量）
5. 服务器部署形态：Docker Compose 还是 venv + systemd
