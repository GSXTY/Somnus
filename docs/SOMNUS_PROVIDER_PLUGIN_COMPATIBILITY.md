# Somnus Provider 与插件界面兼容配置

本文面向开发者。Somnus 保留自己的聊天、项目、群聊、文件审阅和数据权限；DSH 是执行运行时。Provider 只决定模型来源，聊天身份仍为 Somnus。

## 每模型能力

通过现有模型创建/编辑接口保存以下字段；它们属于模型，不属于整个 Provider 连接。省略或 `null` 保留兼容默认值，不表示已经探测上游服务。

```json
{
  "context_window": 200000,
  "max_output_tokens": 32000,
  "supports_developer_role": true,
  "supports_long_cache_retention": true,
  "cache_retention": "long"
}
```

- `context_window`：1024–10000000 的整数。默认已识别 DeepSeek Flash/Pro 为 1000000，其余模型保守为 64000；填写值须符合真实服务限制。
- `max_output_tokens`：1–1000000 的整数，必须为输入预留 `min(8192, context_window / 2)`。默认取 `min(16384, context_window / 4)`。
- `supports_developer_role`：`null / false / true`。兼容默认不发送 developer 角色；原生 Anthropic、Bedrock 不使用此开关。
- `supports_long_cache_retention`：`null / false / true`。默认不声明长期缓存；当前 Bedrock 适配器不提供此兼容开关。
- `cache_retention`：`null / "none" / "short" / "long"`。长期缓存要求上项明确为 `true`。这是向服务请求缓存的策略，不保证服务接受或命中。
- 原有 `retry_policy` 仍在 Provider 连接级配置。模型兼容/缓存策略不同会生成隔离的 DSH Provider profile，避免串用。

中继透传并校验 Responses/Chat Completions 的 `prompt_cache_key`、`prompt_cache_retention`、Responses 的 `prompt_cache_options`，以及 Anthropic 原生内容中的短期/长期 `cache_control`。显式不支持的设置会被拒绝；服务拒绝的参数不会被静默删除后重试。

小窗口模型的压缩余量按当前已配置模型中的最小输入预算保守缩放，并保留 DSH 原有预设表达式和平台条件。配置容量不是扩大模型的实际容量；极小窗口可能仍容纳不下大量工具说明，应减少工具或选择更大模型。

## 声明插件安全页面与扩展入口

社区插件可在自己的 package.json 中声明静态页面；路径相对插件安装目录。页面必须有 `index.html`，禁止路径穿越、符号链接跳出和跨插件引用。

```json
{
  "name": "@example/somnus-demo",
  "version": "1.0.0",
  "dsh": {
    "somnus": {
      "pages": [
        { "id": "panel", "title": "示例插件", "directory": "ui", "sidebar": true }
      ],
      "extensions": [
        { "id": "settings", "label": "插件设置", "slot": "settings", "renderer": "page", "pageId": "panel" },
        { "id": "navigation", "label": "示例插件", "slot": "sidebar", "renderer": "page", "pageId": "panel" }
      ]
    }
  }
}
```

`pages` 自动产生设置入口，`sidebar: true` 额外产生侧栏入口。`extensions` 可明确入口名称与位置；`pageId` 只能指向本插件已经验证的页面。只有已安装并启用插件会出现在注册表中。

宿主向 Somnus 页面提供只读注册表：

```js
await window.somnusDshPluginPage.extensions();
// 或仅查询一个插件
await window.somnusDshPluginPage.extensions('@example/somnus-demo');
```

每项包含 `id / pluginId / label / slot / renderer / compatibility`，可打开的安全页面另外带完整 `pageId`。`compatibility` 为 `ready` 或 `adapter-required`；后者附 `reason`，不能据此执行任意插件 JavaScript。

## 兼容边界

- Skill、MCP、后端工具与 UI 插件分别管理；有工具能力不代表已适配界面。
- DSH 原生 slot 组件不会自动成为 Somnus React 组件。未声明安全页面的原生 client 会显示“需要适配”。
- 当前聊天卡片只将已适配的官方个性化推荐标记为可用，沿用现有推荐数据格式和渲染器。
- 普通插件自行声明 `slot: "chat-card"` 或 `renderer: "recommendation"` 不会获得任意界面执行权限，仍显示需要适配。
- 插件页面使用现有隔离页面宿主、内容安全策略和仅本插件设置访问，不获得 Somnus 的模型密钥或公司数据授权。
