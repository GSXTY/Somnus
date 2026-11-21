# 独立 CSV 批量试跑

## 独立结果查看页

Windows可双击 `start_viewer.cmd`。看到 `READ_ONLY_VIEWER` 提示后打开 http://127.0.0.1:8766 ，使用期间保持该窗口开启。启动错误会显示在窗口中。此入口自动定位脚本目录，可从其他工作目录启动。

在项目根目录执行以下命令，然后打开 http://127.0.0.1:8766 。

```powershell
python batch_analysis_trial/viewer.py --input D:\VVFLY\analyze_test_data_csv --results batch_analysis_trial/docker_runs --port 8766
```

选择批次和文件，点击候选查看前后上下文。可筛选类型、缩放、前后翻页或输入时间范围。默认显示流量、压力、漏气量三个原始通道，源秒重复时间戳保留，绘图按当前范围分桶保留极值。候选列表始终来自完整批次结果。

服务仅监听本机127.0.0.1，只读访问配置的输入与结果目录，加载源文件时验证SHA256与批次一致，最多缓存一份记录。用户归属仍需确认，页面不提供标注写回。按Ctrl+C结束前台服务。

## Docker 执行

在项目根目录执行。Docker Desktop 引擎需可正常访问。

```powershell
docker compose -f batch_analysis_trial/compose.yaml build
docker compose -f batch_analysis_trial/compose.yaml run --rm batch
```

输入目录 `D:\VVFLY\analyze_test_data_csv` 以只读方式挂载到 `/input`。结果写入 `batch_analysis_trial/docker_runs/` 下的新批次目录。容器运行期间禁用网络。镜像只包含批处理脚本、四个检测源码文件和固定版本 Python 依赖，构建上下文由 Dockerfile 专用忽略文件限制。

如需更换输入目录，编辑 compose.yaml 中 `/input` 对应的 source。首次构建需要拉取 Python 基础镜像和依赖。容器完成后退出，使用 `--rm` 清理该次容器，输出保存在主机目录。

Docker 容器执行已由用户完成，结果位于 `docker_runs/20261119_061500_152206/`。该批次5份记录均完成，错误列表为空。结果查看页默认读取此目录中的批次。

本机可使用相同参数验证输出路径。

```powershell
python batch_analysis_trial/run_batch.py --input D:\VVFLY\analyze_test_data_csv --output batch_analysis_trial/local_output_check
```

在项目根目录运行以下命令。

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python batch_analysis_trial/run_batch.py --input D:\VVFLY\analyze_test_data_csv
```

使用现有原始动态基线检测器 `dynamic-baseline-detector-v1`，默认方法为窗口去均值 RMS，2 秒窗口、固定 10 秒持续。参考此前 100 秒，至少 30 个有效秒，剩余强度低于 50% 冻结参考，25% 显著下降核心优先。

需要系统 Python 的 numpy 和 pandas。输入是目录中的 CSV，按文件顺序执行。每次执行在 `runs/` 创建唯一批次目录。

- `summary.csv` 保存逐文件状态、行数、时间范围、可分析秒数和分类计数。
- `*_results.json` 保存原始来源指纹、字段、编码、完整候选及算法证据。
- `*_events.csv` 保存可直接查看的事件时间表。
- `manifest.json` 保存算法配置、任务状态和耗时。
- `errors.json` 保存失败记录，空数组表示本批无失败。
- `report.md` 是中文阅读入口。

本程序使用独立最小读取器，保留源时间戳和原始数值通道，复用项目现有只读检测器，不导入 viewer 服务。结果单独保存，未连接 Somnus 标注数据库。CSV 流量按该算法的未验证机器信号口径解释，候选用于复核。文件设备标识不同，用户归属尚未验证。
