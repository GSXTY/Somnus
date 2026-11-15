import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Modal, Space, Tag } from 'antd';
import { importSkill, listSkills, removeSkill, setSkillEnabled } from './assistantApi';
import type { Skill } from './assistantApi';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试';
}

export function PersonalSkills() {
  const [items, setItems] = useState<Skill[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Skill>();
  const [removal, setRemoval] = useState<Skill>();
  const picker = useRef<HTMLInputElement>(null);
  const operation = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    listSkills(controller.signal).then(items => { if (!controller.signal.aborted) setItems(items); })
      .catch(error => { if (!controller.signal.aborted) setError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  async function act(action: () => Promise<void>) {
    if (busy || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (error) { setError(errorText(error)); }
    finally { operation.current = false; setBusy(false); }
  }

  return <Card className="panel-card" title="我的 Skills" extra={<Button type="primary" disabled={busy}
    onClick={() => picker.current?.click()}>导入 Skill</Button>}>
    <input type="file" hidden ref={picker} accept=".md,.zip" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void act(async () => {
        const skill = await importSkill(file);
        setItems(current => [skill, ...current.filter(item => item.id !== skill.id)]);
        setPreview(skill);
      });
    }} />
    <p>可导入 SKILL.md 或 ZIP 中的文字指令和参考文件。启用后，可在会话中为单条消息选用 Skill。附带脚本不会运行。</p>
    {error && <Alert type="error" showIcon message={error} />}
    {!items.length && !busy && !error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未导入 Skill" />}
    {items.map(skill => <div className="plugins-route" key={skill.id}>
      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <strong>{skill.name}</strong><small>{skill.description}</small>
      </div>
      <Space wrap size={4}>
        <Tag>{skill.enabled ? '已启用' : '已停用'}</Tag>
        <Button size="small" onClick={() => setPreview(skill)}>详情</Button>
        <Button size="small" disabled={busy} onClick={() => void act(async () => {
          const next = await setSkillEnabled(skill.id, !skill.enabled);
          setItems(old => old.map(item => item.id === next.id ? next : item));
        })}>{skill.enabled ? '停用' : '启用'}</Button>
        <Button size="small" danger disabled={busy} onClick={() => { setError(''); setRemoval(skill); }}>移除</Button>
      </Space>
    </div>)}
    <Modal title="Skill 详情" open={Boolean(preview)} onCancel={() => setPreview(undefined)}
      footer={<Button onClick={() => setPreview(undefined)}>关闭</Button>}>
      <h3>{preview?.name}</h3><p style={{ overflowWrap: 'anywhere' }}>{preview?.description}</p>
      <p>参考文件 {preview?.reference_count ?? 0} 个{Boolean(preview?.ignored_count) && ` · 跳过 ${preview?.ignored_count} 个不支持的文件`}</p>
    </Modal>
    <Modal title="移除 Skill" open={Boolean(removal)} onCancel={() => { if (!busy) setRemoval(undefined); }}
      okText="移除" cancelText="取消" okButtonProps={{ danger: true }} confirmLoading={busy}
      onOk={() => { if (removal) void act(async () => {
        await removeSkill(removal.id);
        setItems(current => current.filter(item => item.id !== removal.id));
        setRemoval(undefined);
      }); }}>
      <p>移除「{removal?.name}」？此 Skill 将从会话选单中移除。</p>
      {error && <Alert type="error" showIcon message={error} />}
    </Modal>
  </Card>;
}
