# Somnus Dot 中继

Somnus 桌面端主动连接独立中继。ChatGPT 的 Dot 扩展通过中继接收任务并返回结果。桌面端只发送用户明确派发的文本，本机会话与企业数据库继续由 Somnus 管理。

## Windows 本机验证

在仓库根目录启动独立的回环中继，使用测试数据库目录。

```powershell
python -m dot_relay --local-dev --public-url http://127.0.0.1:8893 --port 8893 --database .tmp/dot-relay-local/relay.sqlite3
```

在另一个 PowerShell 窗口给这次启动指定测试地址。用独立的 Electron 用户数据目录保存测试配对。

```powershell
$env:SOMNUS_DOT_RELAY_URL = 'http://127.0.0.1:8893'
$env:SOMNUS_DOT_RELAY_LOCAL_DEV = '1'
$env:AI_AGENT_DATA_DIR = Join-Path $PWD '.tmp/dot-relay-local/backend-data'
$testProfile = Join-Path $PWD '.tmp/dot-relay-local/electron-profile'
Start-Process -FilePath '.\dist\electron\win-unpacked\Somnus.exe' -ArgumentList ('--user-data-dir="{0}"' -f $testProfile)
```

在设置中生成测试配对码。回环模式只用于本机合成 OAuth 客户端验证，ChatGPT 无法访问本机回环地址。验收可运行 `node --test electron/acp-dot-relay-client.test.cjs` 和 `python -m unittest dot_relay.test_relay -v`。完成后关闭测试窗口和中继。

## 部署正式中继

1. 将 `dot_relay` 服务和依赖部署到受控主机，以独立账户运行。为它准备稳定的 HTTPS 域名、反向代理和独立的 SQLite 持久卷。生产启动省略 `--local-dev`，在 `--public-url` 中填写 HTTPS 域名，并将内部监听保持在回环地址。
2. 用同一个域名提供 `/api/`、`/mcp`、`/oauth/` 和 OAuth 发现端点。中继的 SQLite 包含配对及任务数据，按团队要求设置访问权限、日志和保留期限。
3. 配置 ChatGPT 的 Somnus Dot 扩展，使 MCP 连接使用中继的 `/mcp`。扩展发布后，使用其正式 ChatGPT 安装链接。
4. 在 Windows 的 `%APPDATA%\RespiratoryViewer\somnus-dot-relay.json` 写入中继的 HTTPS 源地址，可选附上已发布的安装链接。地址使用域名根路径。桌面凭据由 Windows 系统凭据能力加密后保存在本机。

```json
{
  "url": "https://dot.example.com",
  "install_url": "https://chatgpt.com/apps/实际发布的应用"
}
```
