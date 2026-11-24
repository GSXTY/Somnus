# Somnus 主页插件（`@local/somnus-home-plugin`）

主页不再是软件内置页面，而是这个 DSH 插件：装上软件后，在「插件」页导入本文件夹，
重启后侧边栏出现「主页」，并且启动时直接落在主页。

- 插件目录：`plugins-ui/somnus-home/`（仓库顶层，与 `app/`、`desktop/` 并列，不打进 `app.asar`）
- 页面代码就是原来内置主页的同一份源码（`src/LegacyWorkbench.tsx` →
  `src/LegacyHomeDashboard.tsx` → `src/LegacyChart.tsx`），没有重写
- 数据仍走本机 Somnus 服务：`window.somnusApi.request('/api/workbench?...')`

## 目录与文件作用（给维护者看）

| 文件 | 作用 |
| --- | --- |
| `package.json` | 插件清单：`name: @local/somnus-home-plugin`、`type: module`、`exports`（`.` / `./client` / `./icon`）、`dsh.bundle.patch`、`dsh.client`（`platform: web`、`immediately: true`） |
| `cordis.patch.yml` | 插件自带配置层，必须是 `- insert:` 形式；写成空数组 `[]` 会导致插件不出现在「插件」页 |
| `index.js` | Host 半段：只有 `export function apply() {}`，不读数据、不注册工具、不提供服务 |
| `icon.svg` | 「插件」页展示用的 16×16 图标 |
| `src/entry.tsx` | 客户端模块入口：注册 `main` 主面板（key `plugin-home`）、`sidebar.panellist` 侧边栏入口、注入 CSS、首次打开时设为默认页 |
| `src/LegacyWorkbench.tsx` | 主页页面组件（设备型号筛选、自动刷新、深色主题跟随） |
| `src/LegacyHomeDashboard.tsx` | 主页 KPI / 概览 / 趋势 / 脚注 |
| `src/LegacyChart.tsx` | echarts 包装 |
| `src/legacy-workbench.css` | 主页外壳样式 |
| `src/home-shell.css` | 只属于主页的补充样式（侧边栏「主页」入口的圆角/悬停过渡，从 `somnus-workbench.css` 同源复制） |
| `build.mjs` | 构建脚本，产出 `dist/client.js` |
| `dist/client.js` | 构建产物（约 1.58 MiB，含 echarts），**已随仓库提交**，普通安装不需要自己构建 |
| `README.md` | 本文件 |

## 用户安装步骤（非开发者照做即可）

1. 先正常安装/打开 SomnusNext（`app/Somnus.exe` 或 `启动 SomnusNext.cmd`）。
2. 在左侧边栏打开「插件」页。
3. 点「添加插件」，选择本机上的插件文件夹
   `D:\VVFLY\SomnusNext\plugins-ui\somnus-home`
   —— 要选到 **`somnus-home` 这一层**（里面有 `package.json` 的那一层），
   不要选 `plugins-ui`，也不要选里面的 `src` 或 `dist`。
4. 在「插件」页确认 `somnus-home-plugin`（`@local/somnus-home-plugin`）处于启用状态。
5. **完全退出并重启** SomnusNext（客户端脚本只有重启后才重新加载）。
6. 验收：
   - 侧边栏出现「主页」入口，图标是房子；
   - 启动后直接停在主页（不再停在会话页）；
   - 主页上能看到「数据更新」条、「概览」4 个指标卡和「趋势」两张图；
   - 断网/未配置数据源时页面仍能打开，并显示「尚未配置数据连接」之类的说明文字。
7. 如果侧边栏没出现「主页」：回到「插件」页看该插件是否启用；仍不行，检查插件目录里
   `cordis.patch.yml` 是否是 `- insert:` 形式（不能是 `[]`），然后重新添加并重启。

## 构建步骤（改了 `src/` 之后才需要）

在仓库根目录执行（不安装依赖、不联网，直接用仓库里已有的 esbuild）：

```powershell
cd D:\VVFLY\SomnusNext\plugins-ui\somnus-home
node build.mjs
```

- esbuild 0.24.2 直接取 `page_design/frontend/node_modules/esbuild`
- `jsx: 'transform'`（经典 JSX → `React.createElement`）、`external: ['react']`、
  `format: 'cjs'`，产物再包成 `window.__ModuleLoader__.load({ id, factory(require) { ... } })`
- `factory` 里的 `var React = require('react')` 是经典 JSX 必需的，不能删
- `.css` 用 `text` loader 当字符串导入，由 `entry.tsx` 注入 `<style>`
- echarts 从 `page_design/frontend/node_modules` 打包进来，所以产物约 1.58 MiB
- 构建时会出现两条 “Ignoring this import because … was marked as having no side effects”
  警告：那是组件内部的 `import './x.css'` 被丢弃，属于预期；CSS 由 `entry.tsx` 显式导入并注入
- 构建完把新的 `dist/client.js` 和插件一起重新添加/重启即可生效
- `dist/client.js` 是**要提交的安装产物**（不是构建缓存）：仓库根 `.gitignore` 里对
  `/plugins-ui/somnus-home/dist/` 和 `/plugins-ui/somnus-home/dist/client.js` 做了例外，
  确保换机器 checkout 后无需构建就能直接导入插件

## 回滚步骤

1. 在「插件」页停用或删除 `somnus-home-plugin`，重启软件。
2. 停用后软件本体不再提供主页页面（主页只存在于本插件里），侧边栏只剩「文档」「工具」。
3. 需要恢复旧行为时，从 Git 历史取出来：
   ```powershell
   git --git-dir=.somnus-git --work-tree=. log --oneline -- desktop/dsh_next/client/LegacyWorkbench.tsx
   git --git-dir=.somnus-git --work-tree=. show <commit>:desktop/dsh_next/client/LegacyWorkbench.tsx > desktop/dsh_next/client/LegacyWorkbench.tsx
   ```
   同时把 `somnus-workbench.tsx` 里 `pages` 的 home 行、`Panel()` 的 home 分支、`zh/en` 的
   `home` 标签、`PageKey` / `IconName` 的 `'home'` 和 `PanelIcon` 的 `home` 路径加回来，
   并重新构建本机程序的客户端（`tools/rebuild_next.py`，需由负责人执行）。
4. 插件目录本身可以保留，重新启用即可再次得到主页。

## 与旧内置主页的差异

| 项目 | 旧内置版 | 本插件版 |
| --- | --- | --- |
| 面板 key | `somnus-home` | `plugin-home` |
| 侧边栏入口 | 一个「主页」 | 一个「主页」（`order: -10`） |
| 标签来源 | `somnus-workbench` locale 的 `home` | 入口 `label` 固定中文「主页」，未注册 locale 命名空间 |
| 样式注入 | 随内置客户端 bundle 加载 | `entry.tsx` 追加 `<style data-somnus-home-plugin="styles">`，`home-dashboard.css` 收在 `.somnus-native-home` 之下（与内置 overlay 一致） |
| 启动默认页 | 无（停在会话页） | `activePanelId === null` 时自动 `selectPanel('plugin-home')`，即启动落在主页 |
| 卸载后 | 页面回到内置版本 | 页面彻底消失（这是本插件的设计目标） |

注：DSH 的 `activePanelId` 只存在内存里（不持久化），所以每次重启/刷新都会判定一次
「还没选过面板」，从而每次都落在主页。用户手动切到别的页面后，本次运行内不会被抢回来。

## 已知限制

- 插件未提供 `locale/*.json` 的 `meta.title` / `meta.description` / `meta.detail`，
  「插件」页会回退显示包名和 `package.json` 的 `description`。
- `dist/client.js` 是构建快照：如果 `page_design/frontend/src/dashboard/home-dashboard.css`
  或 `src/` 里的组件改了，必须重新 `node build.mjs` 才会变化。
- 构建直接读 `page_design/frontend/node_modules`；该依赖目录被清理时需要先恢复依赖。
