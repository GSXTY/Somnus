# 内置「工具」页备份（2026-11-24）

这是 Somnus 原生工作台**内置「工具」页**被移除前的完整实现备份，用于日后需要时原样恢复。

## 备份信息

| 项目 | 内容 |
| --- | --- |
| 备份日期 | 2026-11-24 |
| 分支 | `feat/tools-page-as-plugin` |
| 移除前 HEAD | `724c9d1`（`probe(tools): render the built-in tools page as a plugin for side-by-side comparison`） |
| 移除提交 | `26b567a`（`feat(tools): move the tools page out of the shell into the tools-probe bundle`） |
| 来源路径 1 | `desktop/dsh_next/client/NativeTools.tsx`（10278 字节，SHA-256 `1DE2B0E344C092B45A41341F9E0DF35F1D13021A7A220FF153A5285BCB302F51`） |
| 来源路径 2 | `desktop/dsh_next/client/native-tools.css`（8094 字节，SHA-256 `00F079CAB3ABAAD0340ECFCBEB5EA29877A8900C1450FEE2D6279DE254800E6E`） |

备份时的文件与当时工作区文件**逐字节一致**（用 SHA-256 校验，前后值相同）。

## 背景

移除此内置页之前，「工具」页与对照插件 `plugins-ui/tools-probe`（直接 import 内置组件的同一份源码）并排运行；用户对比后确认两者效果一致，因此把内置实现移出软件本体，以后「工具」页只由插件提供。

工具页组件依赖的同目录/共享文件**没有**被删除，仍留在原处：

- `desktop/dsh_next/client/NativeWaveform.tsx`
- `page_design/frontend/src/dashboard/SqlQuery.tsx`
- `page_design/frontend/src/analysis/DeepAnalysis.tsx`、`deepAnalysisApi.mjs`
- `page_design/frontend/src/configuration/DataConnection.tsx`
- `page_design/frontend/src/plugins/workspacePlugins.tsx`
- `page_design/frontend/src/shared/useRetainedToolState.ts`

## 恢复步骤

1. **放回两个文件**到 `desktop/dsh_next/client/`：

   ```powershell
   Copy-Item -LiteralPath .\plugins-ui\_backup\builtin-tools-2026-11-24\NativeTools.tsx .\desktop\dsh_next\client\NativeTools.tsx
   Copy-Item -LiteralPath .\plugins-ui\_backup\builtin-tools-2026-11-24\native-tools.css .\desktop\dsh_next\client\native-tools.css
   ```

   注意：备份里的 `NativeTools.tsx` 使用**旧位置**的相对路径（`./NativeWaveform`、`./native-tools.css`、`../../../page_design/...`），只有放回 `desktop/dsh_next/client/` 才成立。**不要**直接把它拷进 `plugins-ui/tools-probe/src/`（那里的同名文件已经改成 `../../../desktop/dsh_next/client/NativeWaveform`）。

2. **在 `desktop/dsh_next/client/somnus-workbench.tsx` 恢复 `tools` 页面**，共四处：

   1. 顶部 import 之后加回懒加载：

      ```tsx
      const NativeTools = lazy(() => import('./NativeTools'))
      ```

      并把首行 import 恢复为带 `lazy, Suspense`：

      ```tsx
      import { lazy, Suspense, useEffect, useRef, useState } from 'react'
      ```

   2. `zh` / `en` 里加回标签：

      ```ts
      tools: '工具',   // zh
      tools: 'Tools',  // en
      ```

      同时把 `type PageKey` / `type IconName` 的联合类型加回 `'tools'`，并在 `PanelIcon` 的 `paths` 里加回：

      ```tsx
      tools: <><path d="m14.5 5.5 4 4-9 9-4-4z" /><path d="M6.5 16.5 5 18a2.1 2.1 0 0 1-3-3l1.5-1.5" /></>,
      ```

   3. `pages` 数组里加回条目（顺序要紧挨 documents，`view: 'plugins'`）：

      ```ts
      { id: 'somnus-tools' as MainPanelId, key: 'tools', view: 'plugins', icon: 'tools', order: -8 },
      ```

   4. `Panel()` 里加回分支：

      ```tsx
      if (page.key === 'tools') return <Suspense fallback={<div className="somnus-frame-state">正在加载工具…</div>}><NativeTools /></Suspense>
      ```

3. **在 `desktop/dsh_next/client/tsconfig.native-ui.json` 的 `include` 里加回** `"NativeTools.tsx"`。

4. **重新构建**：按项目常规流程重建原生客户端（`node desktop/dsh_next/build.mjs` 或 `desktop/dsh_next/source-build.mjs` 的项目既定入口；不要用 `rebuild_next.py` / `build_electron.py`）。仅改源码不会影响已打包的 `app.asar`。

5. 恢复后建议顺手处理插件：`plugins-ui/tools-probe` 会与内置页同时注册「工具」和「工具（插件）」两个入口，二者状态键（`native-tools:active` / `native-tools:visited`）相同。若不想并排，停用或删除该插件即可。

## 校验

```powershell
Get-FileHash -Algorithm SHA256 .\desktop\dsh_next\client\NativeTools.tsx, .\desktop\dsh_next\client\native-tools.css
```

应与上表的 SHA-256 一致。
