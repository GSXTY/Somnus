import { useEffect, useState } from "react";
import { Alert, Input, Modal } from "antd";
export function EditMessageBranch({ message, onClose, onCreate }: {
    message?: {
        id: string;
        content: string;
        checkpoint?: string;
    };
    onClose: () => void;
    onCreate: (text: string) => Promise<void>;
}) {
    const [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
    useEffect(() => { setText(message?.content || ""); setError(""); }, [message?.id]);
    return <Modal open={Boolean(message)} title="创建分支草稿" okText="创建分支并放入草稿" cancelText="取消" confirmLoading={busy} onCancel={() => { if (!busy)
        onClose(); }} okButtonProps={{ disabled: !text.trim() }} onOk={async () => { setBusy(true); setError(""); try {
        await onCreate(text);
        onClose();
    }
    catch (failure) {
        setError(failure instanceof Error ? failure.message : "创建分支失败");
    }
    finally {
        setBusy(false);
    } }}>
 <p>{message?.checkpoint ? "保留前一条已完成回复的原生上下文，编辑内容放入新会话草稿。" : "此前没有可用原生检查点，将在同一项目创建新的只读会话。"}旧会话保持原样，只有你点击发送后才运行。</p>
 <Alert type="info" message="文件不会回滚；新分支默认只读。此处只编辑文字，附件请在新分支重新选择。"/>
 {error && <Alert type="error" message={error}/>}<Input.TextArea aria-label="编辑分支输入" autoSize={{ minRows: 5, maxRows: 16 }} value={text} onChange={event => setText(event.target.value)}/>
 </Modal>;
}
