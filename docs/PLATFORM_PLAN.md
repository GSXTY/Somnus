# 平台化改造计划（工作空间 / 模块页面 / 权限）

目标：从「呼吸数据工具」变成「公司内部工作台」——模块可插拔、每个工作空间有自己的数据源和会话、按角色控制权限。

## 现状

| 能力 | 状态 |
|---|---|
| 工具可插拔（plugins/loader.py） | ✅ 已完成 |
| 模块中心（已装模块、工具、入口） | ✅ 已完成 |
| 模块自带页面 | ⬜ |
| 工作空间（模块 + 数据源 + 会话） | ⬜ |
| 权限与审计 | ⬜ |

## 一、数据模型

新增三张表（SQLite，随应用启动迁移）：

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plugin_key TEXT NOT NULL,      -- 关联 plugins/<key>
  data_source TEXT,              -- ANALYTICS_DB_URL 的名称/别名
  created_at REAL,
  archived INTEGER DEFAULT 0
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL,
  user_key TEXT NOT NULL,        -- 登录后的账号；未登录时为浏览器会话
  role TEXT NOT NULL,            -- owner | editor | viewer
  PRIMARY KEY (workspace_id, user_key)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_key TEXT,
  workspace_id TEXT,
  action TEXT,                   -- query | analysis | export | admin
  detail TEXT,
  created_at REAL
);
```

会话表加一列：

```sql
ALTER TABLE conversations ADD COLUMN workspace_id TEXT;
```

## 二、API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workspaces` | 当前用户可见的工作空间 |
| POST | `/api/workspaces` | 创建（name、plugin_key、data_source） |
| PATCH | `/api/workspaces/{id}` | 重命名/归档 |
| GET | `/api/workspaces/{id}/sessions` | 该空间下的会话 |
| GET | `/api/audit?workspace=` | 审计记录（管理员） |

兼容策略：**没有 workspace_id 的旧会话归入「默认空间」**，不丢历史数据。

## 三、UI

```
┌────┬────────────────────┬──────────────────┐
│图标│ 工作空间 ▾          │                  │
│    │  ● 70系列内测        │   会话/内容       │
│    │  ● 客服质检          │                  │
│    │  + 新建工作空间      │                  │
│    ├────────────────────┤                  │
│    │ 会话历史             │                  │
│    │  · 10月11月对比  now │                  │
└────┴────────────────────┴──────────────────┘
```

左侧第二列从「功能菜单」变为「工作空间 + 会话」，功能入口收进工作空间内部。

## 四、权限

| 角色 | 能做什么 |
|---|---|
| viewer | 查看会话与结果，不能发起查询/分析 |
| editor | 发起查询、分析、上传文件 |
| owner | 管理成员、删除空间、导出 |

数据层仍以只读账号兜底：**权限控制的是“能不能发起”，不是“能不能写库”**。

## 五、实施阶段

### 阶段 1：工作空间模型（2~3 天）

- 建表 + 迁移（旧会话进默认空间）
- `/api/workspaces` CRUD
- 会话携带 workspace_id
- 左侧显示工作空间切换

**验收**：新建一个空间 → 在里面聊天 → 切回默认空间 → 历史互不干扰。

### 阶段 2：模块自带页面（3~4 天）

- `plugin.json` 增加 `"ui": "web/index.js"`（构建产物）
- 前端按需加载插件页面，路由为 `/#module/<key>`
- 加载失败降级为模块信息页

**验收**：放一个只有页面的插件目录进去，左侧自动出现入口，页面可用。

### 阶段 3：权限与审计（2~3 天）

- 登录（先做简单账号密码，后续接企业微信/OIDC）
- 角色校验中间件
- 审计记录写表 + 页面查看

**验收**：viewer 角色点「开始分析」被拒绝，且审计里有记录。

## 六、风险

| 风险 | 应对 |
|---|---|
| 迁移破坏旧会话 | 加列 + 默认值，不删不改历史行 |
| 插件页面安全问题 | 插件页面与主应用同源，需约定只读渲染；后续可加 CSP |
| 权限做得太细没人配 | 先只有 owner/editor/viewer 三档 |
| 工作量被低估 | 每个阶段独立验收，不合并上线 |

## 七、现在的建议

先做阶段 1。它是另外两个阶段的地基：没有 workspace_id，权限和模块页面都挂不住。
