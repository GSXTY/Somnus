import { useEffect, useState } from "react";
import type { ConversationPermission } from "../chat/assistantApi";
export type UiPreferences = {
  theme: "light" | "dark" | "system";
  chatFontSize: number;
  defaultPermission: ConversationPermission;
  sendKey: "enter" | "mod-enter";
  detail: "compact" | "full";
  collapse: "never" | "finished";
  collapsedReply: "full" | "preview";
};
export const defaultUiPreferences: UiPreferences = {
  theme: "light",
  chatFontSize: 15,
  defaultPermission: "read_only",
  sendKey: "enter",
  detail: "full",
  collapse: "never",
  collapsedReply: "full",
};
const key = "somnus.ui-preferences.v1";
export function readUiPreferences(): UiPreferences {
  let value: Partial<UiPreferences> = {};
  try {
    value = JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch {}
  return {
    theme: ["light", "dark", "system"].includes(value.theme || "")
      ? value.theme!
      : "light",
    chatFontSize: [13, 14, 15, 16, 18].includes(value.chatFontSize!)
      ? value.chatFontSize!
      : 15,
    defaultPermission: [
      "read_only",
      "workspace_write",
      "workspace_direct",
      "full",
    ].includes(value.defaultPermission || "")
      ? value.defaultPermission!
      : "read_only",
    sendKey: value.sendKey === "mod-enter" ? "mod-enter" : "enter",
    detail: value.detail === "compact" ? "compact" : "full",
    collapse: value.collapse === "finished" ? "finished" : "never",
    collapsedReply: value.collapsedReply === "preview" ? "preview" : "full",
  };
}
type PreferenceState = {
  value: UiPreferences;
  ready: boolean;
  saving: boolean;
  error: string;
};
let current: PreferenceState | undefined,
  hydration: Promise<void> | undefined,
  writes = Promise.resolve();
const listeners = new Set<(value: PreferenceState) => void>();
function emit(next: PreferenceState) {
  current = next;
  listeners.forEach((listener) => listener(next));
}
function hydrate() {
  current ??= {
    value: readUiPreferences(),
    ready: false,
    saving: false,
    error: "",
  };
  if (!hydration)
    hydration = (async () => {
      try {
        const bridge = window.somnusRuntime;
        if (bridge?.uiPreferences) {
          const saved = await bridge.uiPreferences();
          const value = saved || current!.value;
          if (!saved && bridge.saveUiPreferences)
            await bridge.saveUiPreferences(value);
          try {
            localStorage.setItem(key, JSON.stringify(value));
          } catch {}
          emit({ value, ready: true, saving: false, error: "" });
        } else emit({ ...current!, ready: true });
      } catch (failure) {
        emit({
          ...current!,
          ready: true,
          error:
            failure instanceof Error
              ? failure.message
              : "无法读取桌面偏好，暂用本机页面设置。",
        });
      }
    })();
  return hydration;
}
export function useUiPreferences() {
  const [state, setState] = useState<PreferenceState>(
    () =>
      current ?? {
        value: readUiPreferences(),
        ready: false,
        saving: false,
        error: "",
      },
  );
  useEffect(() => {
    listeners.add(setState);
    void hydrate().then(() => setState(current!));
    return () => {
      listeners.delete(setState);
    };
  }, []);
  const update = (patch: Partial<UiPreferences>) => {
    writes = writes.then(async () => {
      await hydrate();
      const next = { ...current!.value, ...patch };
      emit({ ...current!, saving: true, error: "" });
      try {
        const value = window.somnusRuntime?.saveUiPreferences
          ? await window.somnusRuntime.saveUiPreferences(next)
          : next;
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {}
        emit({ value, ready: true, saving: false, error: "" });
      } catch (failure) {
        emit({
          ...current!,
          saving: false,
          error:
            failure instanceof Error
              ? failure.message
              : "偏好保存失败，请重试。",
        });
      }
    });
    return writes;
  };
  return [
    state.value,
    update,
    { ready: state.ready, saving: state.saving, error: state.error },
  ] as const;
}
