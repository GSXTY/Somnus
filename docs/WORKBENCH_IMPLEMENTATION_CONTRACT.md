# 首页大盘实施约定

本轮依据用户提供需求实现可运行页面，采用 React + TypeScript + Ant Design + ECharts。范围是演示版业务首页及现有本地检测入口整合；数据库、实时设备、真实用户归属、大模型和外发消息未接入。

## 文件归属

- 页面 agent：`page_design/frontend/` 全部源码、依赖、构建输出 `page_design/web/`；不改 Python、原 dashboard/events、根目录打包或共享测试。
- 检测 agent：`event_detection/workbench_bridge.py` 及专属 `tests/test_workbench_bridge.py`；只读当前本地记录/候选的上下文入口，不改算法/服务宿主/前端。
- 主 agent：`agent_core/workbench.py`、HTTP 路由、启动和打包/CI、共享集成测试、部署说明。

## 服务接口

`GET /api/workbench?source=demo|live&model=all|YA70A20|YA70B20|YA70B25|YA70B30%2FYA70Pro|YA70LAB`。

默认 demo，整个页面持续标记演示数据。live 当前为未连接，所有未知指标 null，用户/图表/告警为空；不能静默回退演示。主 agent 提供数据；前端可以先按下列约定编写。

```ts
type Metric = { value:number|null; previous:number|null; trend:(number|null)[]; unit:string; label:string };
type UserRow = {
  id:string; name:string; model:string; device_id:string; firmware:string;
  state:'therapy'|'online'|'offline'; today_treatment_hours:number|null;
  leak_value:number|null; leak_unit:string; leak_flag:boolean;
  events_24h:number|null; priority:'high'|'medium'|'low'; priority_reason:string;
  recording_ref:null;
};
type Point = [number,number|null];
type Waveform = { duration_seconds:number; origin:'synthetic'; sampling_note:string;
  channels:{key:string;label:string;unit:string;points:Point[]}[] };
type Alert = { id:string; device_id:string; user_id:string; severity:'critical'|'warning'|'info';
  type:string; title:string; at:string; description:string; status:'open'; preview:Waveform|null };

type DataQuality = { expected_records:number|null; received_records:number|null;
  lost_records:number|null; loss_rate:number|null; unit:'records'; basis:string };
type Dashboard = {
  schema_version:1;
  source:{mode:'demo'|'unconfigured';connected:false;label:string}; generated_at:string;
  period:{start_date:string;end_date:string;kpi_date:string;time_zone:'Asia/Shanghai';date_basis:string};
  model_scope:string[];
  kpis:{active_users:Metric;treatment_hours:Metric;reported_events:Metric;online_rate:Metric};
  daily:{date:string;active_users:number;treatment_hours:number;event_count:number;online_rate:number}[];
  fleet:{online:number|null;total:number|null;in_therapy:number|null;offline:number|null;latency_seconds:null};
  users:UserRow[]; alerts:Alert[]; alert_distribution:{name:string;value:number}[];
  data_quality:DataQuality;
  insights:{kind:'summary'|'observation'|'next_step';title:string;text:string;evidence:string[]}[];
  constraints:string[];
};
```

`data_quality`为独立上报完整性指标，口径是当前上海自然日截至`generated_at`、所选型号范围的“缺失上报量 / 应上报量 × 100%”。计数单位`records`表示同口径上报记录，不是字节、网络包、用户数、临床事件或当前本地CSV的行数。应报、实收、缺失均为非负整数，`lost_records=expected_records-received_records`；实收不能大于应报。只有应报量大于0且实收有效才计算`loss_rate`，返回0～100的百分数；0/0返回null，而非0%。未知计数不推算，live未接入时四个数值字段全为null，保留单位与未知口径说明。

demo使用与在线率、告警及CSV完全独立的固定合成计数。各型号筛选相加恢复全体计数；全体丢失率从合计分子/分母重新计算，不能平均各型号百分比。

| 型号 | 合成应上报记录 | 合成实收记录 | 合成缺失记录 |
|---|---:|---:|---:|
| YA70A20 | 120000 | 119040 | 960 |
| YA70B20 | 96000 | 94560 | 1440 |
| YA70B25 | 108000 | 105840 | 2160 |
| YA70B30/YA70Pro | 132000 | 128040 | 3960 |
| YA70LAB | 84000 | 84000 | 0 |

这些是演示fixture，不能用于判断真实设备丢包、采样率或上报频率。真实数据接入前还需验证上报计划、去重、重传、迟到数据和预期记录的业务定义。

`GET /api/workbench/users/demo-001?source=demo` 返回 `{source,user,waveform,events,event_count,date}`。events 为 `{id,start,end,type,status:'candidate'}`，start/end 为演示波形相对秒；event_count 与返回 events 长度一致，与该用户 UserRow.events_24h 一致。waveform 为合成全天显示样本（不是声称从真实波形降采样），建议 600~720 点/通道。抽屉展示缩放、拖动、图例与候选时间线；数据来自该用户的独立 detail 请求，旧请求不得覆盖新选用户。

`GET /api/workbench/detection-context` 由主 agent 整合检测 agent 的只读桥；本地当前文件未关联数据库用户。该桥返回结构由检测 agent 文档/函数定义，不阻塞前端，可仅用明确 `/events` 入口。

首页 `/` 与 `/dashboard` 由构建后的 `page_design/web/index.html` 提供，静态资源统一 `/workbench-assets/`。Vite 设置 `base:'/workbench-assets/'`，输出到 `../web`，资源置 `assets/`（HTTP prefix 后保持实际子路径）。主 agent 提供宿主路由。原 `/events`、检测 API、旧 dashboard 资源保留兼容。开发在 frontend 内构建；Python 统一入口不要求用户运行两套服务。

## 展示与行为

采用需求的顶部栏+左菜单+主体+右侧洞察。白/浅灰、医疗蓝 #1E6FFF、13~14px正文、8px圆角；面板克制，图表占主体。1920/1440优先，较窄屏洞察区可收起、面板重排。

四卡展示昨日活跃、治疗小时、演示模型事件、设备在线率；历史在线率与当前在线率须分清。前端显示环比、7日迷你趋势、在线进度环。previous=0不除零，null不补0。标签体现演示模型事件，不把后台上报与本地候选相加。

左趋势按需求使用小时柱+活跃人数折线，两个Y轴明确单位、各自从0开始、图例清楚；“依从性”无定义不声称已计算。右趋势将事件次数和在线率分成上下对齐的独立坐标图，避免把次数与百分比共用Y轴。ECharts resize/销毁、图例、tooltip、dataZoom正确。

重点用户表按状态/优先级筛选。优先级为演示巡检规则，非患者健康/诊断风险。漏气上色只基于 fixture.leak_flag，界面标演示单位/门限待确认，不擅自采纳附件阈值。点击行打开抽屉。未连接时禁用详情，未知与0区别保留。

严重工程告警最多3张30秒合成快照；无critical告警时显示互斥告警类型分布，并提供“模拟无严重告警”本地开关来验收两种状态。首页不展示完整长波形。

右侧洞察使用数据生成的明确“规则摘要（非大模型运行）”，描述观察、证据、待核实和下一步，不将漏气原因诊断为面罩松动。支持本地导出当前可追溯演示报告、生成本地复核/随访草稿；不发送消息。未接能力明确状态，不做虚假请求。

10秒自动刷新默认可控，停止/隐藏时清理；源切换/型号/抽屉用请求取消或序号避免旧结果覆盖；趋势数据内容未变不重复闪动。当前时间只是时钟，不伪装数据延迟，延迟显示未接入或未知。数据错误有重试，不混入旧来源数据。

附件提出的10Hz、治疗状态/压力阈值、漏气阈值和暂停规则属于待验证提案；本轮不据此更改既有检测器。对临床AHI、诊断/调压不新增功能。
