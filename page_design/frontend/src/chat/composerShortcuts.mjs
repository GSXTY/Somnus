export function isMacPlatform() {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "")
  );
}
export function composerShortcutLabels(sendKey, mac = isMacPlatform()) {
  const modifier = mac ? "⌘" : "Ctrl";
  return {
    send: sendKey === "mod-enter" ? modifier + "+Enter" : "Enter",
    newline: sendKey === "mod-enter" ? "Enter 或 Shift+Enter" : "Shift+Enter",
    alternate: modifier + (sendKey === "mod-enter" ? "+Shift+Enter" : "+Enter"),
    steerQueue: modifier + "+Enter",
  };
}
export function composerEnterAction({
  key,
  shiftKey = false,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  sendKey = "enter",
  busy = false,
  steerAvailable = false,
  canSteerQueue = false,
}) {
  if (key !== "Enter" || altKey || (ctrlKey && metaKey)) return "none";
  const modifier = ctrlKey || metaKey;
  if (shiftKey)
    return sendKey === "mod-enter" && modifier && busy && steerAvailable
      ? "alternate"
      : "newline";
  if (sendKey === "mod-enter" && !modifier) return "newline";
  if (modifier && canSteerQueue) return "steer-queue";
  if (busy && modifier && sendKey === "enter" && steerAvailable)
    return "alternate";
  return "send";
}
