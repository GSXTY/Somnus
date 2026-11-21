# Somnus 工作模式

Somnus 从当前 DSH 运行时的 `agentPresets/list` 读取模式，而不是维护一份静态可用清单。
固定运行时提供 `standard`、`ptc`、`minimal`、`cordis`；`cordis` 在界面显示为 Creator mode。
加载失败的模式不可选，插件的内部错误、堆栈和配置不会直接暴露到界面。

模式决定工具组合，文件权限仍由只读、修改前确认、工作区直接修改和完全访问单独决定。
它只影响 Somnus 原生聊天，不修改外接 Codex、DSH ACP 成员各自的配置。

- Standard：通用原生工具和本轮明确授权的 Somnus 工具。
- PTC：程序化批量调用工具；Somnus 数据/MCP 调用仍经过父轮的授权桥和审批。
- Minimal：只保留原生终端与图片工具，不暴露 Somnus 项目提案、公司数据或 MCP 工具。
- Creator：使用运行时的插件开发与自省工具；不自动把探索结果晋升为 Somnus 默认插件或标准版。

通过 Somnus 启停或新增插件会重建托管运行时，重新建立模式隔离；Minimal 也会对延迟登记的全局工具更新屏蔽范围。
Creator 的原生插件管理工具由 DSH 要求完全访问或本次审批，且修改可能影响此 Profile 内其他会话，不会自动获得默认插件发行权限。

## 选择与持久化

`somnusNativeDshChat.listAgentModes` 返回实际清单、请求模式、原生实际模式和锁状态。
`selectAgentMode` 在空白会话中由原生 `session/create(agentPreset)` 或 `agentPresets/select` 确认，随后保存到会话的 `agent_mode`。
一旦开始原生轮次，DSH 不允许原地换组合；界面提供新建会话选择模式。原会话与文件不会删除。
旧会话的空值不强行等同 Standard，优先读取运行时记录的实际组合。

切换期间在本机 DSH Home 的 `somnus-mode-transactions` 保存不含密钥的事务标记。
保存失败会尝试恢复原生组合，并读取实际投影确认。无法确认时阻止继续发送或执行命令，跨宿主重启仍有效。
空白会话可再次明确选择模式恢复；已经开始的会话应新建会话，不通过改文件绕过锁。

## 委托边界

DSH 子任务继承启动时的权限范围，不能自行扩大授权。需 Somnus 本轮凭据的数据或 MCP 结果应由父 Agent 先获取，再委托分析。
不会仅追踪父会话 ID 后借用根会话的最新凭据；缺少可靠父轮证据的子任务请求保持拒绝。
