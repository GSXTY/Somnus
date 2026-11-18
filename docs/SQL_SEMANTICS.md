# vvflycloud 数据语义（AI 查询用）

> 这份文件会被拼进 NL→SQL 的提示词。字段含义写清楚，模型才不容易写错。
> 标记 **【待确认】** 的地方需要业务方补充，补完后删掉标记即可。

## YA50 与 YA70 使用人数

| 产品 | 治疗汇总表 | 日期字段 | 用户键 |
|---|---|---|---|
| YA50 | `resp_statistics`（YA50 专用） | `record_date` | `userid` |
| YA70 | `resp_statistics_ya70` | `recorde_date` | `userid` |

- 使用表中记录的日期归属治疗夜。查询时按指定日期区间过滤汇总表。
- YA50 和 YA70 的 `treat_time` 都以分钟存储。Somnus 使用人数报表以当天至少一条 `treat_time >= 1` 的记录为准。重复记录的时长不累加，空用户 ID、未知时长和零时长不计入。
- 单型号按日期和 `userid` 去重。跨型号合计时先合并达标记录，再按日期和 `userid` 去重。同一用户同一天用两款设备，各型号分别计 1 人，合计计 1 人。
- 日均人数为每天去重人数之和除以区间自然日数。无记录日期计 0，已知汇总或上传未完成的日期单独标注。区间独立用户数在整个区间内按 `userid` 去重。
- 产品展示范围包括 YA50、YA70、YA43 和 YA46（4600），4300 继续排除。上述 1 分钟有效使用门槛及 `treat_time` 分钟单位仅用于 YA50 和 YA70。YA43、YA46 的统计粒度、时长字段和单位待核对，查询时使用实际表结构，不沿用 YA50、YA70 的时长换算和有效使用条件。

## 一、数据库概况

- 引擎：MySQL 8.0.28，库名 `vvflycloud`
- 账号：`mjh`（**只读**，只能 SELECT）
- 当前库目录核对可见 127 张表，Somnus 查询白名单开放 21 张（见下）。
- 时区：绝大多数时间字段按业务方上传的本地时间存储，`resp_statistics_ya70.timezone` 记录解析时区（多为 `Asia/Shanghai`）

## 二、可查询的表

| 表 | 约行数 | 用途 |
|---|---:|---|
| `app_user` | 57 万 | 用户主表（注册、状态、性别、年龄） |
| `app_user_info` | 34 万 | 用户附加属性（地区、客户端、生活习惯） |
| `app_user_bind` | 6.7 万 | 第三方账号绑定（微信等） |
| `device_binding` | 39 万 | 用户与设备的绑定关系 |
| `product_info` | 54 万 | 设备档案（型号、固件、参数、绑定时间） |
| `resp_statistics_ya70` | 9,580 | **YA70 治疗日报**（每用户每天一条，核心指标表） |
| `resp_minute_ya70` | 314 万 | YA70 分钟级明细（可聚合，避免全表扫描） |
| `resp_event_ya70` | 7.6 万 | YA70 呼吸事件明细（每次事件一条） |
| `resp_statistics` | 76 万 | YA50 治疗日报 |
| `resp_minute` | 未重新测量 | YA50 分钟明细；限定用户或设备，并限定时间区间查询 |
| `statistics_ya43` | 未重新测量 | YA43 睡眠和止鼾汇总 |
| `min_snore_data_ya43` | 未重新测量 | YA43 分钟级鼾声和体动指标；限定用户或设备及时间区间 |
| `snore_data_info_ya43` | 未重新测量 | YA43 鼾声详细记录；限定用户或设备及时间区间 |
| `statistics_ya46` | 未重新测量 | YA46（4600）睡眠和止鼾汇总 |
| `min_snore_data_ya46` | 未重新测量 | YA46（4600）分钟级鼾声和体动指标；限定用户或设备及时间区间 |
| `snore_data_info_ya46` | 未重新测量 | YA46（4600）鼾声详细记录；限定用户或设备及时间区间 |
| `resp_events` | 71 万 | 老平台呼吸事件 |
| `user_products_setter` | 2 万 | 设备参数设置（治疗模式、压力范围） |
| `user_products_setter_respy_ya70` | 2 万 | YA70 设备设置与提醒配置 |
| `user_feedback` | 9,574 | App 用户反馈 |
| `filmware_log` | 9,674 | 固件升级记录 |

表中已有约行数为历史参考值，本次开放没有扫描或重新计数业务表。YA50 使用人数和趋势优先查询 `resp_statistics`，需要分钟详情时再查询 `resp_minute`，使用明确字段和有限返回条数，避免大范围扫描。

**禁止查询的大表**（已从白名单排除，不要尝试）：

| 表 | 行数 | 说明 |
|---|---:|---|
| `snore_data_info_4300` | 4.49 亿 | 原始鼾声数据 |
| `anitsnore_datails_new` | 4.18 亿 | 止鼾明细 |
| `resp_detail` | 2.47 亿 | 呼吸原始明细 |
| `rec_snore` | 1.43 亿 | 鼾声识别记录 |

## 三、关键字段

### app_user（用户）

| 字段 | 含义 |
|---|---|
| `ID` | 用户 ID，其它表里的 `userid` 指向它 |
| `create_time` | 注册时间 |
| `user_state` | 用户状态（是否激活/停用）**【待确认：0/1/2 分别代表什么？】** |
| `gender` | 性别 **【待确认：0/1/2 的编码】** |
| `age` | 年龄，可能为空 |
| `type` / `app_type` | 第三方账号类型、App 类型 **【待确认】** |
| `verify_states` | 0 未验证 / 1 邮箱验证 / 2 手机验证 |

### product_info（设备）

| 字段 | 含义 |
|---|---|
| `id` | 设备内部 ID，`device_binding.proid` 指向它 **【待确认】** |
| `deviceid` | 设备唯一编号（字符串，界面上的设备 ID） |
| `pi_code` | 产品编码 |
| `device_type` | 设备型号编码 **【待确认：与 resp_statistics_ya70.device_type 是否同一套编码？】** |
| `fw_version` | 固件版本（二进制字段，查询时可能要转换） |
| `activate_date` | 激活时间 |
| `again_bind_time` | 再次绑定时间 |
| `sensitivity` / `snore_strength` / `snore_delay` 等 | 止鼾相关参数 |
| `intervention_model` | 干预模式 1 自动 / 0 固定 |

### device_binding（绑定关系）

| 字段 | 含义 |
|---|---|
| `userid` | 用户 ID |
| `proid` | 设备 ID（对应 `product_info.id`）**【待确认】** |
| `binding_date` | 绑定时间，**字符串类型**（格式需确认） |
| `pro_type` | 设备类型 **【待确认】** |

### resp_statistics_ya70（YA70 治疗日报，最重要）

一条记录 = 一个用户一天的治疗报告。

| 字段 | 含义 |
|---|---|
| `userid` / `deviceid` | 用户、设备 |
| `recorde_date` | 报告日期（date） |
| `date_date` | 实际时间（datetime） |
| `treat_time` | **治疗时长，单位分钟** |
| `start_time` / `end_time` | 治疗起止时间 |
| `ahi` | AHI 指数（设备上报值） |
| `apnea_index` / `hypopnea_index` / `central_apnea_index` | AI / HI / CAI（次/小时） |
| `apnea_count_total` / `hypopnea_count_total` / `ca_count_total` | 当日次数合计 |
| `apnea_duration_total` / `hypopnea_duration_total` / `ca_duration_total` | 当日各类事件总时长（秒） |
| `treat_pressure` / `treat_pressure_95` | 平均治疗压力 / P95（hPa） |
| `air_leakage_avg` / `air_leakage_95` | 平均漏气 / 漏气 P95（升/分） |
| `air_leakage_duration_max` | 大漏气（>90 L/min）时长 |
| `treat_score` | 综合得分 0–100 |
| `treat_duration_score` | 时长得分（满分 70） |
| `mask_score` | 面罩封闭性得分（满分 20） |
| `resp_score` | 呼吸事件得分（满分 10） |
| `show_in_app` | 是否在 App 展示 1/0 |
| `timezone` | 解析时区，如 `Asia/Shanghai` |
| `treat_models` | 当日工作模式（逗号分隔；1=CPAP 2=APAP 3=S） |

### resp_minute_ya70（YA70 分钟明细）

| 字段 | 含义 |
|---|---|
| `recorde_date` | 记录日（yyyy-MM-dd 字符串） |
| `date_date` | 实际时间（字符串） |
| `data_type` | 1 分钟数据 / 2 事件数据 / 3 按键 / 4 保留 |
| `treat_model` | 工作模式编码 |
| `hypopnea_count` / `apnea_count` / `ca_count` | 该分钟事件次数 |
| `hypopnea_duration` / `apnea_duration` / `ca_duration` | 该分钟事件时长（秒） |
| `air_leakage_avg` / `leak_level` | 漏气量、漏气级别 1–5 |
| `tidal_volume_avg` / `hz_avg` | 潮气量、呼吸频率 |

**聚合注意**：按日聚合时先过滤 `data_type = 1`，否则会把事件行重复计入。

### resp_event_ya70（YA70 呼吸事件）

| 字段 | 含义 |
|---|---|
| `recorde_date` | 报告日期 |
| `date_date` | 事件实际时间 |
| `minute` | 事件所在分钟 |
| `event_type` | 事件类型（设备编码）**【待确认：编码表，例如 1=呼吸暂停、2=低通气、3=中枢性…】** |
| `event_duration` | 事件时长（秒） |
| `upward_pressure_pa` | 上升压力（Pa） |


## 三之二、设备型号编码（重要）

`resp_statistics_ya70.device_type` 是 **5 位编码**，不是两位：

| 编码 | 出现量（全量） | 说明 |
|---|---:|---|
| `70120` | 9,369 | 主力型号 |
| `70330` | 584 |  |
| `70230` | 46 |  |
| `70220` | 37 |  |

- **不存在 `'70'` 这种两位值**，按两位筛选会得到 0 行。
- 型号编码与对外型号名（YA70A20 / YA70B20 …）的对应关系 **【待确认】**。
- 在映射确认前：**不要凭问题里的型号名臆造编码**。宁可不过滤型号、把 `device_type` 作为一列返回，让用户自己判断。


## 三之三、数据质量已知问题（2026-11 实测）

### 1. 两套设备型号编码并存，不要混用

| 表 | 字段 | 实测取值 |
|---|---|---|
| `resp_statistics_ya70` / `resp_minute_ya70` / `resp_event_ya70` | `device_type` | `70120`、`70220`、`70230`、`70330`（5 位） |
| `device_binding` | `pro_type` / 关联出的 `device_type` | `1`、`2`、`10`、`11`、`22`、`421`（1~3 位） |
| `product_info` | `device_type` | 与 device_binding 同一套（小整数） |

**跨表把两套编码当成同一个值来 JOIN 或比较，会得到错误结果。**
按型号统计治疗数据时用 `resp_statistics_ya70.device_type`；按型号统计绑定关系时用 `device_binding` / `product_info` 那一套。

### 2. `product_info.model_code` 整列为空

该列没有可用值，**不要用它做分组或筛选**；型号信息以 `device_type` 或 `model_code` 之外的字段为准。

### 3. 日期存在异常值

`resp_statistics_ya70.recorde_date` 实测范围 **2000-07-19 ~ 2037-12-17**，含未来日期（脏数据）。

- 做趋势/日统计时**必须加时间范围**（如近 30 天、近 7 天），不要全表按日期分组。
- 看到未来日期的记录，按脏数据处理，不要当成业务事实。

### 4. 事件计数列可能为 NULL

`apnea_count_total` / `hypopnea_count_total` / `ca_count_total` 存在 NULL。
求和时必须逐个 `COALESCE`，否则整行变 NULL：

```sql
SUM(COALESCE(apnea_count_total,0) + COALESCE(hypopnea_count_total,0) + COALESCE(ca_count_total,0))
```

## 四、表关系

```
app_user.ID  ←──  userid  ──→  resp_statistics_ya70 / resp_minute_ya70 / resp_event_ya70
                              device_binding / resp_events / user_feedback / filmware_log

product_info.id  ←── proid ──→ device_binding
product_info.deviceid  ←── deviceid ──→ resp_statistics_ya70 / resp_minute_ya70 / resp_event_ya70
```

- 一个用户可绑定多台设备；统计"用户数"时用 `COUNT(DISTINCT userid)`
- 同一台设备可能换绑过用户，`device_binding` 保留历史

## 五、口径定义

| 指标 | 口径 |
|---|---|
| 治疗时长 | `resp_statistics_ya70.treat_time`，**单位分钟**；换算小时需 `/60` |
| 依从性（使用天数占比） | 有治疗记录且 `treat_time >= 240` 分钟的天数 / 统计区间天数 |
| AHI | 设备上报值 `ahi`；与"工程候选事件数"不是同一口径，报告中必须区分 |
| 漏气 P95 | `air_leakage_95`，单位 升/分 |
| 得分构成 | `treat_duration_score(70) + mask_score(20) + resp_score(10) = treat_score(100)` |
| 事件次数 | 日报 `*_count_total` 为当日合计；分钟表聚合需先过滤 `data_type=1` |

## 六、排除规则

| 情况 | 处理 |
|---|---|
| 测试/内部账号 | 【待确认：是否按 userid 段、手机号或 email 排除？】 |
| App 隐藏数据 | 如需与 App 展示一致，加 `show_in_app = 1` |
| 治疗时长为 0 的记录 | 视为空记录，统计时排除 |
| 时区 | 按 `timezone='Asia/Shanghai'` 的本地日期分组；跨时区数据比例很小，暂不单独处理 |

## 七、示例问答

**Q：现在有多少注册用户？**
```sql
SELECT COUNT(*) AS user_count FROM app_user
```

**Q：过去 30 个完整日，YA70 每天有多少有效使用用户？**
```sql
SELECT recorde_date AS day, COUNT(DISTINCT userid) AS active_users
FROM resp_statistics_ya70
WHERE recorde_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
  AND recorde_date < CURDATE()
  AND userid IS NOT NULL
  AND treat_time >= 1
GROUP BY recorde_date
ORDER BY day
```

**Q：最近 30 天平均 AHI 和平均漏气 P95 是多少？**
```sql
SELECT ROUND(AVG(ahi), 2) AS avg_ahi, ROUND(AVG(air_leakage_95), 2) AS avg_leak_p95
FROM resp_statistics_ya70
WHERE recorde_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
  AND ahi IS NOT NULL
```

**Q：各设备型号的用户数分布**
```sql
SELECT device_type, COUNT(DISTINCT userid) AS users
FROM resp_statistics_ya70
GROUP BY device_type
ORDER BY users DESC
LIMIT 200
```

**Q：本月治疗依从性（使用 ≥4 小时的天数占比）**
```sql
SELECT ROUND(100 * SUM(CASE WHEN treat_time >= 240 THEN 1 ELSE 0 END) / COUNT(*), 1) AS compliance_percent
FROM resp_statistics_ya70
WHERE recorde_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
```

**Q：最近 7 天触发大漏气（>90 L/min）最多的 10 个用户**
```sql
SELECT userid, ROUND(SUM(air_leakage_duration_max), 1) AS leak_hours
FROM resp_statistics_ya70
WHERE recorde_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  AND air_leakage_duration_max IS NOT NULL
GROUP BY userid
ORDER BY leak_hours DESC
LIMIT 10
```

## 八、待确认清单

1. `app_user.user_state` 的取值含义（0/1/2？）
2. `app_user.gender` 的编码（0/1/2？）
3. `product_info.id` 与 `device_binding.proid` 是否同一含义
4. `product_info.device_type` 与 `resp_statistics_ya70.device_type`（70/71/72/73/74）是否同一套编码
5. `resp_event_ya70.event_type` 的完整编码表
6. `resp_events.events_type` 的编码表（老平台）
7. `device_binding.pro_type` 的含义
8. 测试/内部账号如何识别并排除
9. 是否需要默认只统计 `show_in_app = 1` 的记录
