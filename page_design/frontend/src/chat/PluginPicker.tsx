import { useState } from 'react';
import { Button, Dropdown, Tag } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import { listDefaultPlugins, listInstalledPlugins } from './assistantApi';
import type { InstalledPlugin } from './assistantApi';

export function PluginPicker({ selected, onChange, disabled }: {
  selected: InstalledPlugin[]; onChange: (value: InstalledPlugin[]) => void; disabled: boolean;
}) {
  const [items, setItems] = useState<InstalledPlugin[]>([]);
  const [note, setNote] = useState('尚无已启用的插件');
  async function refresh() {
    setItems([]);
    setNote('正在读取插件…');
    try {
      const [personal, defaults] = await Promise.all([listInstalledPlugins(), listDefaultPlugins().catch(() => ({ plugins: [] }))]);
      const plugins = [...personal, ...defaults.plugins].filter(item => item.enabled);
      setItems(plugins);
      setNote('尚无已启用的插件');
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : '无法读取插件');
    }
  }
  return <Dropdown disabled={disabled} trigger={['click']} onOpenChange={open => { if (open) void refresh(); }} menu={{
    items: [
      { key: 'help', label: '选择后，本次 MCP 仅使用所选插件引用的服务器', disabled: true },
      ...(!items.length ? [{ key: 'empty', label: note, disabled: true }] : items.map(item => ({
        key: item.id, label: item.name, disabled: selected.length >= 3 && !selected.some(plugin => plugin.id === item.id),
      }))),
    ],
    selectedKeys: selected.map(item => item.id), selectable: true, multiple: true,
    onClick: ({ key }) => {
      const item = items.find(plugin => plugin.id === key);
      if (!item) return;
      if (selected.some(plugin => plugin.id === key)) onChange(selected.filter(plugin => plugin.id !== key));
      else if (selected.length < 3) onChange([...selected, item]);
    },
  }}>
    <Button size="small" type="text" icon={<ApiOutlined />} aria-label="为此消息选择插件" title="为此消息选择插件" />
  </Dropdown>;
}

export function PluginChips({ selected, onChange, disabled }: {
  selected: InstalledPlugin[]; onChange: (value: InstalledPlugin[]) => void; disabled: boolean;
}) {
  return selected.length > 0 && <div className="assistant-skill-chips" aria-label="此消息选用的插件">
    {selected.map(item => <Tag key={item.id} closable={!disabled} onClose={event => {
      event.preventDefault();
      onChange(selected.filter(plugin => plugin.id !== item.id));
    }}>插件 · {item.name}</Tag>)}
  </div>;
}
