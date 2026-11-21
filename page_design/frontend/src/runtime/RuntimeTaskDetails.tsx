import { useEffect, useState } from "react";
import { Alert, Button, Modal, Spin } from "antd";
import { ActionApproval, AgentQuestions } from "../chat/ExecutionDetails";
import { taskRoute } from "./runtimeBridge";
import type {
  RuntimeCapabilityDescriptor,
  RuntimeInteractions,
} from "./runtimeBridge";
import type { RuntimeTask } from "./runtimeTasks";
import { refreshRuntimeTasks } from "./runtimeTasks";
import { taskIsActive, taskLabel } from "./runtimeTaskModel.mjs";
const names: Record<string, string> = {
  outboxPersist: "离线结果保存",
  cancel: "停止任务",
  approval: "操作审批",
  agentModes: "工作模式",
  subagents: "子任务",
  images: "图片",
  reasoning: "推理强度",
  resume: "应用重启后续执行",
  persistentConnection: "持续连接",
  tools: "工具",
};
const values: Record<string, string> = {
  unavailable: "当前不可用",
  encrypted: "本机加密保存",
  "memory-only": "仅当前进程",
  supported: "支持",
  unsupported: "不支持",
  unknown: "未确认",
  negotiated: "由 Agent 协商提供",
  "provider-dependent": "由模型配置决定",
  "permission-scoped": "按当前权限提供",
};
export function RuntimeTaskDetails({
  task,
  available,
  onClose,
  onJump,
}: {
  task: RuntimeTask;
  available: boolean;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  const [interactions, setInteractions] = useState<RuntimeInteractions>();
  const [capabilities, setCapabilities] =
    useState<RuntimeCapabilityDescriptor>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const bridge = window.somnusRuntime;
    if (!bridge) return;
    let alive = true;
    void bridge
      .capabilities({
        runtime: task.runtime === "dsh-subagent" ? "dsh-native" : task.runtime,
        agentId: task.agent_id,
      })
      .then((result) => {
        if (alive) setCapabilities(result);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [task.id]);
  useEffect(() => {
    const bridge = window.somnusRuntime;
    if (
      !bridge ||
      !available ||
      task.status !== "waiting_approval" ||
      task.parent_task_id
    ) {
      setInteractions(undefined);
      return;
    }
    let alive = true;
    let timer: number | undefined;
    async function read() {
      setLoading(true);
      try {
        const value = await bridge!.interactions(taskRoute(task));
        if (alive) {
          setInteractions(value);
          setError("");
        }
      } catch (failure) {
        if (alive) {
          setInteractions(undefined);
          setError(
            failure instanceof Error
              ? failure.message
              : "当前操作已无法恢复，请查看任务记录。",
          );
        }
      } finally {
        if (alive) {
          setLoading(false);
          timer = window.setTimeout(() => void read(), 2000);
        }
      }
    }
    void read();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [task.id, task.status, available]);
  async function cancel() {
    if (!window.somnusRuntime || busy) return;
    setBusy(true);
    setError("");
    try {
      await window.somnusRuntime.cancelTask(taskRoute(task));
      refreshRuntimeTasks();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "当前任务已无法停止。",
      );
      refreshRuntimeTasks();
    } finally {
      setBusy(false);
    }
  }
  const live = taskIsActive(task, available);
  const canCancel =
    available &&
    task.can_cancel &&
    Boolean(window.somnusRuntime) &&
    capabilities?.capabilities.cancel === "supported";
  const interrupted = task.status === "interrupted";
  return (
    <Modal
      open
      width={680}
      title={task.title || task.agent_name + " 的任务"}
      onCancel={onClose}
      footer={
        <>
          <Button
            onClick={() => {
              onJump(task.message_id);
              onClose();
            }}
          >
            查看原回复
          </Button>
          {canCancel && (
            <Button danger loading={busy} onClick={() => void cancel()}>
              停止任务
            </Button>
          )}
          {available && ["interrupted", "failed"].includes(task.status) && (
            <Button
              onClick={() => {
                onJump(task.message_id);
                window.dispatchEvent(
                  new CustomEvent("somnus:insert-draft", {
                    detail: {
                      text:
                        (task.runtime === "dsh-native"
                          ? "Somnus"
                          : task.agent_name) +
                        "，请先检查已有回复、已保存结果与文件，继续未完成的部分；不要重复执行已完成的操作。",
                    },
                  }),
                );
                onClose();
              }}
            >
              填写继续草稿
            </Button>
          )}
          <Button onClick={onClose}>关闭</Button>
        </>
      }
    >
      <p role="status">
        <strong>{task.agent_name}</strong> · {taskLabel(task, available)}
      </p>
      {task.received_late && (
        <p>结果延迟同步：执行结果现已保存，未重新运行任务。</p>
      )}
      {task.progress?.title && <p>{task.progress.title}</p>}
      {task.error?.message && (
        <Alert
          showIcon
          type={interrupted ? "warning" : "error"}
          message={task.error.message}
        />
      )}
      {interrupted && (
        <p>
          请先检查已有回复和文件结果，再决定是否重新发起任务。不会自动重发。
        </p>
      )}
      {available && ["interrupted", "failed"].includes(task.status) && (
        <p>
          「填写继续草稿」只填入提示，仍需你检查并发送新消息；旧任务不会恢复执行。若结果仍待同步，请先等待保存确认。
        </p>
      )}
      {(!available || task.status === "disconnected") && (
        <p>
          当前无法确认执行进程是否仍在线；这里只展示最后记录，不会自动重复执行。
        </p>
      )}
      {error && <Alert showIcon type="warning" message={error} />}
      {loading && !interactions && <Spin size="small" />}
      {interactions?.permission && (
        <ActionApproval
          key={interactions.permission.requestId}
          request={interactions.permission}
          onRespond={async (optionId) => {
            await window.somnusRuntime!.respondPermission(
              taskRoute(task),
              interactions.permission!.requestId,
              optionId,
            );
            setInteractions(undefined);
            refreshRuntimeTasks();
          }}
        />
      )}
      {interactions?.question && (
        <AgentQuestions
          key={interactions.question.requestId}
          request={interactions.question}
          onRespond={async (answers) => {
            await window.somnusRuntime!.respondQuestion(
              taskRoute(task),
              interactions.question!.requestId,
              answers,
            );
            setInteractions(undefined);
            refreshRuntimeTasks();
          }}
        />
      )}
      {live &&
        task.status === "waiting_approval" &&
        !loading &&
        !interactions?.permission &&
        !interactions?.question && (
          <p>正在等待操作；当前宿主尚未提供可恢复的审批卡片，请查看原回复。</p>
        )}
      {capabilities && (
        <details className="runtime-task-capabilities">
          <summary>运行时能力</summary>
          <dl>
            {Object.entries(capabilities.capabilities).map(([key, value]) => (
              <div key={key}>
                <dt>{names[key] || key}</dt>
                <dd>{values[value] || value}</dd>
              </div>
            ))}
          </dl>
          <p>能力声明与模型额度、会话权限和具体工具配置分别生效。</p>
        </details>
      )}
    </Modal>
  );
}
