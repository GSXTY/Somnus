# 工具页插件（tools-probe）

把**原内置「工具」页整页**以 DSH 插件的形式渲染。用户并排对比后确认与内置页效果一致，因此内置页已从软件本体移除；自 2026-11-24 起，本插件是「工具」页的唯一实现，页面源码由插件自带。

- 插件包名：`@local/somnus-tools-probe`
- 面板 key / 侧边栏 id：`plugin-tools`
- 侧边栏标签：**工具（插件）**，`order: -7.5`
- 不抢默认页（不会调用 `layout.selectPanel`）

内置实现的原始备份在 `plugins-ui/_backup/builtin-tools-2026-11-24/`（含恢复步骤）。

## 为什么能“完全一样”

`src/entry.tsx` 不重写界面，直接 import 插件自带、原样搬来的同一份组件：

```
plugins-ui/tools-probe/src/NativeTools.tsx   ← 工具页本体（卡片、搜索、前置条件）
  ├─ page_design/frontend/src/dashboard/SqlQuery.tsx         ← 数据查询
  ├─ page_design/frontend/src/analysis/DeepAnalysis.tsx      ← 深度分析
  └─ desktop/dsh_next/client/NativeWaveform.tsx              ← 波形分析（shadow DOM + /events）
```

CSS 同源：`src/native-tools.css`、`sql-query.css`、`deep-analysis.css`、`deep-analysis-report.css`（后三份按原内置构建同样的方式收在 `.somnus-native-tools` 作用域内）。`NativeWaveform` 的 `?somnus-native` 资源导入复用 `desktop/dsh_next/client/waveform-build.mjs` 这同一个 esbuild 插件。

## 构建

```powershell
cd D:\VVFLY\SomnusNext\plugins-ui\tools-probe
node build.mjs
```

输出 `dist/client.js`（约 2.5 MB，含 antd；`react` / `react-dom` 由宿主提供，不打进包）。

## 安装

1. 重启 Somnus → 侧边栏「插件」→ 添加插件 → 选择本目录（含 `package.json` 这一层）
2. 完全退出并重新打开
3. 侧边栏出现「工具（插件）」，即原内置「工具」页的全部内容

（内置页移除前的验收清单，仍可作为回归检查项：三张卡片与前置条件标签、搜索过滤、数据查询、深度分析、波形分析 `/events`、深色模式。）

## 已知限制（不是 bug）

1. **状态键沿用旧内置键**：`useRetainedToolState('native-tools:active')` / `('native-tools:visited')` 记录“上次打开哪个工具、哪些已加载”。键名保持不变，升级后用户的上次状态不丢；若将来再并存第二个工具页，两者会共用这组键。
2. **React 单一实例**：`react-dom` 由宿主模块表提供（external），否则会出现第二份 React DOM，antd 的 Portal/Image 可能异常。
3. 体积：插件自带 antd，与原先内置页计入主程序体积的方式不同。

## 回滚

要退回内置工具页，按 `plugins-ui/_backup/builtin-tools-2026-11-24/README.md` 的恢复步骤操作；之后停用或删除本插件即可。
