import { DeclarativePluginCards } from "../plugins/DeclarativePlugin";
import { childDraft, saveChildDraft } from "./childDraft";
import { InheritedHistory } from "./InheritedHistory";
import type { ChildMediaInput, ChildMedia } from "./ChildComposerExtras";
import { ChildComposerExtras, emptyChildMedia } from "./ChildComposerExtras";
import { useUiPreferences } from "../configuration/uiPreferences";
import { composerEnterAction, composerShortcutLabels, } from "../chat/composerShortcuts.mjs";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Spin } from "antd";
import { conversation, listProviders, listSkills, beginExternalTurn, finishExternalTurn, } from "../chat/assistantApi";
import type { ChatMessage, Conversation } from "../chat/assistantApi";
import { Markdown } from "../shared/MarkdownView";
import { ActionApproval, AgentQuestions, ExecutionDetails } from "../chat/ExecutionDetails";
import { PermissionSwitch } from "../chat/PermissionSwitch";
import { useRuntimeTasks, refreshRuntimeTasks } from "./runtimeTasks";
import { taskIsActive, taskLabel } from "./runtimeTaskModel.mjs";
import { taskRoute } from "./runtimeBridge";
import type { RuntimeInteractions } from "./runtimeBridge";
export type ChildContinuation = {
    agentId: string;
    providerModelId?: string;
};
export function ChildConversationPane({ id, continuation, onOpenMain, canSend = true, canOpenMain = true, }: {
    id: string;
    continuation?: ChildContinuation;
    onOpenMain: () => void;
    canSend?: boolean;
    canOpenMain?: boolean;
}) {
    const mediaInput = useRef<ChildMediaInput>(null);
    const [preferences] = useUiPreferences();
    const [media, setMedia] = useState(() => childDraft(id)?.media || emptyChildMedia()), [mediaBusy, setMediaBusy] = useState(false);
    const [preferencesBusy, setPreferencesBusy] = useState(true), [preferencesError, setPreferencesError] = useState("");
    const [preferenceReload,setPreferenceReload]=useState(0);
    const prefRevision = useRef(0), prefLoad = useRef(0), prefSaving = useRef(false);
    useEffect(() => {
        let alive = true;
        const generation = ++prefLoad.current;
        const bridge = window.somnusNativeDshChat;
        setMedia(value => ({ ...value, modelId: continuation?.providerModelId }));
        setPreferencesBusy(true);
        setPreferencesError("");
        void Promise.all([bridge?.nativePreferences?.({ conversationId: id }), listSkills()]).then(([saved, skills]) => {
            if (!alive || generation !== prefLoad.current)
                return;
            prefRevision.current = saved?.revision || 0;
            setMedia(value => ({ ...value, modelId: saved && saved.revision > 0 ? saved.provider_model_id || undefined : saved?.continuation?.providerModelId || continuation?.providerModelId, skills: skills.filter(skill => skill.enabled && saved?.skill_ids.includes(skill.id)) }));
        }).catch(failure => { if (alive)
            setPreferencesError(failure instanceof Error ? failure.message : "无法读取会话模型偏好"); }).finally(() => { if (alive)
            setPreferencesBusy(false); });
        return () => { alive = false; prefLoad.current++; };
    }, [id,preferenceReload]);
    async function changeMedia(next: ChildMedia) {
        const changed = next.modelId !== media.modelId || next.skills.map(skill => skill.id).join() !== media.skills.map(skill => skill.id).join();
        setMedia(next);
        if (!changed)
            return;
        const bridge = window.somnusNativeDshChat;
        if (!bridge?.saveNativePreferences) {
            setPreferencesError("当前宿主不能保存会话模型偏好，请更新后再发送。");
            return;
        }
        if (prefSaving.current)
            return;
        prefSaving.current = true;
        setPreferencesBusy(true);
        setPreferencesError("");
        const generation = prefLoad.current;
        try {
            const result = await bridge.saveNativePreferences({ conversationId: id, revision: prefRevision.current, provider_model_id: next.modelId || null, skill_ids: next.skills.map(skill => skill.id) });
            if (generation === prefLoad.current)
                prefRevision.current = result.revision;
        }
        catch (failure) {
            if (generation === prefLoad.current)
                setPreferencesError(failure instanceof Error ? failure.message : "模型偏好保存失败，请重新打开会话确认。");
        }
        finally {
            prefSaving.current = false;
            if (generation === prefLoad.current)
                setPreferencesBusy(false);
        }
    }
    const shortcuts = composerShortcutLabels(preferences.sendKey);
    const [chat, setChat] = useState<Conversation>(), [messages, setMessages] = useState<ChatMessage[]>([]), [text, setText] = useState(() => childDraft(id)?.text || ""), [busy, setBusy] = useState(false), [permissionBusy, setPermissionBusy] = useState(false), [error, setError] = useState(""), [interactions, setInteractions] = useState<RuntimeInteractions>(), [syncPending, setSyncPending] = useState(false);
    useEffect(() => saveChildDraft(id, text, media), [id, text, media]);
    const subscription = useRef<(() => void) | undefined>();
    const pendingReplies = useRef(new Map<string, string>());
    const compositionEnd = useRef(0);
    const messageView = useRef<HTMLDivElement>(null), followReplies = useRef(true);
    useEffect(() => {
        if (followReplies.current && messageView.current)
            messageView.current.scrollTop = messageView.current.scrollHeight;
    }, [messages]);
    useEffect(() => () => {
        subscription.current?.();
        subscription.current = undefined;
    }, []);
    const snapshot = useRuntimeTasks(), task = snapshot.tasks
        .filter((task) => task.conversation_id === id && !task.parent_task_id)
        .sort((a, b) => b.created_at - a.created_at)[0], active = Boolean(task && taskIsActive(task, snapshot.availability === "ready"));
    function mergeMessages(items: ChatMessage[]) {
        const result = items.map((message) => {
            const pending = pendingReplies.current.get(message.id);
            if (pending && message.status === "streaming")
                return { ...message, content: pending };
            if (message.status !== "streaming")
                pendingReplies.current.delete(message.id);
            return message;
        });
        setSyncPending(pendingReplies.current.size > 0);
        return result;
    }
    async function load() {
        const value = await conversation(id);
        setChat(value.conversation);
        setMessages(mergeMessages(value.messages));
    }
    useEffect(() => {
        let alive = true;
        const refresh = async () => {
            try {
                const value = await conversation(id);
                if (alive) {
                    setChat(value.conversation);
                    if (!busy)
                        setMessages(mergeMessages(value.messages));
                }
            }
            catch (failure) {
                if (alive)
                    setError(failure instanceof Error ? failure.message : "无法读取独立会话");
            }
        };
        void refresh();
        const timer = setInterval(() => void refresh(), 2000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [id, busy]);
    useEffect(() => {
        let alive = true;
        if (snapshot.availability !== "ready" ||
            !task ||
            task.status !== "waiting_approval" ||
            !window.somnusRuntime) {
            setInteractions(undefined);
            return;
        }
        void window.somnusRuntime
            .interactions(taskRoute(task))
            .then((value) => {
            if (alive)
                setInteractions(value);
        })
            .catch(() => {
            if (alive)
                setInteractions(undefined);
        });
        return () => {
            alive = false;
        };
    }, [snapshot.cursor, snapshot.availability, task?.id]);
    async function send() {
        const bridge = window.somnusNativeDshChat;
        if (!canSend ||
            (!text.trim() && !media.images.length && !media.files.length) ||
            !continuation ||
            !bridge ||
            mediaBusy || permissionBusy ||
            preferencesBusy || Boolean(preferencesError) ||
            busy ||
            active ||
            syncPending)
            return;
        const draft = text;
        const resources = media;
        followReplies.current = true;
        setBusy(true);
        setError("");
        setSyncPending(false);
        let turnId: string | undefined, stop: (() => void) | undefined, partial = "";
        try {
            if (resources.images.length) {
                const catalog = await listProviders();
                const selected = catalog.providers.find(item => item.id === (resources.modelId || continuation.providerModelId || catalog.active));
                if (selected?.vision_enabled !== true)
                    throw Error("当前模型未开启图片输入，请选择支持图片的模型。");
            }
            const reserved = await beginExternalTurn(id, {
                content: draft,
                agent_id: continuation.agentId,
                agent_name: "Somnus",
                ...(resources.modelId || continuation.providerModelId ? { provider_model_id: resources.modelId || continuation.providerModelId } : {}),
                attachments: resources.images, file_ids: resources.files.map(file => file.id), skill_ids: resources.skills.map(skill => skill.id), reasoning_effort: resources.effort,
            });
            turnId = reserved.turn_id;
            setMessages((previous) => [
                ...previous,
                reserved.user_message,
                reserved.assistant_message,
            ]);
            setText("");
            setMedia({ ...emptyChildMedia(), modelId: resources.modelId, effort: resources.effort, skills: resources.skills });
            stop = bridge.onUpdate((update) => {
                if (update.conversationId !== id ||
                    (update.turnId && update.turnId !== turnId))
                    return;
                if (update.text) {
                    partial += update.text;
                    setMessages((previous) => previous.map((message) => message.id === turnId
                        ? { ...message, content: partial }
                        : message));
                }
                if (update.acpPermission)
                    setInteractions({ permission: update.acpPermission });
                if (update.dshQuestion)
                    setInteractions({ question: update.dshQuestion });
            });
            subscription.current = stop;
            const result = await bridge.promptConversation({
                conversationId: id,
                turnId,
                agentId: continuation.agentId,
                workspaceId: chat?.workspace_id,
            });
            partial = result.text || partial;
            setSyncPending(result.persistencePending === true);
            if (result.persistencePending)
                pendingReplies.current.set(turnId, partial);
            await finishExternalTurn(id, turnId, {
                content: partial,
                status: result.stopReason === "cancelled" ? "cancelled" : "complete",
                usage: result.usage,
                context: result.contextUsage,
                model: result.modelName || result.modelId || undefined,
            });
            await load();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : "发送失败");
            if (!turnId)
                setText(draft);
            else
                try {
                    await finishExternalTurn(id, turnId, {
                        content: partial,
                        status: "error",
                    });
                }
                catch { }
            try {
                await load();
            }
            catch { }
        }
        finally {
            stop?.();
            if (subscription.current === stop)
                subscription.current = undefined;
            setBusy(false);
            refreshRuntimeTasks();
        }
    }
    const route = task && taskRoute(task), host = window.somnusRuntime;
    return (<section className="child-conversation-pane" aria-label="独立子会话" onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files'))
        event.preventDefault(); }} onDrop={event => { if (!event.dataTransfer.files.length)
        return; event.preventDefault(); mediaInput.current?.addFiles(Array.from(event.dataTransfer.files)); }}>
      <header>
        <div>
          <strong>{chat?.title || "独立会话"}</strong>
          <p>新会话独立授权，不继承父任务的操作许可。</p>
        </div>
        <Button size="small" disabled={!canOpenMain} onClick={onOpenMain}>
          在主聊天打开
        </Button>
      </header>
      {error && <Alert type="error" message={error}/>}
      <div className="child-conversation-messages" ref={messageView} onScroll={(event) => {
            const element = event.currentTarget;
            followReplies.current =
                element.scrollHeight - element.scrollTop - element.clientHeight <
                    64;
        }}>
        <InheritedHistory conversationId={id} available={Boolean(chat?.inherited_history)}/>
      {preferencesError && <Alert type="warning" message={preferencesError} action={<Button size="small" onClick={()=>setPreferenceReload(value=>value+1)}>重新读取已保存选择</Button>}/>}
      {messages.map((message) => (<article key={message.id} data-role={message.role}>
            <small>{message.role === "user" ? "你" : "Somnus"}</small>
            <Markdown text={message.content || "等待回复…"}/>
          </article>))}
      </div>
      {task && (<p role="status">
          {taskLabel(task, snapshot.availability === "ready")}
          {syncPending ? " · 结果待同步" : ""}
        </p>)}
      {interactions?.permission && route && host && (<ActionApproval request={interactions.permission} disabled={!canSend ||
                snapshot.availability !== "ready" ||
                task?.status !== "waiting_approval"} onRespond={async (option) => {
                await host.respondPermission(route, interactions.permission!.requestId, option);
                setInteractions(undefined);
                refreshRuntimeTasks();
            }}/>)}
      {interactions?.question && route && host && canSend && (<AgentQuestions request={interactions.question} onRespond={async (answers) => {
                await host.respondQuestion(route, interactions.question!.requestId, answers);
                setInteractions(undefined);
                refreshRuntimeTasks();
            }}/>)}
      <div className="child-conversation-composer">
        <Input.TextArea aria-label="给独立子会话发消息" onCompositionEnd={() => {
            compositionEnd.current = Date.now() + 10;
        }} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229 ||
                Date.now() < compositionEnd.current ||
                event.getModifierState?.("AltGraph"))
                return;
            const action = composerEnterAction({
                key: event.key,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                sendKey: preferences.sendKey,
            });
            if (action === "send") {
                event.preventDefault();
                if (event.repeat)
                    return;
                void send();
            }
        }} onPaste={event => { const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => Boolean(file)); if (files.length) {
        if (!event.clipboardData.getData('text/plain'))
            event.preventDefault();
        mediaInput.current?.addFiles(files);
    } }} placeholder="在此继续独立会话，可添加附件和 Skill" value={text} onChange={(event) => setText(event.target.value)} autoSize={{ minRows: 2, maxRows: 7 }} disabled={busy || !canSend || !continuation}/>
        <ChildComposerExtras ref={mediaInput} key={id} value={media} onChange={next => void changeMedia(next)} disabled={busy || active || !canSend || mediaBusy || preferencesBusy} onBusy={setMediaBusy}/>
        <small className="child-send-hint">
          {shortcuts.send} 发送 · {shortcuts.newline} 换行
        </small>
        <footer>
          {chat && (<PermissionSwitch conversationId={id} permission={chat.permission_mode} disabled={busy || active || !canSend} onBusyChange={setPermissionBusy} allowFullAccess onChange={(permission) => setChat({ ...chat, permission_mode: permission })}/>)}
          {task?.can_cancel && host && canSend ? (<Button danger onClick={async () => {
                try {
                    await host.cancelTask(taskRoute(task));
                    refreshRuntimeTasks();
                }
                catch (failure) {
                    setError(failure instanceof Error ? failure.message : "无法停止任务");
                }
            }}>
              停止
            </Button>) : null}
          <Button type="primary" aria-label="发送" title={"发送（" + shortcuts.send + "）"} loading={busy} disabled={!canSend ||
            (!text.trim() && !media.images.length && !media.files.length) ||
            busy ||
            permissionBusy ||
            mediaBusy ||
            preferencesBusy || Boolean(preferencesError) ||
            syncPending ||
            active ||
            !continuation ||
            snapshot.availability !== "ready"} onClick={() => void send()}>
            发送
          </Button>
        </footer>
      </div>
      {!continuation && (<p>当前宿主尚未提供此会话的模型路由，请在主聊天选择模型后继续。</p>)}
      {!chat && <Spin size="small"/>}
    </section>);
}
