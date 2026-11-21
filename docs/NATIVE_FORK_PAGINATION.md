# Native fork：共享工作树和继承历史

本轮只适配 Windows 探索版。远程控制不在产品对标范围；已有数据网关不受影响。

## 工作树

工作树 fork 必须显式选择 `worktree_policy: share-current`。这会复用经过验证的同一 Git 工作树，不创建 Git 分支、不清理或复制文件；已暂存、未暂存和未跟踪内容保持原状。新会话默认只读，后续写操作仍需该会话自己的新轮授权。返回的 worktree 元数据明确标记 shared、源会话与规范 owner。

共享引用与规范绑定分别存储。源会话软删除或归档不会清除文件；源工作目录映射或目录身份变化会拒绝继续使用失效引用，而不会落回主仓库。源会话当前不可访问时不能再据它新建 fork。独立目标的已提交继承历史仍可读取。

## 长历史

原生上下文由真实 DSH session/fork 继承。显示历史是独立的只读归档，不伪装成新模型消息或复制旧工具权限。宿主逐页提交真实来源的序号片段；提交前分支不可见，完成后与目标会话绑定原子提交。

每页最多100片段、紧凑UTF-8 JSON64KiB；单次归档最多64MiB和100000片段。有界分页取代旧100条/512KiB单请求限制，并非无限历史。每片段包含 seq、part、role、content、final；跨页事件可倒序，但读取始终按seq/part升序。单条长消息按Unicode字符和字节安全拆分，分片必须完整连续。

页面索引严格有序；相同页面重试按内容指纹幂等，冲突或不完整尾部拒绝。中止仅清理未提交归档。GET目标会话 inherited-history 按绑定游标分页，在服务重启后仍可读取；不依赖源会话仍展示在侧栏。描述只包含会话/归档ID、片段/字节数量、提交时间和内容SHA256，无原始私密路径、凭据。

## 模型与Skill偏好

每个独立会话可保存 provider_model_id 和最多3个已启用Skill，带revision防止另一窗口覆盖。保存偏好不执行模型、不切换已有原生session身份、不修改权限。删除/归档会话不能写偏好。附件继续使用原有每轮最多3个文档规则。

## 插件界面

声明式version1在原text/list/metrics之外支持table/chart/status/form，新增save-own-settings动作仍只能由宿主对插件自身已声明设置进行验证和保存。禁止HTML、脚本、跨插件页面和任意命令。文档32KiB、20块、8动作；文本长度统一按UTF16 code units，序列化大小按紧凑UTF8 JSON。共同验收样例见tests/fixtures/plugin-ui-contract.json；这表示受支持声明式合同一致，不表示任意DSH浏览器插件都已实测兼容。

## 验证

`python -m unittest tests.test_fork_history tests.test_fork_history_api tests.test_worktree_native_fork tests.test_native_preferences tests.test_plugin_ui_contract`

测试只用隔离临时Git仓库、合成文档和本机假模型，不调用真实模型或用户业务数据。
