# 工具页插件对照件（tools-probe）

把**内置「工具」页整页**以 DSH 插件的形式渲染一遍，用于和内置页并排对比，判断“插件版能否完全替代内置页”。内置页本身**一行未改**，两者并存。

- 插件包名：`@local/somnus-tools-probe`
- 面板 key / 侧边栏 id：`plugin-tools`
- 侧边栏标签：**工具（插件）**，`order: -7.5`（紧挨内置「工具」的 -8 之后）
- 不抢默认页（不会调用 `layout.selectPanel`）

## 为什么能“完全一样”

`src/entry.tsx` 不重写界面，直接 import 仓库里的同一份组件：

```
desktop/dsh_next/client/NativeTools.tsx        ← 工具页本体（卡片、搜索、前置条件）
  ├─ page_design/frontend/src/dashboard/SqlQuery.tsx         ← 数据查询
  ├─ page_design/frontend/src/analysis/DeepAnalysis.tsx      ← 深度分析
  └─ desktop/dsh_next/client/NativeWaveform.tsx              ← 波形分析（shadow DOM + /events）
```

CSS 同源：`native-tools.css`、`sql-query.css`、`deep-analysis.css`、`deep-analysis-report.css`（后三份按内置构建同样的方式收在 `.somnus-native-tools` 作用域内）。`NativeWaveform` 的 `?somnus-native` 资源导入复用内置构建的同一个 esbuild 插件（`desktop/dsh_next/client/waveform-build.mjs`），避免两套实现漂移。

## 构建

```powershell
cd D:\VVFLY\SomnusNext\plugins-ui\tools-probe
node build.mjs
```

输出 `dist/client.js`（约 2.5 MB，含 antd；`react` / `react-dom` 由宿主提供，不打进包）。

## 安装与对比

1. 重启 Somnus → 侧边栏「插件」→ 添加插件 → 选择本目录（含 `package.json` 这一层）
2. 完全退出并重新打开
3. 侧边栏会出现「工具（插件）」，点它与内置「工具」并排对比

对比清单：

- 三张卡片：标题、说明、「本机文件 / 需配置模型 / 需数据库」标签
- 搜索框过滤
- 数据查询：查一次表结构、跑一条示例问题
- 深度分析：状态、上传文件、任务列表
- 波形分析：点开能否正常加载 `/events` 页面（重点）
- 深色模式

## 已知对照偏差（不是 bug）

1. **状态键共用**：内置页用 `useRetainedToolState('native-tools:active')` / `('native-tools:visited')` 记录“上次打开哪个工具、哪些已加载”。两个页面共存时会共用同一组键，在一页切换可能影响另一页的初始状态。这是对照实验的固有干扰。
2. **两套 React 风险已规避**：`react-dom` 由宿主模块表提供（external），否则会出现第二份 React DOM，antd 的 Portal/Image 可能异常。
3. 体积：插件自带 antd，和内置页共用主程序体积不同。

## 回滚

插件页停用或删除该插件 → 重启。内置「工具」页始终存在，不受影响。
