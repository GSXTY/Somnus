import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Alert, Button, Tag } from "antd";
import type { ChatAttachment, Skill, ReasoningEffort } from "../chat/assistantApi";
import { SkillPicker, SkillChips } from "../chat/SkillPicker";
import { ModelSwitch } from "../chat/ModelSwitch";
import { DocumentPicker } from "../documents/DocumentLibrary";
import { documentBridge, readDocumentFile } from "../documents/documentLibraryBridge";
import { prepareImages } from "../chat/assistantImages.mjs";
export type ChildMedia = {
    images: ChatAttachment[];
    files: {
        id: string;
        name: string;
    }[];
    skills: Skill[];
    modelId?: string;
    effort?: ReasoningEffort;
};
export const emptyChildMedia = (): ChildMedia => ({ images: [], files: [], skills: [] });
export type ChildMediaInput = {
    addFiles: (files: File[]) => void;
};
export const ChildComposerExtras = forwardRef<ChildMediaInput, {
    value: ChildMedia;
    onChange: (value: ChildMedia) => void;
    disabled: boolean;
    onBusy: (busy: boolean) => void;
}>(function ChildComposerExtras({ value, onChange, disabled, onBusy }, ref) {
    const input = useRef<HTMLInputElement>(null);
    const [library, setLibrary] = useState(false), [error, setError] = useState("");
    const alive = useRef(true), lock = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function add(filesOrLoad: File[] | (() => Promise<File[]>)) {
        if (disabled || lock.current)
            return;
        lock.current = true;
        setError("");
        onBusy(true);
        try {
            const files = typeof filesOrLoad === "function" ? await filesOrLoad() : filesOrLoad;
            if (!alive.current)
                return;
            const next = { ...value, images: [...value.images], files: [...value.files] };
            const images = files.filter(file => file.type.startsWith("image/"));
            if (images.length)
                next.images = await prepareImages(images, next.images);
            for (const file of files.filter(file => !file.type.startsWith("image/"))) {
                if (file.size > 10 * 1024 * 1024)
                    throw Error("文件不能超过 10 MB。");
                if (next.files.length >= 3)
                    throw Error("每条消息最多附加三份文档。");
                const response = await fetch("/api/assistant/files", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name) }, body: file });
                const data = await response.json();
                if (!response.ok || !data.file?.id)
                    throw Error(typeof data.error === "string" ? data.error : data.error?.message || "读取文件失败");
                next.files.push({ id: data.file.id, name: data.file.name || file.name });
            }
            if (alive.current)
                onChange(next);
        }
        catch (failure) {
            if (alive.current)
                setError(failure instanceof Error ? failure.message : "无法添加附件");
        }
        finally {
            lock.current = false;
            if (alive.current)
                onBusy(false);
        }
    }
    useImperativeHandle(ref, () => ({ addFiles: files => { void add(files); } }), [disabled, value]);
    return <section className="child-composer-extras" aria-label="子会话附件与模型">
    {error && <Alert type="error" message={error} closable onClose={() => setError("")}/>}
    <div className="child-composer-resources">{value.images.map((image, index) => <Tag key={index} closable={!disabled} onClose={() => onChange({ ...value, images: value.images.filter((_, i) => i !== index) })}><img src={image.data_url} alt={image.name} width="28" height="28"/>{image.name}</Tag>)}
    {value.files.map(file => <Tag key={file.id} closable={!disabled} onClose={() => onChange({ ...value, files: value.files.filter(item => item.id !== file.id) })}>{file.name}</Tag>)}</div>
    <SkillChips selected={value.skills} disabled={disabled} onChange={skills => onChange({ ...value, skills })}/>
    <div className="child-composer-options"><input ref={input} hidden type="file" multiple onChange={event => { void add(Array.from(event.target.files || [])); event.target.value = ""; }}/>
      <Button size="small" disabled={disabled} onClick={() => input.current?.click()}>添加图片或文件</Button>
      {documentBridge() && <Button size="small" disabled={disabled} onClick={() => setLibrary(true)}>私人文档</Button>}
      <SkillPicker selected={value.skills} disabled={disabled} onChange={skills => onChange({ ...value, skills })}/>
      <ModelSwitch providerOnly modelId={value.modelId} effort={value.effort} disabled={disabled} onExternal={() => { }} onConfig={() => window.dispatchEvent(new CustomEvent("somnus:open-provider-settings"))} onChange={(modelId, effort) => onChange({ ...value, modelId, effort })}/>
    </div>
    <DocumentPicker open={library} onClose={() => setLibrary(false)} onPick={(scope, entry) => {
            setLibrary(false);
            void add(async () => {
                const result = await readDocumentFile(scope, entry.path);
                if (result.size > 10 * 1024 * 1024)
                    throw Error("文件不能超过 10 MB。");
                const bytes = Uint8Array.from(atob(result.dataBase64), char => char.charCodeAt(0));
                if (bytes.length !== result.size)
                    throw Error("文件读取不完整。");
                return [new File([bytes], result.name, { type: result.mimeType })];
            });
        }}/>
  </section>;
});
