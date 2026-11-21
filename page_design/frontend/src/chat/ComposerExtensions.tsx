import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Input, Modal, Spin } from 'antd';
import { listDefaultPlugins, listInstalledPlugins, listSkills } from './assistantApi';
import type { InstalledPlugin, Skill } from './assistantApi';

type Extension = { id: string; name: string; description: string };

function ExtensionGroup<T extends Extension>({ label, items, selected, onChange }: {
  label: string; items: T[]; selected: T[]; onChange: (items: T[]) => void;
}) {
  return <section className="composer-extension-group" aria-label={label}>
    <h3>{label}</h3>
    {items.length ? items.map(item => {
      const checked = selected.some(choice => choice.id === item.id);
      return <button type="button" key={item.id} aria-pressed={checked} disabled={selected.length >= 3 && !checked}
        onClick={() => onChange(checked ? selected.filter(choice => choice.id !== item.id) : [...selected, item])}>
        <span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span>
        {checked && <CheckOutlined aria-hidden="true" />}
      </button>;
    }) : <small className="composer-extension-empty">没有可选项</small>}
  </section>;
}

export function ComposerExtensions({ skills, plugins, open, onOpenChange, onSkills, onPlugins, onConfigure, showCatalog, children }: {
  skills: Skill[]; plugins: InstalledPlugin[]; onSkills: (value: Skill[]) => void; onPlugins: (value: InstalledPlugin[]) => void;
  open: boolean; onOpenChange: (open: boolean) => void;
  onConfigure?: (view: 'skills' | 'plugin-config') => void; showCatalog: boolean; children?: ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [availablePlugins, setAvailablePlugins] = useState<InstalledPlugin[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !showCatalog) return;
    let active = true;
    setQuery('');
    setError('');
    setLoading(true);
    void Promise.allSettled([listSkills(), listInstalledPlugins(), listDefaultPlugins()]).then(
      ([skillResult, pluginResult, defaultResult]) => {
        if (!active) return;
        setAvailableSkills(skillResult.status === 'fulfilled' ? skillResult.value.filter(item => item.enabled) : []);
        setAvailablePlugins([
          ...(pluginResult.status === 'fulfilled' ? pluginResult.value : []),
          ...(defaultResult.status === 'fulfilled' ? defaultResult.value.plugins : []),
        ].filter(item => item.enabled));
        if (skillResult.status === 'rejected' || pluginResult.status === 'rejected') setError('部分扩展无法读取');
        setLoading(false);
      },
    );
    return () => { active = false; };
  }, [open, showCatalog]);
  const search = query.trim().toLocaleLowerCase();
  const matches = (entry: Extension) => (entry.name + ' ' + entry.description).toLocaleLowerCase().includes(search);
  return <Modal width={480} title={showCatalog ? '扩展与协作' : '会话协作'} open={open} footer={null}
    onCancel={() => onOpenChange(false)}>
    {children && <div className="composer-extension-collaboration">{children}</div>}
    {showCatalog && <section className="model-picker-popover composer-extension-popover" aria-label="选择本次使用的扩展">
      <div className="model-picker-search"><Input allowClear prefix={<SearchOutlined />} value={query}
        placeholder="搜索 Skill 和插件" aria-label="搜索 Skill 和插件" onChange={event => setQuery(event.target.value)} /></div>
      <div className="model-picker-list">
        {loading ? <Spin size="small" /> : <>
          {error && <p role="alert">{error}</p>}
          <ExtensionGroup label="Skills" items={availableSkills.filter(matches)} selected={skills} onChange={onSkills} />
          <ExtensionGroup label="Somnus 插件" items={availablePlugins.filter(matches)} selected={plugins} onChange={onPlugins} />
        </>}
      </div>
      {onConfigure && <footer className="model-picker-footer">
        <Button type="text" icon={<SettingOutlined />} onClick={() => { onOpenChange(false); onConfigure('skills'); }}>管理 Skills</Button>
        <Button type="text" onClick={() => { onOpenChange(false); onConfigure('plugin-config'); }}>管理插件</Button>
      </footer>}
    </section>}
  </Modal>;
}
