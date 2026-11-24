# 数据查询（Somnus 业务工具插件）

内置「工具」页里的一张卡片由本插件提供：点卡片 → 切到本插件注册的页面。

- 包名：`@local/somnus-tool-sql`
- 面板 key：`plugin-tool-sql-query`
- 卡片：数据查询 · 需数据库 · order 3
- 标记：`package.json` 里 `dsh.somnus.kind = "tool"`（工具页只认这一类的插件）

## 页面来源

界面不是重写，直接复用仓库源码构建：

- 数据查询：`page_design/frontend/src/dashboard/SqlQuery.tsx`
- 深度分析：`page_design/frontend/src/analysis/DeepAnalysis.tsx`
- 波形分析：`desktop/dsh_next/client/NativeWaveform.tsx`

## 构建

```powershell
cd D:\VVFLY\SomnusNext\plugins-ui\tools\sql-query
node build.mjs
```

产物 `dist/client.js`（`react` / `react-dom` 由宿主提供，antd 打进包）。

## 安装 / 验证

- 随安装包分发：打包脚本会把它复制到 `app\resources\bundles\sql-query`，首次启动自动注册进 profile
- 本地手动安装：插件页 → 添加插件 → 选本目录（含 `package.json`）→ 重启
- 验证：内置「工具」页出现「数据查询」卡片，点开能看到页面

## 回滚

插件页停用/删除该插件 → 重启。内置工具页仍在，只是少一张卡片。