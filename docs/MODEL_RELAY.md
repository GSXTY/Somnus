# Somnus 模型中继

中继供受邀用户使用。客户端只拿到自己的访问令牌，上游 DeepSeek API Key 由服务端保存。中继独立部署，只提供模型请求入口和健康检查。

## 服务端

在受控主机上安装项目的 `requirements.txt`，用服务管理器的环境变量配置以下项目。

| 环境变量 | 用途 |
| --- | --- |
| `SOMNUS_MODEL_RELAY_UPSTREAM_KEY` | 本次使用的 DeepSeek API Key。 |
| `SOMNUS_MODEL_RELAY_INVITES` | 以空格分隔的访问令牌，每位朋友一个。用 `python -c "import secrets; print(secrets.token_urlsafe(32))"` 生成各自的令牌。 |
| `SOMNUS_MODEL_RELAY_MODELS` | 以空格分隔的允许模型，例如 `deepseek-flash`。 |
| `SOMNUS_MODEL_RELAY_DB` | 现有目录下的用量 SQLite 文件，目录归运行账户管理。 |
| `SOMNUS_MODEL_RELAY_CONTROL` | 可选的本机共享开关文件。默认使用用量数据库所在目录的 `sharing.json`。 |
| `SOMNUS_MODEL_RELAY_INVITE_DAILY` | 每个令牌每日最多请求数，默认 20。 |
| `SOMNUS_MODEL_RELAY_TOTAL_DAILY` | 全部令牌每日合计最多请求数，默认 100。 |
| `SOMNUS_MODEL_RELAY_REQUEST_BYTES` | 单次请求体上限，默认 262144 字节。 |
| `SOMNUS_MODEL_RELAY_OUTPUT_TOKENS` | 单次最大生成 token 数，默认 2048。 |

运行 `python -m model_relay`，由 HTTPS 反向代理转发 `POST /v1/chat/completions`。代理应关闭响应缓冲，以便转发流式响应；服务本身只监听 `127.0.0.1:8894`。令牌用量按 UTC 日计数，准备转发的请求即占用一次额度，替换上游 Key 或删除邀请令牌后重启中继生效。

在维护后台打开模型共享后，受邀用户可以发起模型请求。关闭开关后，下一次已认证请求收到 HTTP 503，正在生成的回复仍可结束。开关即时生效，重启时沿用本机状态。开关文件缺失或无效时保持关闭。HTTPS 转发只指向模型中继的端口。

## 客户端

给朋友一对用于其 Somnus 的中继域名和个人邀请令牌。可通过 Provider 加入，也可为本机内置模型写入该安装自己的私有 `.env`。

```dotenv
AI_ASSISTANT_BASE_URL=https://somnus-model.example.invalid/v1
AI_ASSISTANT_MODEL=deepseek-flash
AI_ASSISTANT_API_KEY=<该朋友的邀请令牌>
```

Windows 将 `.env` 放在 `%LOCALAPPDATA%\VVFLY\Somnus`，macOS 放在 `~/Library/Application Support/VVFLY/RespiratoryViewer` 或该安装自定义的数据目录。域名示例需要换成已部署的中继地址。访问令牌用于中继认证，个人安装配置单独交付。
