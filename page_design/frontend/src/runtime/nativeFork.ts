import { Modal } from "antd";
export async function confirmedNativeFork(request: {
    conversationId: string;
    turnId: string;
    atSeq?: number;
    subagentId?: string;
}) {
    const bridge = window.somnusNativeDshChat;
    if (!bridge?.fork)
        throw Error("当前宿主不支持原生会话分支。");
    const accepted = await new Promise<boolean>(resolve => Modal.confirm({ title: "创建独立会话分支", content: "新会话与来源共享当前文件目录，不创建新的 Git 分支，也不回滚已有文件。新会话默认只读，后续操作独立授权。", okText: "创建共享目录分支", cancelText: "取消", onOk: () => { resolve(true); }, onCancel: () => { resolve(false); } }));
    if (!accepted)
        throw Error("已取消创建分支。");
    return bridge.fork({ ...request, worktreePolicy: "share-current" });
}
