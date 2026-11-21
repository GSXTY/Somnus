import { useEffect, useState } from "react";
import "./runtimeBridge";
export type Appearance = {
  theme: "light" | "dark" | "system";
  effectiveTheme: "light" | "dark";
};
function valid(value: unknown): value is Appearance {
  return Boolean(
    value &&
      typeof value === "object" &&
      "theme" in value &&
      ["light", "dark", "system"].includes(String(value.theme)) &&
      "effectiveTheme" in value &&
      ["light", "dark"].includes(String(value.effectiveTheme)),
  );
}
export function useAppearance(mode: Appearance["theme"], ready: boolean) {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches || false,
  );
  const [native, setNative] = useState<Appearance>(),
    [error, setError] = useState("");
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(Boolean(media?.matches));
    media?.addEventListener("change", sync);
    return () => media?.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const bridge = window.somnusRuntime;
    const receive = (value: unknown) => {
      if (active && valid(value) && value.theme === mode) {
        setNative(value);
        setError("");
      }
    };
    const off = bridge?.onAppearance?.(receive);
    if (bridge && !bridge.setAppearance)
      setError("当前宿主尚未提供标题栏主题同步，页面外观仍已切换。");
    if (bridge?.setAppearance) {
      setError("");
      void bridge
        .setAppearance({ theme: mode })
        .then((value) => {
          if (!active) return;
          if (!valid(value) || value.theme !== mode)
            throw Error("标题栏主题同步未得到确认。");
          receive(value);
        })
        .catch((failure) => {
          if (active)
            setError(
              failure instanceof Error
                ? failure.message
                : "标题栏外观未能同步，请重试。",
            );
        });
    }
    return () => {
      active = false;
      off?.();
    };
  }, [mode, systemDark, ready]);
  const dark =
    native?.theme === mode
      ? native.effectiveTheme === "dark"
      : mode === "dark" || (mode === "system" && systemDark);
  return { dark, error };
}
