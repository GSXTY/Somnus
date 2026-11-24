import { SomnusMark } from '../app/SomnusMark';
import { Button, Dropdown } from 'antd';
import { CloseOutlined, RobotOutlined, TeamOutlined } from '@ant-design/icons';
import type { ExternalAgent } from './assistantAcp';
import codexIcon from '../agent-icons/codex-acp.svg';
import dshIcon from '../agent-icons/deepseek.svg';
import './conversation-agents.css';

export function AgentAvatar({ name }: { name: string }) {
  const icon = /codex/i.test(name) ? codexIcon : /deepseek|dsh/i.test(name) ? dshIcon : undefined;
  return <span className="group-agent-avatar" aria-hidden="true">{name === 'Somnus' ? <SomnusMark /> : icon ? <img src={icon} alt="" /> : <RobotOutlined />}</span>;
}

type Props = {
  members: string[];
  available: ExternalAgent[];
  active: ReadonlyMap<string, string>;
  queued: ReadonlySet<string>;
  parallelCount: number;
  locked: boolean;
  saving: boolean;
  onMembership: (id: string, added: boolean) => void;
};
export function ConversationAgents({ members, available, active, queued, parallelCount, locked, saving, onMembership }: Props) {
  const availableById = new Map(available.map(agent => [agent.id, agent]));
  return <section className="group-agent-bar" aria-label="会话 Agent 成员">
    {members.length > 0 && <span className="group-agent-title"><TeamOutlined aria-hidden="true" /> 群聊成员</span>}
    <div className="group-agent-roster">
      {members.map(id => {
        const name = availableById.get(id)?.name || 'Agent 不可用';
        const status = active.get(id);
        return <Dropdown key={id} trigger={['click']} menu={{
          items: [{ key: 'remove', icon: <CloseOutlined />, label: '移除成员', disabled: locked || saving || Boolean(status) || queued.has(id) }],
          onClick: ({ key }) => { if (key === 'remove') onMembership(id, false); },
        }}>
          <button type="button" className="group-agent-profile" aria-label={name + ' 成员操作'} aria-haspopup="menu">
            <AgentAvatar name={name} />
            <span className="group-agent-name">{name}</span>
            {status && <span className="group-agent-status" data-waiting={status !== '处理中'}>{status}</span>}
          </button>
        </Dropdown>;
      })}
    </div>
    {parallelCount > 0 && <small className="group-active-count" role="status">{parallelCount} 个任务进行中</small>}
  </section>;
}

export function ConversationRecipient({ members, available, targetId, locked, onTarget }: {
  members: string[]; available: ExternalAgent[]; targetId?: string; locked: boolean;
  onTarget: (agent?: ExternalAgent) => void;
}) {
  const availableById = new Map(available.map(agent => [agent.id, agent]));
  const target = targetId ? availableById.get(targetId) : undefined;
  return <Dropdown trigger={['click']} placement="topLeft" disabled={locked}
    menu={{
      selectable: true, selectedKeys: [targetId || 'default'],
      items: [{ key: 'default', label: 'Somnus' }, { type: 'divider' }, ...members.map(id => {
        const agent = availableById.get(id);
        return { key: id, icon: <AgentAvatar name={agent?.name || ''} />, label: agent?.name || 'Agent 不可用', disabled: !agent };
      })],
      onClick: ({ key }) => onTarget(availableById.get(key)),
    }}>
    <Button type="text" size="small" className="group-recipient-button" aria-label="选择任务接收者" aria-haspopup="menu">
      {target && <AgentAvatar name={target.name} />}<span>发送给 {target?.name || (targetId ? '不可用' : 'Somnus')}</span>
    </Button>
  </Dropdown>;
}

