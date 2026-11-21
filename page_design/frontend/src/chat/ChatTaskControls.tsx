import { useEffect, useRef, useState } from 'react';
import { BulbOutlined } from '@ant-design/icons';
import { Button, Input, Modal, Popconfirm, Tag } from 'antd';
import type { DshTaskState } from './assistantAcp';

const goalStates = { active: '进行中', paused: '已暂停', blocked: '需要处理', complete: '已完成' };

export function ChatTaskControls({ state, disabled, onCommand, onPauseActive, goalRequest }: {
  state?: DshTaskState; disabled: boolean; onCommand: (line: string) => void; onPauseActive?: () => void;
  goalRequest: number;
}) {
  const [goalDraft, setGoalDraft] = useState<{ value: string; editing: boolean }>();
  const goal = state?.goal;
  const plan = state?.plan;
  const handledGoalRequest = useRef(goalRequest);
  useEffect(() => {
    if (handledGoalRequest.current === goalRequest || disabled) return;
    handledGoalRequest.current = goalRequest;
    setGoalDraft({ value: goal?.objective || '', editing: Boolean(goal) });
  }, [goalRequest, disabled, goal?.objective]);
  if (!goal && !goalDraft && !plan?.active && !plan?.pending) return null;
  const canResume = goal?.phase === 'paused' || goal?.phase === 'blocked';
  return <section className="assistant-task-controls" aria-label="会话计划和目标">
    {(plan?.active || plan?.pending) && <Tag icon={<BulbOutlined />} color={plan?.pending ? 'gold' : 'blue'}>
      {plan.pending ? '计划待审阅' : '已开启计划模式'}
    </Tag>}
    {goal && <div className="assistant-goal-card">
      <div><strong>{goal.objective}</strong> <Tag>{goalStates[goal.phase]}</Tag></div>
      <small>已开始 {goal.roundsStarted} / {goal.maxGoalRounds} 轮</small>
      {goal.blockedReason && <p>{goal.blockedReason}</p>}
      <div className="assistant-goal-actions">
        {goal.phase === 'active' && <Button size="small" disabled={disabled && !onPauseActive}
          onClick={() => onPauseActive ? onPauseActive() : onCommand('/goal pause')}>暂停</Button>}
        {canResume && <Button size="small" disabled={disabled} onClick={() => onCommand('/goal resume')}>继续</Button>}
        <Button size="small" type="text" disabled={disabled} onClick={() => setGoalDraft({ value: goal.objective, editing: true })}>编辑目标</Button>
        <Popconfirm title="清除当前目标？" okText="清除" cancelText="取消" onConfirm={() => onCommand('/goal clear')}>
          <Button size="small" type="text" disabled={disabled}>清除</Button></Popconfirm>
      </div>
    </div>}
    {goalDraft && <Modal open title={goalDraft.editing ? '编辑目标' : '设定目标'} onCancel={() => setGoalDraft(undefined)}
      okText={goalDraft.editing ? '更新目标' : '开始目标任务'} cancelText="取消"
      okButtonProps={{ disabled: disabled || !goalDraft.value.trim() }}
      onOk={() => {
        const objective = goalDraft.value.trim().replace(/\s+/g, ' ');
        if (!objective || disabled) return;
        setGoalDraft(undefined);
        onCommand((goalDraft.editing ? '/goal edit ' : '/goal ') + objective);
      }}>
      <Input.TextArea aria-label="目标内容" value={goalDraft.value} maxLength={4000} rows={4}
        onChange={event => setGoalDraft({ ...goalDraft, value: event.target.value })} />
    </Modal>}
  </section>;
}
