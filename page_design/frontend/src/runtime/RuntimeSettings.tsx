import { useEffect, useState } from "react";
import { Alert, Button, InputNumber, Select, Spin } from "antd";
import "./runtimeBridge";
export type RuntimeSettingsValue = {
  tasks: {
    maxDurationMinutes: number;
    idleWarningSeconds: number;
    disconnectTimeoutSeconds: number;
  };
  diagnostics: { level: "off" | "error" | "info" };
};
export function RuntimeSettings() {
  const bridge = window.somnusRuntime,
    [value, setValue] = useState<RuntimeSettingsValue>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void bridge
      ?.settings?.()
      .then((result) => {
        if (active) setValue(result);
      })
      .catch(() => {
        if (active) setError("无法读取任务设置。");
      });
    return () => {
      active = false;
    };
  }, [bridge]);
  if (!bridge?.settings || !bridge.setSettings)
    return <p>任务与诊断设置需要支持此功能的 Somnus 桌面宿主。</p>;
  const task = (
    key: keyof RuntimeSettingsValue["tasks"],
    next: number | null,
  ) => {
    if (value) {
      setValue({ ...value, tasks: { ...value.tasks, [key]: next ?? 0 } });
      setSaved(false);
    }
  };
  return (
    <div className="settings-card runtime-settings">
      {error && <Alert type="error" message={error} />}
      {!value ? (
        <Spin />
      ) : (
        <>
          <label>
            任务最长运行时间（分钟，0 表示不设总时限）
            <InputNumber
              aria-label="任务最长运行时间"
              min={0}
              max={1440}
              value={value.tasks.maxDurationMinutes}
              onChange={(next) => task("maxDurationMinutes", next)}
            />
          </label>
          <label>
            无新事件多久提示（秒，不会停止任务）
            <InputNumber
              aria-label="空闲提示时间"
              min={30}
              max={3600}
              value={value.tasks.idleWarningSeconds}
              onChange={(next) => task("idleWarningSeconds", next)}
            />
          </label>
          <label>
            失联确认时间（秒）
            <InputNumber
              aria-label="失联确认时间"
              min={15}
              max={300}
              value={value.tasks.disconnectTimeoutSeconds}
              onChange={(next) => task("disconnectTimeoutSeconds", next)}
            />
          </label>
          <label>
            诊断记录
            <Select
              aria-label="诊断记录"
              value={value.diagnostics.level}
              onChange={(level) => {
                setValue({ ...value, diagnostics: { level } });
                setSaved(false);
              }}
              options={[
                { value: "off", label: "关闭" },
                { value: "error", label: "仅错误" },
                { value: "info", label: "基础运行信息" },
              ]}
            />
          </label>
          <p className="small-note">
            适用于聊天任务；自动委派和工具本身仍有独立预算。保存后由桌面宿主执行。连接中断不会自动重发模型或工具请求；已有结果会单独补交保存。
          </p>
          <Button
            type="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setSaved(false);
              try {
                setValue(await bridge.setSettings!(value));
                setSaved(true);
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : "保存失败",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            保存任务设置
          </Button>
          {saved && <span role="status">已保存</span>}
          {bridge.diagnostics && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const data = await bridge.diagnostics!();
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "somnus-runtime-diagnostics.json";
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : "导出失败",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              导出运行诊断
            </Button>
          )}
        </>
      )}
    </div>
  );
}
