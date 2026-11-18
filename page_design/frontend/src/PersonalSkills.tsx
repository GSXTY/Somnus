import { useEffect, useRef, useState } from 'react';
import { AppstoreOutlined, LockOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Modal, Spin, Switch, Tag } from 'antd';
import { importSkill, listSkills, removeSkill, setSkillEnabled } from './assistantApi';
import type { Skill } from './assistantApi';
import { ExtensionHeading, ExtensionItem } from './ExtensionSettingsParts';

export type DshSkill = { name: string; source: 'managed' | 'user' | 'agents' };
type SkillEntry = { kind: 'imported'; skill: Skill } | { kind: 'local'; skill: DshSkill };

const localSources = {
  managed: { label: 'Somnus 管理目录', location: 'Somnus 桌面运行时的 Skill 目录' },
  user: { label: 'DSH 用户目录', location: '~/.dsh/skills' },
  agents: { label: '共享 Agent 目录', location: '~/.agents/skills' },
};

function sourceLabel(entry: SkillEntry) {
  if (entry.kind === 'local') return localSources[entry.skill.source].label;
  return entry.skill.builtin ? 'Somnus 内置' : 'Somnus 导入';
}

function entryKey(entry: SkillEntry) {
  return entry.kind === 'imported' ? 'imported:' + entry.skill.id : 'local:' + entry.skill.source + ':' + entry.skill.name;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试';
}

export function PersonalSkills() {
  const [items, setItems] = useState<Skill[]>([]);
  const [localItems, setLocalItems] = useState<DshSkill[]>([]);
  const [loadingImported, setLoadingImported] = useState(true);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importedError, setImportedError] = useState('');
  const [localError, setLocalError] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>();
  const [removal, setRemoval] = useState<Skill>();
  const picker = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const listLocalSkills = window.vvmanAcp?.dshSkills;

  useEffect(() => {
    const controller = new AbortController();
    listSkills(controller.signal).then(result => { if (!controller.signal.aborted) setItems(result); })
      .catch(error => { if (!controller.signal.aborted) setImportedError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingImported(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!listLocalSkills) return;
    let active = true;
    setLocalError(false);
    setLoadingLocal(true);
    listLocalSkills().then(result => { if (active) setLocalItems(result); })
      .catch(() => { if (active) setLocalError(true); })
      .finally(() => { if (active) setLoadingLocal(false); });
    return () => { active = false; };
  }, [listLocalSkills]);

  async function act(action: () => Promise<void>) {
    if (loadingImported || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (error) { setError(errorText(error)); }
    finally { operation.current = false; setBusy(false); }
  }

  function toggle(skill: Skill, enabled: boolean) {
    if (skill.builtin) return;
    void act(async () => {
      const next = await setSkillEnabled(skill.id, enabled);
      setItems(old => old.map(item => item.id === next.id ? next : item));
    });
  }

  const search = query.trim().toLocaleLowerCase();
  const builtinNames = new Set(items.filter(skill => skill.builtin).map(skill => skill.name));
  const discoverableLocalItems = localItems.filter(skill => skill.name !== 'ppt-master' && !builtinNames.has(skill.name));
  const entries: SkillEntry[] = [
    ...items.map(skill => ({ kind: 'imported' as const, skill })),
    ...discoverableLocalItems.map(skill => ({ kind: 'local' as const, skill })),
  ];
  const preview = entries.find(entry => entryKey(entry) === selected);
  const visible = entries.filter(entry => !search || [
    entry.skill.name,
    sourceLabel(entry),
    entry.kind === 'imported' ? entry.skill.description : localSources[entry.skill.source].location,
  ].some(value => value.toLocaleLowerCase().includes(search)));
  const loading = loadingImported || loadingLocal;
  const actionsDisabled = loadingImported || busy;
  const icon = <AppstoreOutlined />;
  const skillSwitch = (skill: Skill) => <Switch size="small" checked={skill.enabled} disabled={actionsDisabled}
    aria-label={skill.name + ' 启用状态'} onChange={enabled => toggle(skill, enabled)} />;

  return <div className="extension-settings personal-skills">
    <input type="file" hidden ref={picker} accept=".md,.zip" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void act(async () => {
        const skill = await importSkill(file);
        setItems(current => [skill, ...current.filter(item => item.id !== skill.id)]);
        setSelected('imported:' + skill.id);
      });
    }} />
    {preview ? <>
      <ExtensionHeading title={preview.skill.name} icon={icon} description={sourceLabel(preview)}
        onBack={() => { setSelected(undefined); setError(''); }} actions={preview.kind === 'local' || preview.skill.builtin
          ? <Tag icon={<LockOutlined />}>{preview.kind === 'local' ? '只读' : '内置'}</Tag>
          : <>{skillSwitch(preview.skill)}<Button size="small" danger disabled={actionsDisabled}
            onClick={() => { setError(''); setRemoval(preview.skill); }}>移除</Button></>} />
      <section className="extension-detail" aria-label="Skill 详情">
        <h3>详情</h3>
        {preview.kind === 'imported' ? <>
          {preview.skill.description && <p>{preview.skill.description}</p>}
          <dl><dt>引用文件</dt><dd>{preview.skill.reference_count} 个</dd>
            {Boolean(preview.skill.ignored_count) && <><dt>跳过的打包项</dt><dd>{preview.skill.ignored_count} 个</dd></>}
          </dl>
          {preview.skill.builtin && <p className="extension-note">由 Somnus 管理。</p>}
        </> : <dl><dt>目录</dt><dd>{localSources[preview.skill.source].location}</dd></dl>}
      </section>
    </> : <>
      <ExtensionHeading title="Skills" description="支持导入 SKILL.md 或 ZIP" actions={<Button type="primary" size="small"
        icon={<PlusOutlined />} disabled={actionsDisabled} onClick={() => picker.current?.click()}>导入 Skill</Button>} />
      <Input className="extension-search" allowClear prefix={<SearchOutlined />} placeholder="搜索技能"
        aria-label="搜索技能" value={query} onChange={event => setQuery(event.target.value)} />
      {importedError && <Alert type="error" showIcon message="无法加载 Somnus Skills" description={importedError} />}
      {localError && <Alert type="error" showIcon message="无法读取 DSH 技能目录" />}
      {loading && <p className="extension-note" role="status"><Spin size="small" /> 正在加载技能…</p>}
      {!visible.length && !loading && (search || (!importedError && !localError)) &&
        <p className="extension-empty">{search ? '没有匹配的技能' : '暂无技能，可导入 SKILL.md 或 ZIP。'}</p>}
      {visible.length > 0 && <section className="extension-section">
        <h3>已安装</h3>
        <ul className="extension-list" aria-label="已安装的技能">
          {visible.map(entry => <ExtensionItem key={entryKey(entry)} title={entry.skill.name} icon={icon}
            description={entry.kind === 'imported' ? entry.skill.description : localSources[entry.skill.source].location}
            status={<Tag>{sourceLabel(entry)}</Tag>} onOpen={() => setSelected(entryKey(entry))}
            actions={entry.kind === 'imported' && !entry.skill.builtin ? skillSwitch(entry.skill) : undefined} />)}
        </ul>
      </section>}
    </>}
    {error && !removal && <Alert type="error" showIcon message={error} />}
    <Modal title="移除 Skill" open={Boolean(removal)} onCancel={() => { if (!busy) { setRemoval(undefined); setError(''); } }}
      okText="移除" cancelText="取消" okButtonProps={{ danger: true }} confirmLoading={busy}
      onOk={() => { if (removal && !removal.builtin) void act(async () => {
        await removeSkill(removal.id);
        setItems(current => current.filter(item => item.id !== removal.id));
        setRemoval(undefined);
        setSelected(undefined);
      }); }}>
      <p>移除「{removal?.name}」后，Agent 将无法再使用此技能。</p>
      {error && <Alert type="error" showIcon message={error} />}
    </Modal>
  </div>;
}
