# 局域网数据网关

同事可以在 Somnus 中通过 HTTPS 连接同一 Wi-Fi 网络中的 Windows 网关，读取数据看板和已批准的数据表。数据库和模型连接配置留在网关主机。以后把网关、配置和证书迁到独立服务器，再修改客户端地址即可。

## 网关主机

1. 在项目根目录安装依赖。

   ```powershell
   python -m pip install -r requirements-gateway.txt
   ```

2. 在项目目录之外保存私有配置和 TLS 文件。网关的证书必须包含客户端连接使用的 IP 或域名。网关要求明确配置数据库 URL，不使用默认演示库。

   ```dotenv
   DATA_AGENT_GATEWAY_HOST=192.168.1.68
   DATA_AGENT_GATEWAY_PORT=8443
   DATA_AGENT_GATEWAY_CERT=gateway-cert.pem
   DATA_AGENT_GATEWAY_KEY=gateway-key.pem
   DATA_AGENT_GATEWAY_TOKENS=<生成至少 32 个字符的 URL 安全令牌>
   ANALYTICS_DB_URL=<网关专用只读数据库连接>
   ANALYTICS_SQL_TABLES=app_user,product_info,resp_statistics_ya70
   DATA_AGENT_GATEWAY_SQL_ENABLED=1
   DATA_AGENT_GATEWAY_SQL_TABLES=resp_statistics_ya70
   ```

   多个令牌以逗号分隔。用于手动查询和 AI 查询的表由 `DATA_AGENT_GATEWAY_SQL_TABLES` 指定，必须是 `ANALYTICS_SQL_TABLES` 的子集。数据库账号也应只授予看板及共享查询所需的读取权限。看板固定查询读取统计、用户和设备聚合指标。默认关闭 SQL，明确启用后才可读取 SQL 表结构并执行查询。自然语言查询还需在网关配置现有模型连接。

3. 启动网关。已有进程环境变量优先于配置文件。证书及私钥的相对路径以配置文件所在目录为准。

   ```powershell
   .\tools\start_data_gateway.ps1 -Config 'C:\DataAgentGateway\gateway.env'
   ```

   可用 `-BindAddress`、`-Port`、`-Certificate` 和 `-PrivateKey` 覆盖地址、端口及 TLS 文件。服务使用指定网卡的私有地址，在 Windows 防火墙的专用网络配置文件上为网关端口设置同子网访问范围。网关未启动时，客户端会显示连接错误。

## 同事的 Windows 桌面版

1. 把公开的网关证书保存到 `%LOCALAPPDATA%\VVFLY\RespiratoryViewer\`。通过单独的渠道取得访问令牌。
2. 在同一目录的 `.env` 中配置以下三项，并重启桌面程序。证书文件也可以用绝对路径指定。已有旧版的程序目录 `.env` 时，先检查该文件是否覆盖了对应配置。

   ```dotenv
   DATA_AGENT_REMOTE_URL=https://192.168.1.68:8443
   DATA_AGENT_REMOTE_TOKEN=<分配给该用户的访问令牌>
   DATA_AGENT_REMOTE_CA=gateway-cert.pem
   ```

3. 在桌面程序的系统设置中确认远程数据地址。数据看板和数据查询会请求网关。会话、上传文件与波形分析继续使用桌面端的数据。

## 远程深度分析

如需让同事在「深度分析」页上传 CSV 或 Excel 并使用网关主机的模型和 Docker，可在网关配置中额外设置：

```dotenv
DATA_AGENT_GATEWAY_DEEP_ENABLED=1
DATA_AGENT_GATEWAY_DEEP_DIR=C:\DataAgentGateway\deep-analysis
DATA_AGENT_GATEWAY_DEEP_TOKENS=<同事甲独立令牌>,<同事乙独立令牌>
DEEP_ANALYSIS_BASE_URL=<分析模型地址>
DEEP_ANALYSIS_MODEL=<分析模型名>
DEEP_ANALYSIS_API_KEY=<分析模型密钥>
DEEP_ANALYSIS_DOCKER_IMAGE=ya70-deep-analysis:trial
```

每枚深度分析令牌也须列在 `DATA_AGENT_GATEWAY_TOKENS`，并且仅发给一位同事。普通看板和 SQL 令牌可继续使用原权限。任务、上传和产物归独立令牌所属会话，同一令牌在多台电脑上会访问同一份任务。换令牌会建立新会话。网关目录保存原始上传的规范化副本、任务记录及分析产物，运维人员应按实际授权设置目录权限和保留期限。

网关主机需运行 Linux 容器模式的 Docker Desktop，并提前构建分析镜像。程序会读取模型与 Docker 就绪状态，用户可在独立的「深度分析」页面查看。普通聊天和本地波形分析沿用本机流程。

默认单文件 5 MiB，可用 `DEEP_ANALYSIS_MAX_FILE_MB` 调整至 1–20 MiB。远程 Excel 解压后上限为 128 MiB，超出时可缩小范围或另存为 CSV。每枚令牌可保留至多 100 个文件、合计 100 MiB，网关同时运行至多 2 个分析任务。单个产物上限 10 MiB，每次任务产物合计上限 30 MiB。任务超时和运行轮数沿用 `DEEP_ANALYSIS_*` 的配置。文件内容由网关分析，问题、字段和受限执行输出会发给配置的模型服务。

网关访问令牌和证书私钥应由主机管理员保管。更换 Wi-Fi、主机 IP 或部署位置后，客户端地址和证书的主机标识需要匹配。

## 开发者管理页面

在网关主机的网关配置文件中加入以下设置，使用独立的管理员密码。管理员密码与同事的访问令牌分别生成和保管。

```dotenv
DATA_AGENT_GATEWAY_ADMIN_PASSWORD=<独立生成的至少 32 字符随机密码>
DATA_AGENT_GATEWAY_USER_LABELS={"<同事甲独立访问令牌>":"同事甲","<同事乙独立访问令牌>":"同事乙"}
DATA_AGENT_GATEWAY_USAGE_DB=gateway-usage.sqlite3
```

- 用户备注可省略。每位同事分别使用一个已加入 `DATA_AGENT_GATEWAY_TOKENS` 的访问令牌。多人共用令牌时，管理页面只会显示一条身份记录。
- 使用记录文件默认为网关配置文件旁边的 `gateway-usage.sqlite3`。迁移到服务器时可一并迁移。保存内容仅包括令牌的不可逆标识、统计次数、时间和客户端版本。
- 独立生成管理员密码可在主机上运行 `python -c "import secrets; print(secrets.token_urlsafe(32))"`。只将生成结果保存到主机网关配置，不写入同事的客户端配置。
- 从项目根目录重新运行 `.\tools\start_data_gateway.ps1 -Config 'C:\DataAgentGateway\gateway.env'`。用浏览器打开配置的 HTTPS 网关地址加 `/admin`，输入用户名 `admin` 和管理员密码。网关部署时使用的证书需在浏览器端受信任。
- 新版 Windows 桌面应用配置远程网关后，启动时和每隔一分钟报告运行状态。150 秒内有心跳显示「近期在线」。旧版客户端调用网关数据接口时同样会留下使用次数和时间，最近 15 分钟内有请求显示「最近访问」。本地模式的使用不经过网关。
- 如需撤销访问，请从主机配置的普通访问令牌、深度分析令牌和用户备注中一并移除对应配置，然后重启网关。

