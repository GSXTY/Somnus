import { useState } from 'react';
import { Button, Dropdown, Tag } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import { listSkills } from './assistantApi';
import type { Skill } from './assistantApi';

export function SkillPicker({ selected, onChange, disabled }: {
  selected: Skill[]; onChange: (skills: Skill[]) => void; disabled: boolean;
}) {
  const [items, setItems] = useState<Skill[]>([]);
  const [note, setNote] = useState('尚无已启用的 Skill');

  async function refresh() {
    setNote('正在读取 Skills…');
    setItems([]);
    try {
      setItems((await listSkills()).filter(skill => skill.enabled));
      setNote('尚无已启用的 Skill');
    } catch (error) {
      setNote(error instanceof Error ? error.message : '无法读取 Skills');
    }
  }

  return <Dropdown trigger={['click']} disabled={disabled} onOpenChange={open => { if (open) void refresh(); }} menu={{
    items: items.length ? items.map(skill => ({
      key: skill.id, label: skill.name,
      disabled: selected.length >= 3 && !selected.some(item => item.id === skill.id),
    })) : [{ key: 'empty', label: note, disabled: true }],
    selectable: true, multiple: true, selectedKeys: selected.map(item => item.id),
    onClick: ({ key }) => {
      const item = items.find(skill => skill.id === key);
      if (!item) return;
      if (selected.some(skill => skill.id === key)) onChange(selected.filter(skill => skill.id !== key));
      else if (selected.length < 3) onChange([...selected, item]);
    },
  }}>
    <Button size="small" type="text" icon={<AppstoreOutlined />} aria-label="为此消息选择 Skills" title="为此消息选择 Skills" />
  </Dropdown>;
}

export function SkillChips({ selected, onChange, disabled }: {
  selected: Skill[]; onChange: (skills: Skill[]) => void; disabled: boolean;
}) {
  if (!selected.length) return null;
  return <div className="assistant-skill-chips" aria-label="此消息选用的 Skills">
    {selected.map(skill => <Tag key={skill.id} closable={!disabled} onClose={event => {
      event.preventDefault();
      onChange(selected.filter(item => item.id !== skill.id));
    }}>{skill.name}</Tag>)}
  </div>;
}
