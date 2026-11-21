import { confirmedNativeFork } from "./nativeFork";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChildConversationAssociation } from "../chat/assistantAcp";
import { validChildAssociation } from "./childAssociationModel.mjs";
type Scope = { conversationId: string; turnId: string };
type State = {
  key: string;
  phase: "loading" | "ready" | "error";
  link?: ChildConversationAssociation;
  error: string;
};
export function useChildAssociation(scope: Scope, subagentId: string) {
  const key = JSON.stringify([scope.conversationId, scope.turnId, subagentId]),
    revision = useRef(0),
    creating = useRef(false);
  const activeKey = useRef(key);
  activeKey.current = key;
  const [state, setState] = useState<State>({
      key,
      phase: "loading",
      error: "",
    }),
    [forking, setForking] = useState(false);
  const read = useCallback(
    async (expectedCid?: string) => {
      if (activeKey.current !== key || (creating.current && !expectedCid))
        return;
      const version = ++revision.current;
      setState((previous) =>
        previous.key === key
          ? {
              ...previous,
              phase: previous.link ? previous.phase : "loading",
              error: previous.link ? previous.error : "",
            }
          : { key, phase: "loading", error: "" },
      );
      try {
        const bridge = window.somnusNativeDshChat;
        if (!bridge?.childConversation)
          throw Error("当前宿主无法验证子会话关联，请更新探索版。");
        const link = await bridge.childConversation({ ...scope, subagentId });
        if (activeKey.current !== key) return;
        if (!validChildAssociation(link))
          throw Error("子会话关联响应无效，未绑定任何会话。");
        if (
          expectedCid &&
          (link.status !== "linked" || link.conversation_id !== expectedCid)
        )
          throw Error(
            "分支创建已返回，但关联尚未确认；请刷新状态，不要重复创建。",
          );
        if (version === revision.current)
          setState({ key, phase: "ready", link, error: "" });
      } catch (failure) {
        if (activeKey.current === key && version === revision.current)
          setState((previous) => ({
            key,
            phase: "error",
            link: previous.key === key ? previous.link : undefined,
            error:
              failure instanceof Error
                ? failure.message
                : "无法确认子会话关联，请检查连接后重试。",
          }));
      }
    },
    [key],
  );
  useEffect(() => {
    creating.current = false;
    setForking(false);
    void read();
    const focus = () => void read();
    window.addEventListener("focus", focus);
    const timer = setInterval(() => void read(), 5000);
    return () => {
      revision.current++;
      window.removeEventListener("focus", focus);
      clearInterval(timer);
    };
  }, [read]);
  const current =
    state.key === key
      ? state
      : { key, phase: "loading" as const, error: "", link: undefined };
  const canCreate =
    current.phase === "ready" &&
    current.link?.status === "none" &&
    Boolean(window.somnusNativeDshChat?.fork) &&
    !forking;
  async function create() {
    if (!canCreate || creating.current) return;
    creating.current = true;
    setForking(true);
    setState((previous) => ({ ...previous, error: "" }));
    try {
      const result = await confirmedNativeFork({
        ...scope,
        subagentId,
      });
      if (activeKey.current !== key) return;
      if (!result.conversationId) throw Error("分支返回无效，请刷新状态确认。");
      await read(result.conversationId);
    } catch (failure) {
      if (activeKey.current !== key) return;
      setState((previous) => ({
        ...previous,
        phase: "error",
        error:
          failure instanceof Error ? failure.message : "无法创建独立会话。",
      }));
    } finally {
      if (activeKey.current === key) {
        creating.current = false;
        setForking(false);
      }
    }
  }
  return { ...current, canCreate, forking, refresh: read, create };
}
