# YA70 业务巡检前端

React 18 + TypeScript + Ant Design 5 + ECharts 5；全部依赖本地打包，不使用外部 CDN。业务接口与口径以 `../../docs/WORKBENCH_IMPLEMENTATION_CONTRACT.md` 为准。

在本目录运行 `pnpm install --frozen-lockfile` 安装依赖，使用 `pnpm test` 运行测试，使用 `pnpm build` 构建。产物输出到 `../web`，静态资源路径前缀为 `/workbench-assets/`。

若环境的 pnpm 版本管理器试图重查依赖，可在已安装后直接运行 `node node_modules/typescript/bin/tsc --noEmit`、`node scripts/publish-build.mjs` 和 `node --test tests/*.test.mjs`。`publish-build.mjs` 在外置临时目录构建、按 manifest 校验后原子替换 `../web`；直接 `vite build` 会先清空产物目录，失败即丢失资源。API测试利用Node 24原生TypeScript读取能力；不额外引入测试框架。

页面总是请求 `/api/workbench`，用户抽屉单独请求 `/api/workbench/users/:id`。默认显式演示；真实来源未连接时不回退假数据。提供10秒可控轮询、页面隐藏暂停、请求代际保护与取消。ECharts 在容器变化时 resize、卸载时 dispose；未改变的数据不反复重置图表。

演示优先级是工程巡检规则，不是患者健康分数；未采用附件中待核实的采样率或检测门限。报告为本地文本下载（包含快照 JSON）；复核草稿为可编辑浏览器本地草稿，不外发消息。设备、告警和设置的未接写能力不提供虚假操作。

当前检查：类型检查与34项接口/逻辑测试通过，生产构建已生成。实际浏览器导航与视觉由主 agent 验收；不能仅凭构建通过宣称视觉验收通过。首页不再显示检测快捷卡，侧栏“数据分析”进入App内 `/#analysis`（小屏保留图标导航），不自动绑定示例用户与本地 CSV。

首页原告警分布/严重快照卡已替换为独立数据丢失率环图（已接收/数据丢失），告警中心保留。`data_quality` 按应上报、已接收、丢失记录数量校验，率=丢失/应上报×100%；真实来源未知和零分母保持—。完整basis写入导出报告，卡片仅显示简要公式。

## AI 数据助手第一版

左侧“AI 数据助手”进入 `/#assistant`，刷新可保持该入口并恢复上次会话；独立历史栏支持新建、重命名（最多80字）和继续提问。会话由本机后端保存，浏览器只保存最近会话ID，不自行虚构回答或统计。流式对话使用同源 `/api/assistant/conversations/{id}/messages`，支持停止、断流/错误提示及历史恢复；离开页面时对活动请求发送取消并中止读取。

模型连接状态来自 `/api/assistant/status`，分为未配置、已配置待验证及最近请求成功，后者不表示服务持续在线。页面不录入密钥；折叠配置说明提供 `AI_ASSISTANT_BASE_URL`、`AI_ASSISTANT_MODEL`、`AI_ASSISTANT_API_KEY`。配置由服务环境加载，修改后重启服务。发送的问题及会话上下文会经后端传给所配置模型服务。

数据库与图表工具未接入，助手始终明确说明其限制，不把首页合成数据当作真实统计，也不自动读取CSV。未配置时允许管理会话、整理问题，发送入口明确禁用；无假SQL查询、图表或模型按钮。

`tests/assistant.test.mjs` 通过模拟fetch/SSE覆盖UTF-8逐字节分块、CRLF、多行事件、失败/取消/断流、未配置、空消息、历史/重命名与同源发送；这些测试不调用外部模型。主agent负责真实浏览器的页面导航、会话管理和视觉验收。

### 会话移除与图片草稿

当前会话标题旁提供“删除”，确认框明确会话名称并说明从列表移除；后端为软删除。成功后清空当前文字/图片草稿及旧会话偏好，转到剩余最近会话；删除失败保留当前内容。生成、加载或删除中阻止冲突操作，不提供嵌套按钮的历史行删除。

输入区支持直接粘贴图片和通过“图片”选择文件，预览及移除均在本地完成。支持PNG/JPEG/WebP，最多4张、单张5MiB、合计10MiB，单边8192像素及总1600万像素以内；只有点击发送才上传。服务器显式开启 `AI_ASSISTANT_VISION_ENABLED=true` 且配置支持图片的模型后才允许发图，未开启时可整理草稿但发送被阻止，不能静默丢图；启用后可发纯图。失败或中断恢复本次文字与图片草稿，历史图片使用服务保存的本地dataURL呈现，不加载外部图片URL。

`assistant-ui.test.mjs` 使用真实组件事件与确定性hook/service替身，验证clipboardData.items中的图片File经过onPaste、预览/移除、vision开关、纯图发送/失败恢复，以及删除后的下一会话/空态/失败回滚/互斥操作；这些测试不访问用户会话或外部模型。

### 固定应用壳与数据分析

全局顶栏与184px侧栏固定在应用视口中（窄屏保留64px/48px图标导航），body不滚动；普通工作区只在中间面板滚动，洞察sticky按内容滚动区定位。AI助手与数据分析分别支持 `#assistant`、`#analysis` 刷新定位。

数据分析首次访问才挂载 `AnalysisView` 的同源 `/events?embedded=1` iframe，此后切换页面只隐藏同实例，不卸载或修改src；CSV对象、波形位置、当前批次和复核草稿留在原检测运行时，不重新导入。嵌入页隐藏重复主壳，但保留文件选择和内部事件工具；不迁移或改写算法。

父子仅使用同源 `analysis:visibility` 通知恢复重绘，不传CSV、用户数据或模型上下文。检测agent负责嵌入初始化/严格origin与source校验及重绘，页面agent负责外壳和嵌入CSS。旧 `/events` 独立地址继续兼容；新导航、用户详情和设置均走App内分析入口。

### 独立深度分析试用

`DeepAnalysis.tsx` 使用独立同源 `/api/deep-analysis`，不借用 `/api/assistant` 或改变原聊天配置。入口为 `#deep-analysis`，支持刷新定位和命令搜索；退出时停止前端轮询，服务器任务继续运行，重新进入可恢复本浏览器最近任务ID。

状态分别显示模型配置齐备、Docker可用、执行镜像已准备和执行就绪。环境不齐时仍可上传选择的CSV，并创建 `blocked` 条件检查任务；界面明确“当前无法执行”，没有假报告、样例推导的真实统计或宿主机执行回退。合成样例从 `/sample.csv` 下载，用户必须明确选择上传。

图表和报告只允许后端返回的 `/api/deep-analysis/artifacts/{受控ID}`；PNG/JPEG/WebP可图片预览，HTML/SVG等不内联执行。Markdown使用现有安全文本渲染器。表格字段、文件指纹、任务状态和错误均来自后端；状态请求失败不使用演示回退。

`deep-analysis.test.mjs` 覆盖独立路由、同源上传、blocked任务、请求错误/任务ID错配和产物URL限制；`deep-analysis-ui.test.mjs` 调用真实组件事件验证缺环境时仍可检查条件、没有伪报告，以及失败后保留文件与问题。全部测试使用本机替身，不调用外部模型或上传公司数据。

执行镜像请只使用独立目录构建，避免把仓库、`.env` 或原始数据放入构建上下文：

```sh
docker build -t ya70-deep-analysis:trial -f deep_analysis/Dockerfile.exec deep_analysis
```

后端样例为80位合成用户×7日；其中缺失率是预设的输入示例，不是呼吸波形算法计算结果。
