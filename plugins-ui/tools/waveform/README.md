# 波形分析（Somnus 业务工具插件）

内置「工具」页里的一张卡片由本插件提供：点卡片 → 切到本插件注册的页面。

- 包名：`@local/somnus-tool-waveform`
- 面板 key：`plugin-tool-waveform`
- 卡片：波形分析 · 本机文件 · order 1
- 标记：`package.json` 里 `dsh.somnus.kind = "tool"`（工具页只认这一类的插件）

## 页面来源

界面不是重写，构建时复用仓库源码：

| 文件 | 作用 |
|---|---|
| `desktop/dsh_next/client/NativeWaveform.tsx` | 宿主组件：把页面塞进 shadow DOM、伪造 `location`/`request`、控制可见性 |
| `event_detection/index.html` | 波形页结构（构建时内联） |
| `event_detection/viewer.js` | 波形页交互逻辑（构建时内联） |
| `event_detection/annotation-model.js` | 标注模型（构建时内联） |
| `page_design/dashboard.css`、`page_design/events.css` | 波形页样式（构建时内联） |
| `desktop/dsh_next/client/native-tools.css` | 工具页外壳基础样式 |

这些 `?somnus-native` 资源由 `desktop/dsh_next/client/waveform-build.mjs` 处理，构建时必须挂上该 esbuild 插件，否则会打出缺资源的空包。

## 共享资源与影响范围（重要）

`event_detection/*` 与两个 CSS **同时被两个宿主使用**：

```
event_detection/*（唯一一份源码）
  ├─ 构建时内联进本插件的 dist/client.js   ← 产品实际使用的入口（工具页）
  └─ 后端按普通网页提供 → http://127.0.0.1:8765/events   ← 仅开发调试用，不对外
```

因此：

| 改这里的 | 工具页的波形分析 | `/events` 调试页 |
|---|---|---|
| `entry.tsx`（卡片文案/顺序/前置条件） | ✅ 变 | 不变 |
| `NativeWaveform.tsx` | ✅ 变 | 不变 |
| `event_detection/*`、`dashboard.css`、`events.css` | ✅ 变 | ✅ 变 |
| `build.mjs` | ✅ 影响产物是否能加载 | 不变 |
| 检测算法（`event_detection/*.py`） | ✅ 变（属于后端，需重建后端） | ✅ 变 |

`/events` 不是产品入口，只用于开发时快速调试波形界面（有开发者工具、刷新即时）。**验证以工具页为准**；改共享资源时顺手看一眼 `/events` 即可。

## 构建

```powershell
cd D:\VVFLY\SomnusNext\plugins-ui\tools\waveform
node build.mjs
```

产物 `dist/client.js`（约 260 KB；本插件不含 antd，`react`/`react-dom` 由宿主提供）。

改完要让运行中的客户端看到，二选一：

```powershell
# 方式 A：同步到安装包副本（当前 profile 的软链指向这里）
Copy-Item dist\client.js D:\VVFLY\SomnusNext\app\resources\bundles\waveform\dist\client.js -Force

# 方式 B：把 profile 里的软链改指向本源码目录（开发期更方便）
```

然后重启 Somnus（或插件页停用再启用）。

## 验证清单

1. 工具页出现「波形分析」卡片，点开能加载页面
2. 选一份 CSV 能出波形、能跑筛查、能看事件列表
3. 切到别的工具再切回来，状态仍在
4. 深色模式下页面样式正常（波形页自带样式，不依赖 antd 主题）
5. 若本次改了 `event_detection/*`：额外打开 `http://127.0.0.1:8765/events` 看一眼

## 回滚

插件页停用/删除该插件 → 重启。内置工具页仍在，只是少一张卡片。

## 不要做的事

- 不要删除 `build.mjs` 里的 `waveformBuildPlugin`（`?somnus-native` 资源会打不进去）
- 不要在本插件里改检测算法（算法在 `event_detection/*.py`，属于后端，改了要重建后端且需 bump 算法版本）
- 不要把 `event_detection/*` 复制一份到插件目录（会造成两份代码漂移；当前单一源码 + 双宿主是刻意的）
