# 在 Google Colab 上试跑 DeepAnalyze-8B（仅用于评估）

目标：用一张免费 T4（16GB）把 8B 模型跑起来，挂一个临时公网地址，让本地应用连上去看效果。

> 只用于**一次性效果验证**。Colab 会断线、地址会变、数据出境，不要用于日常使用或真实患者数据。

## 0. 运行环境

- 运行时类型：**GPU → T4**（免费版即可）
- 磁盘：模型约 16GB，Colab 默认 100GB 够用
- 预计耗时：装依赖 5~10 分钟，下模型 10~20 分钟，起服务 3~5 分钟

## 1. 确认 GPU

```python
!nvidia-smi
```

显存应为 15GB 左右。如果是 CPU 运行时，先改运行时类型再继续。

## 2. 安装依赖

```python
!pip -q install "vllm>=0.8.5" bitsandbytes 2>&1 | tail -5
```

```python
# cloudflared：免费、免注册的隧道工具
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
!chmod +x /usr/local/bin/cloudflared
!cloudflared --version
```

## 3. 下载模型

```python
from huggingface_hub import snapshot_download
path = snapshot_download("RUC-DataLab/DeepAnalyze-8B")
print(path)
```

如果提示需要登录，先执行 `!huggingface-cli login` 并填入只读 token。

## 4. 启动 vLLM（16GB 显存走 4-bit）

```python
import subprocess, time, requests

log = open('/tmp/vllm.log', 'w')
proc = subprocess.Popen([
    "python", "-m", "vllm.entrypoints.openai.api_server",
    "--model", path,
    "--served-model-name", "DeepAnalyze-8B",
    "--max-model-len", "8192",
    "--gpu-memory-utilization", "0.92",
    "--quantization", "bitsandbytes",
    "--dtype", "half",
    "--trust-remote-code",
    "--port", "8000",
], stdout=log, stderr=subprocess.STDOUT)

for _ in range(90):
    time.sleep(5)
    try:
        r = requests.get("http://127.0.0.1:8000/v1/models", timeout=3)
        if r.ok:
            print("ready:", r.json())
            break
    except Exception:
        pass
else:
    print("启动失败，查看日志：")
    print(open('/tmp/vllm.log').read()[-3000:])
```

**如果这里 OOM**（日志里出现 `CUDA out of memory`）：

- 把 `--max-model-len` 降到 `4096`
- 或去掉 `--quantization bitsandbytes`，改成先跑官方 `quantize.py` 生成 4-bit 权重再加载

## 5. 开临时公网隧道

```python
import re, subprocess, threading

base_url = {}

def read_tunnel(stream):
    for line in stream:
        m = re.search(r'https://[-a-z0-9]+\.trycloudflare\.com', line)
        if m and 'base_url' not in base_url:
            base_url['base_url'] = m.group(0) + "/v1"
            print("BASE_URL:", base_url['base_url'])

tunnel = subprocess.Popen(
    ["cloudflared", "tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

threading.Thread(target=read_tunnel, args=(tunnel.stdout,), daemon=True).start()
time.sleep(15)
print(base_url.get('base_url', '未拿到地址，稍等几秒再看'))
```

拿到形如 `https://xxx-yyy.trycloudflare.com/v1` 的地址。

## 6. 冒烟测试

```python
import requests, json

BASE = base_url['base_url']
r = requests.post(BASE + "/chat/completions", json={
    "model": "DeepAnalyze-8B",
    "messages": [{"role": "user", "content": "用一句话说明你能做什么"}],
    "max_tokens": 128,
}, timeout=120)
print(json.dumps(r.json(), ensure_ascii=False)[:800])
```

能返回内容就说明模型服务通了。

## 7. 接到本地应用

在项目 `.env` 里改三行（**不要提交真实的隧道地址**）：

```ini
DEEP_ANALYSIS_BASE_URL=https://xxx-yyy.trycloudflare.com/v1
DEEP_ANALYSIS_MODEL=DeepAnalyze-8B
DEEP_ANALYSIS_API_KEY=local
```

重启服务，打开「深度分析」，用 `/api/deep-analysis/sample.csv` 的合成样例跑一个任务。

## 8. 评估时看什么

| 观察项 | 说明 |
|---|---|
| 是否按 `<Code>` / `<Answer>` 输出 | 官方模型还会带 `<Analyze>`，应用已能容忍 |
| 首轮是否直接给可运行代码 | 决定要几轮才出结果 |
| 中文图表是否正常 | 容器里已装 Noto Sans CJK |
| 与 deepseek-flash 的对比 | 同样问题、同一份 CSV，比较轮数、正确性、报告质量 |

## 常见问题

**Q：vLLM 装不上 / 与 torch 冲突**
A：Colab 自带 torch 版本可能与 vLLM 要求不一致。先 `pip install -U torch` 再装 vLLM；仍失败就改用 transformers + bitsandbytes 写一个最简 OpenAI 兼容服务（慢但能跑）。

**Q：隧道地址变了**
A：每次重启都要重新取地址并更新 `.env`。这正是它不能用于日常的原因。

**Q：能传真实患者数据吗**
A：**不能**。Colab 在境外，数据会离开你的控制范围。只用合成样例。

**Q：免费版够吗**
A：够跑通和看效果；长任务容易被限时或断连。要稳定就租云 GPU（24GB）。
