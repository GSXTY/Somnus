# OSCAR / S9 事件逻辑追溯与 YA70 检测优化

**后续更正（2026-11-09）**：使用者已明确确认YA70 CSV“流量”为患者呼吸流量；本文原先据旧配置写的“机器总流量/患者流量未验证”不再适用于当前输入解释。原始研究回放与历史证据保留，新的患者流量优化与OSCAR借鉴说明见 [患者流量v4](../PATIENT_FLOW_V4.md)。

日期：2026-11-09。研究对象：用户提供的 OSCAR 2.1.1 Windows 安装包、`D:/oscar_data/S9data/S9data` 原始 S9 文件，以及项目恢复目录中按内容去重的三份 YA70 CSV。未运行安装包、改写原始数据、保存检测标记或改变当前默认算法。

## 核心结论

**截图里的 OA、CA、低通气，主要是 S9 设备已经写入的事件，OSCAR 负责导入与显示。不能把截图当成 OSCAR 已公开了 ResMed 设备内部分类算法。** OSCAR 确实另有可选的用户自定义波形标记，但它和设备事件是两条路径。

适合我们借鉴的是：通道独立时间轴与物理标定、事件来源分离、幅度参考的稳健性、持续时长和重叠处理、原始数值证据及可复核的边界。暂不直接移植 OA/CA 判别、固定漏气阈值或依赖零交叉的患者流量呼吸分割。

已实现独立只读残余片段对照和人工复核评估工具。它们提供优化依据，**还没有证据支持“准确率已经提高”**。

## 证据链与版本

1. [OSCAR 官方下载页](https://www.sleepfiles.com/OSCAR/)指向2.1.1及其公开源码。官方 GitLab 标签 `v2.1.1` 的提交为 `4f14624616d62c6986788417bc5c519c807a7ade`；分析固定到此提交，而不是变化中的 master。源码文件指纹与下载地址保存在本机 `build/research/oscar/source-provenance.json`。
2. [REA 官方仓库](https://github.com/morluto/rea)：获取官方 npm 包 `rea-agents@6.8.0`，核对 npm 发布的 SHA-512 完整性。包来源与摘要在 `build/research/rea-integrity.json`。使用它原有的 `PeImportsService / PeImportsProvider` 静态读取器，不注册 MCP、不更改 Codex 配置。完整 CLI 依赖下载遇到网络失败后停止，改为调用同包静态模块及其缓存校验依赖；没有把未成功的 CLI 安装算作完成。
3. REA 已实际分析用户安装包：27,320,944 字节，SHA-256 `8756c7d4732a82a6ad88e5b08afc6c987e103d3ffac6e18bd5f83b1d6dfee0b2`；外层为 PE32 x86，观察到 Windows 系统 DLL 导入。另有只读字节证据出现 Inno Setup 标识。这说明这里检查到的是安装器外层，不能据此认定内部 OSCAR 主程序是32位，更不能由导入表推出事件分类。完整证据 `build/research/oscar/rea-installer-evidence.json`。
4. 又从官方2.1.1下载页取得免安装包，解包到独立研究目录，未运行。REA 已实际检查其中的 `OSCAR.exe`：14,695,424字节、PE64、SHA-256 `4d915495f95d29828a305674b7ab0c6a25c3be3d711890ed96ebde6503519c4c`，导入 Qt6Core/Widgets/Sql 等及 C++ 运行库。REA 对解包目录检查了141个条目、39个文件头，范围内检查完整。证据与来源分别在 `rea-runtime-evidence.json`、`rea-directory-evidence.json`、`portable-provenance.json`。这份官方免安装主程序没有被宣称与用户安装包内部主程序逐字节相同。
5. 当前没有使用 Ghidra/IDA/Hopper 反编译主程序，没有取得 ResMed 固件。下面的事件逻辑来自已固定的公开源码与原始 EDF 交叉验证；不是声称完成了厂商固件逆向。

外部 GPL 源码只保留在忽略的研究目录供核对，未复制到默认检测器。新增模块依据 EDF 数据格式及我们既有计算输出独立实现。

## 两条事件路径

| 路径 | 输入与处理 | 输出含义 |
|---|---|---|
| S9 原始设备事件 | `ResmedLoader::LoadEVE` 解析 EDF+ 注释；按文本映射通道、检查是否位于会话内，再保存注释时间与时长 | 设备上报 OA/CA/H/UA 等；这里没有根据流量重算类别 |
| OSCAR 用户自定义标记 | `FlowParser::calcPeaks` 形成呼吸片段；`flagUserEvents` 用峰值参考与可配置比例/持续时长找流量受限间隙 | UF1 / UF2 自定义标记；不会因此证明 OA、CA 或低通气 |

源码定位：[resmed_loader.cpp](https://gitlab.com/CrimsonNape/oscar-sql/-/blob/v2.1.1/oscar/SleepLib/loader_plugins/resmed_loader.cpp)，L3330–3405；标签映射 L4025–4029。`LoadBRP` L3443–3476 导入流量波形并将 L/s 转为 L/min，时间步长由文件记录长度与样本数计算。`LoadPLD` 独立读取较慢的参数通道。

自定义逻辑定位：[calcs.cpp](https://gitlab.com/CrimsonNape/oscar-sql/-/blob/v2.1.1/oscar/SleepLib/calcs.cpp)，L308–394、L703–855：

- 呼吸分段依赖流量正负零交叉，还检查峰值、峰谷幅度及周期长度。
- 在当前处理的 flow 块中，收集每个呼吸正负峰的绝对值，用约60分位作参考，再乘用户设置的 restriction 百分比得到门限。这不是“下降百分比”和“剩余百分比”可混用的规则。
- 找相邻超过门限的呼吸部分之间的低流量间隙，达到用户设置的持续时间才标记。事件标记放在结束时刻，另存时长。
- 受用户设置开关控制，少于5个有效呼吸不运行。可抑制与现有设备/用户标记重复；可选重同步还可能修改已导入事件的时间/时长（`SearchEvent` L22–79）。做对照时应保留原始 EDF，不把可能重同步的 UI 导出当不变标签。

这些都是实际程序行为，不是完整临床评分规则。整块60分位还会使用后面的数据，不适合直接当在线因果基线；变化大的整晚记录也可能不适合单一全局参考。

### S9 设备本身怎样区分气道状态

[ResMed 官方 S9 临床指南](https://document.resmed.com/zh-cn/secure/clinical-guide/s9-series/s9-autoset-elite-h5i_clinical-guide_row_eng.pdf)印刷页8（PDF第12页）描述：设备发现暂停后，叠加4 Hz、峰峰值1 cmH2O的小幅压力振荡，并使用面罩处流量与压力响应评估气道开放情况。这是设备主动探测流程；公开说明没有给出其完整阈值、滤波、状态机和固件实现。

对 YA70 的启发是把设备试探脉动、噪声与自主呼吸恢复分开复核。波形里还有小振荡不能直接等同恢复了正常呼吸；看到压力波动也不能直接认定实施了同样的探测。只有确认 YA70 的设备行为、同步采样时钟、传感器标定及探测状态后，才适合研究响应特征。现在不发送任何探测指令，也不新增 CA/OA 自动分类。

## 用户提供的 S9 数据与截图核对

`Identification.*` 用于设备识别，`.crc` 不是事件时间表。`STR.edf` 是日级汇总，详细波形和事件在 `DATALOG`。本次只读 EDF 模块同时处理每个通道的样本数、数字量到物理量标定和 EDF+ TAL 注释；文件头身份字段不输出。

| 文件类型 | 2019-12-28 样本文件头起始时间 | 数据与采样 |
|---|---|---|
| BRP | 23:09:52 | 流量、面罩压力，25 Hz，6300秒 |
| EVE | 23:09:53 | 原始事件注释；记录时长为0，不能据此说整晚没有数据 |
| PLD | 23:09:54 | 治疗压力、漏气等11个通道，0.5 Hz，6300秒 |
| SAD | 23:09:55 | 脉率、SpO2，1 Hz，6300秒；信号有效性需另查 |

时间均为设备文件头时间，没有擅自指定时区。文件名时间与文件头也不同。数值通道会话并集为23:09:52至次日00:54:55，与截图1小时45分03秒一致。

EVE 的原始标记（offset + EVE 文件头；表内“标记时刻”不是自动当作起点）：

| 标记时刻 | 设备文本 | 记录时长 |
|---|---|---:|
| 23:21:30 | Central Apnea | 12秒 |
| 23:21:43 | Central Apnea | 13秒 |
| 23:30:12 | Obstructive Apnea | 23秒 |
| 23:31:04 | Obstructive Apnea | 17秒 |
| 23:32:49 | Central Apnea | 25秒 |
| 23:47:50 | Hypopnea | 77秒 |
| 23:49:07 | Central Apnea | 11秒 |

共4 CA、2 OA、1 H，时长合计178秒，即2分58秒。7条除以截图会话小时数约4.00，与截图一致；这里只复核显示来源，没有从 YA70 CSV 计算临床 AHI。STR 的 AHI 为设备汇总4.0，部分分项指标精度较低；不能要求它与完整事件重算的每个小数完全相同。

`gLineOverlay.cpp` L193–209 将事件标记放在时间 X，覆盖范围向前减 duration。截图的两个 OA 标记恰好对应23:30:12和23:31:04。评估前必须明确“末端标记+时长”和“起点+时长”的语义；弄反会造成整段时间偏移。

原始证据：`build/research/oscar/s9-evidence-final.json`，包含每个EDF的SHA-256与字节数。当前数值读取针对连续记录；检测到EDF+D时拒绝拼出均匀数值时间轴，需另行实现逐记录TAL时钟。对照图：

![S9原始EDF与截图相同时间窗](../../build/research/oscar/evidence-figures/s9-event-evidence.png)

这份 S9 样本能验证我们的导入、单位、对齐与事件展示，也可作为设备标记的一致性研究数据。它不是同一用户同时采集的 YA70 数据，不能拿它的7条事件去评价其他 YA70 记录。

## 我们的检测器：先改什么

源码审查与行号详见 [LOCAL_DETECTOR_AUDIT.md](LOCAL_DETECTOR_AUDIT.md)。当前默认版本为 `dynamic-baseline-optimized-v3-configurable-v22`，默认 `detrended_abs / W5 / D10`，机器总流量波动强度采用因果背景与滚动参考。

| 优先级 | 已发现的问题 | 建议与本次落地 |
|---|---|---|
| P1 | 同父过程有强核心就不再处理弱段；强核心修正后不够长，也无弱段回退 | 已复现并实现独立残余对照。先明确是“一个父过程一条”还是“互斥片段”，不能简单强弱各计一次 |
| P1 | 秒内行顺序四分组参与节律/边界修正，但250ms时间未验证 | 增加行密度、重复值、缺失更新敏感性实验；未获真实高分辨率时钟前，不把细分组当精确相位 |
| P1 | 事后修正后的 `confirmed_at` 不等于结果首次可用时间 | 分开记录门限达到、首次候选、最终边界确定时刻；用逐秒前缀回放验证，不拿离线结果推实时延迟 |
| P2 | 模式/状态只检查稳定性，没有已验证治疗状态白名单 | 先取得设备枚举，未知状态单列；不猜0/3等值的含义 |
| P2 | 压力、总漏气、机流量与患者流量含义不同 | 同步证据与质量提示；不直接用总漏气减机流量，不照搬 S9 固定漏气门限，不凭压力脉动自动判 CA/OA |
| P2 | 设备探测脉动/噪声可能被幅度特征当成自主呼吸 | 结合高频压力、流量和探测状态构造复核特征；S9 的 FOT 参数只用于理解其行为，不能未经验证移植到 YA70 |

我们的滚动参考已比简单全块参考更适合基线变化；不要为了“像 OSCAR”退回全局60分位。比较不同幅度方法时，先用相同文件、时间范围、质量规则和人工标签。

## 已实现的对照与结果

`event_detection/research/residual_recovery.py` 从现有 compute 的 source/traces/events 中找连续有效、同段、主窗剩余比<50%的范围，减去原事件区间并集，只把仍达最短时长的残余列为 `review_difference_only`。不产生可直接保存的事件身份，不修改默认 v3 或原标记。

| 唯一CSV指纹前12位 | 原输出 | 待复核差异片段 |
|---|---:|---:|
| e5ffeaeaae43（8888秒） | 69 | 12 |
| 54edcc0e9061（268秒） | 2 | 0 |
| 45439a53238e（248秒） | 1 | 0 |

原输出不是临床事件数；新增差异不代表新增真事件。比如 `[6444,6485]` 是主窗弱父段减原输出后的41秒残余；另外 `[3518,3528]`、`[6254,6264]`、`[8446,8456]` 与边界修正拒绝相关，值得优先人工复核，也可能属于原有边界排除的合理结果。

![YA70源秒统计与待复核差异](../../build/research/oscar/evidence-figures/ya70-residual-evidence.png)

全部区间、数值证据与耗时见本地 `data/reports/residual-recovery-default-v3.json`；实验口径见 [RESIDUAL_RECOVERY_EXPERIMENT.md](RESIDUAL_RECOVERY_EXPERIMENT.md)。

## 怎样证明提高准确性

当前事件库2397条全是 candidate，没有人工确认或排除记录。需要先用现有复核与导出流程建立人工参照，且完整检查连续区间、补标漏报，不能只看算法已经检出的候选。

新增 `event_detection/research/evaluate.py` 可读取既有人工复核导出：同 CSV 指纹、原始秒轴、明确类型和范围；排除边界未知段、拒绝未处理候选。使用事件区间 IoU 门限（默认0.3，需在看结果前约定）做一对一最大匹配，避免一个参考被多条检测重复算正确。报告 precision、recall、F1、每复核小时误报数及起止误差；spot逐条复核不输出这些整体准确性指标，不虚构真阴性。

建议先人工完整复核长记录中的差异区间及相邻正常呼吸，再完整复核独立连续范围。开发与验收按真实用户/会话分组；内容相同的恢复副本不能分到两组。S9 设备标记可作弱参照，不能代替独立人工判读。三个现有 YA70 文件也可能来自同一设备，不能因此声称跨用户泛化。

## 复现命令

在项目根目录运行；输出全部留在研究目录，不写设备卡或标注库。

```powershell
python -m event_detection.research.edf_evidence "D:/oscar_data/S9data/S9data" --date 2019-12-28 --output build/research/s9-new.json
python -m event_detection.research.residual_recovery --csv "某份YA70.csv" > build/research/ya70-comparison.json
python -m event_detection.research.evaluate --predictions predictions.json --reviewed exported.reviewed.json --output build/research/metrics-new.json
python -m unittest discover -s tests -p "test_*research*.py"
python -m unittest discover -s tests -p "test_edf_evidence.py"
python -m unittest discover -s tests -p "test_residual_recovery.py"
```

注意：残余对照输出是差异报告，不是 `--predictions` 所需的事件包；不要把待复核残余直接当已验证新检测器传入评估。预测包应有原始CSV指纹、`time_basis=raw`、明确起止与类型的 `events` 和参数 `settings`。

REA静态复现（可选、固定内部模块接口，不是默认服务依赖）：

```powershell
node event_detection/research/rea_probe.mjs --rea-root build/research/rea-cli/package --pe "D:/Backup/Downloads/OSCAR-2.1.1-Win64.exe" --output build/research/rea-new.json
```

新增模块是研究工具；不自动将患者事件分类、分数或实验标记接入生产页面。默认检测优化应在复核证据充分后作为明确新版本进入原有单一方案选择与共享扫描/复核/导出流程。

## 验证记录

当前新增人工评估9项、残余对照8项、EDF解析7项检查通过；原v3相关23项回归通过，共47项。EDF测试和v3本机接口测试初次运行受临时目录权限限制，使用允许创建临时文件和本机服务的权限重跑后通过。评估命令入口也用明确的合成例子检查了指标与禁止覆盖输出。两张证据图由真实源数据生成并已打开核对，图上区间、单位及图例可读。
