import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Tag } from 'antd';
import { createPluginCandidate, exportPortablePlugin, importPlugin, importPortablePlugin, isPortablePluginPackage, listPluginCandidates, pluginDevelopmentTemplate, preflightPlugin, preflightPortablePlugin } from './assistantApi';
import type { InstalledPlugin, PluginCandidate, PluginManifest, PluginPreflight, PortablePluginPackage } from './assistantApi';
import { describeError } from './errors.mjs';

const checkLabels = { pass: '通过', warn: '待核对', fail: '需修正' };
const checkColors = { pass: 'success', warn: 'warning', fail: 'error' };
const dependencyStates = {
  new: '将随包安装', reused: '复用本机', disabled: '已停用', conflict: '有冲突', missing: '未安装', enabled: '已启用',
};
type Reference = { id: string; name: string };
type DevelopmentFolders = { configured: boolean; owner: boolean; personalPath?: string; defaultPath?: string };
type PluginWorkspace = {
  status(): Promise<DevelopmentFolders>;
  openFolder(scope: 'personal' | 'default'): Promise<void>;
  choosePersonalManifest(): Promise<{ name: string; manifest: unknown } | null>;
  saveCandidate(candidateId: string): Promise<{ path: string } | null>;
};

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Checks({ report }: { report: PluginPreflight }) {
  return <ul className="plugin-dev-checks">
    {report.checks.map(check => <li key={check.id}>
      <Tag color={checkColors[check.status]}>{checkLabels[check.status]}</Tag><span>{check.message}
        {check.status !== 'pass' && check.id === 'skill_ids' && <small>可在 Skill 页导入或启用依赖，也可修正清单中的 ID。</small>}
        {check.status !== 'pass' && check.id === 'mcp_ids' && <small>可在 MCP 页添加或启用服务，也可修正清单中的 ID。</small>}
      </span>
    </li>)}
  </ul>;
}

export function PluginDevelopment({ onClose, onInstalled, owner, skills, mcp, initialManifest = '' }: {
  onClose: () => void; onInstalled: (plugin: InstalledPlugin) => void;
  owner: boolean; skills: Reference[]; mcp: Reference[];
  initialManifest?: string;
}) {
  const [manifest, setManifest] = useState(initialManifest);
  const [template, setTemplate] = useState<PluginManifest>();
  const [report, setReport] = useState<PluginPreflight>();
  const [portable, setPortable] = useState<PortablePluginPackage>();
  const [installed, setInstalled] = useState<InstalledPlugin>();
  const [candidates, setCandidates] = useState<PluginCandidate[]>([]);
  const [review, setReview] = useState<PluginCandidate>();
  const [folders, setFolders] = useState<DevelopmentFolders>();
  const [savedPath, setSavedPath] = useState('');
  const [busy, setBusy] = useState<'check' | 'install' | 'candidate' | 'load' | 'save' | 'export'>();
  const [error, setError] = useState('');
  const lock = useRef(false);
  const workspace = (window as Window & { somnusPluginWorkspace?: PluginWorkspace }).somnusPluginWorkspace;

  useEffect(() => {
    if (!workspace) return;
    let active = true;
    void workspace.status().then(result => { if (active) setFolders(result); })
      .catch(failure => { if (active) setError(describeError(failure, '无法读取开发目录')); });
    return () => { active = false; };
  }, [workspace]);

  useEffect(() => {
    const controller = new AbortController();
    void pluginDevelopmentTemplate(controller.signal).then(value => {
      if (!controller.signal.aborted) {
        setTemplate(value);
        setManifest(current => current || JSON.stringify(value, null, 2));
      }
    }).catch(failure => { if (!controller.signal.aborted) setError(describeError(failure, '无法读取插件模板')); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    void listPluginCandidates(controller.signal).then(items => {
      if (!controller.signal.aborted) setCandidates(previous => [
        ...previous, ...items.filter(item => !previous.some(old => old.id === item.id)),
      ]);
    }).catch(failure => { if (!controller.signal.aborted) setError(describeError(failure, '无法读取默认插件候选')); });
    return () => controller.abort();
  }, [owner]);

  function changeDraft(value: string) {
    setManifest(value);
    setReport(undefined);
    setPortable(undefined);
    setInstalled(undefined);
    setError('');
  }
  const validated = report?.ok && !portable ? report.manifest : undefined;
  const validatedPackage = report?.ok ? portable : undefined;

  async function openFolder(scope: 'personal' | 'default') {
    if (!workspace) return;
    try { await workspace.openFolder(scope); }
    catch (failure) { setError(describeError(failure, '无法打开开发目录')); }
  }

  async function chooseManifest() {
    if (!workspace || lock.current) return;
    lock.current = true;
    setBusy('load');
    try {
      const result = await workspace.choosePersonalManifest();
      if (result) changeDraft(JSON.stringify(result.manifest, null, 2));
    } catch (failure) { setError(describeError(failure, '无法读取所选清单')); }
    finally { lock.current = false; setBusy(undefined); }
  }

  async function saveCandidate(candidate: PluginCandidate) {
    if (!workspace || lock.current) return;
    lock.current = true;
    setBusy('save');
    setError('');
    setSavedPath('');
    try {
      const result = await workspace.saveCandidate(candidate.id);
      if (result?.path) setSavedPath(result.path);
    } catch (failure) { setError(describeError(failure, '无法保存候选到开发目录')); }
    finally { lock.current = false; setBusy(undefined); }
  }

  async function run(action: 'check' | 'install' | 'candidate' | 'export', candidate?: PluginCandidate) {
    const exportManifest = candidate?.manifest || validated;
    if (lock.current || action === 'install' && !validated && !validatedPackage ||
      action === 'export' && !exportManifest || action === 'candidate' && (!validated || !owner)) return;
    lock.current = true;
    setBusy(action);
    setError('');
    try {
      if (action === 'check') {
        setReport(undefined);
        setPortable(undefined);
        let input: unknown;
        try { input = JSON.parse(manifest); } catch { throw new Error('请修正 JSON 格式后重新检查。'); }
        if (isPortablePluginPackage(input)) {
          setPortable(input);
          setReport(await preflightPortablePlugin(input));
        } else {
          setReport(await preflightPlugin(input));
        }
      } else if (action === 'install' && (validatedPackage || validated)) {
        const plugin = validatedPackage ? await importPortablePlugin(validatedPackage) : await importPlugin(validated!);
        setInstalled(plugin);
        onInstalled(plugin);
      } else if (action === 'export' && exportManifest) {
        const result = await exportPortablePlugin(exportManifest);
        downloadJson('somnus-plugin-' + (exportManifest.version || 'package') + '.json', result.package);
      } else if (validated) {
        const candidate = await createPluginCandidate(validated);
        setCandidates(items => [candidate, ...items.filter(item => item.id !== candidate.id)]);
        setSavedPath('');
        setReview(candidate);
      }
    } catch (failure) {
      setError(describeError(failure, '插件开发操作失败'));
    } finally {
      lock.current = false;
      setBusy(undefined);
    }
  }

  return <Modal title="插件开发" open width={900} onCancel={() => { if (!busy) onClose(); }}
    closable={!busy} keyboard={!busy} maskClosable={!busy} footer={<Button disabled={Boolean(busy)} onClick={onClose}>关闭</Button>}>
    <div className="plugin-dev">
      {error && <Alert type="error" showIcon message={error} />}
      <div className="plugin-dev-grid">
        <section>
          <div className="plugin-section-heading"><h3>插件清单</h3>
          </div>
          <div className="plugin-dev-actions">
            {folders?.personalPath && <>
              <Button size="small" disabled={Boolean(busy)} onClick={() => void openFolder('personal')}>打开个人开发目录</Button>
              <Button size="small" disabled={Boolean(busy)} onClick={() => void chooseManifest()}>读取清单</Button>
            </>}
            <Button size="small" disabled={!template || Boolean(busy)} onClick={() => changeDraft(JSON.stringify(template, null, 2))}>载入模板</Button>
            <Button size="small" disabled={!template || Boolean(busy)} onClick={() => { if (template) downloadJson('somnus-plugin-template.json', template); }}>下载模板</Button>
          </div>
          <Input.TextArea aria-label="插件清单 JSON" className="plugin-dev-editor" rows={10} value={manifest} disabled={Boolean(busy)}
            onChange={event => changeDraft(event.target.value)} />
          {(skills.length > 0 || mcp.length > 0) && <details className="plugin-dev-references">
            <summary>可引用的 Skill 和 MCP</summary>
            {skills.length > 0 && <><h4>skill_ids</h4><ul>{skills.map(item => <li key={item.id}>{item.name} <code>{item.id}</code></li>)}</ul></>}
            {mcp.length > 0 && <><h4>mcp_ids</h4><ul>{mcp.map(item => <li key={item.id}>{item.name} <code>{item.id}</code></li>)}</ul></>}
          </details>}
        </section>
        <section>
          <div className="plugin-section-heading"><h3>预检结果</h3>
            {report?.manifest?.version && <Tag>v{report.manifest.version}</Tag>}
            {portable && <Tag>可移植插件包</Tag>}
          </div>
          {report ? <Checks report={report} /> : <p className="plugin-muted">检查版本和依赖后，即可试装。</p>}
          {report?.references && <details className="plugin-dev-references">
            <summary>查看依赖检查</summary>
            <ul>
              {Object.entries(report.references.skills).map(([name, state]) => <li key={'skill:' + name}>Skill · {name} · {dependencyStates[state]}</li>)}
              {Object.entries(report.references.mcp_ids).map(([id, state]) => <li key={'mcp:' + id}>MCP · {id} · {dependencyStates[state]}</li>)}
            </ul>
          </details>}
        </section>
      </div>
      <div className="plugin-dev-actions">
        <Button type="primary" disabled={!manifest.trim() || Boolean(busy)} loading={busy === 'check'}
          onClick={() => void run('check')}>检查插件</Button>
        <Button disabled={(!validated && !validatedPackage) || Boolean(installed || busy)} loading={busy === 'install'}
          onClick={() => void run('install')}>试装到个人插件</Button>
        {!portable && <Button disabled={!validated || Boolean(busy)} loading={busy === 'export'}
          title="包含所选 Skill 文本及参考资料。MCP 保留依赖引用。" onClick={() => void run('export')}>导出可移植插件包</Button>}
        {owner && <Button disabled={!validated || Boolean(busy)} loading={busy === 'candidate'}
          onClick={() => void run('candidate')}>生成默认插件候选</Button>}
      </div>
      {installed && <Alert type="success" showIcon message={'已试装「' + installed.name + '」。可在个人插件中启用。'} />}
      {owner && candidates.length > 0 && <section className="plugin-dev-candidates" aria-label="默认插件候选">
        <h3>默认插件候选</h3>
        <p className="plugin-muted">候选保存在这台电脑，供审阅。</p>
        <div className="plugin-dev-actions">{candidates.map(candidate =>
          <Button key={candidate.id} type={review?.id === candidate.id ? 'primary' : 'default'} aria-pressed={review?.id === candidate.id} disabled={Boolean(busy)}
            onClick={() => { setSavedPath(''); setReview(candidate); }}>{candidate.manifest.name} · v{candidate.manifest.version}</Button>)}</div>
        {review && <details open><summary>候选详情</summary>
          <pre>{JSON.stringify(review.manifest, null, 2)}</pre>
          <p>候选清单校验值 <code>{review.sha256}</code></p>
          <Checks report={review.report} />
          <div className="plugin-dev-actions">
            <Button onClick={() => downloadJson('somnus-plugin-review-' + (review.manifest.version || 'candidate') + '.json', review)}>导出审阅文件</Button>
            <Button disabled={Boolean(busy)} title="按候选清单重新检查，并读取当前本机 Skill 内容"
              onClick={() => void run('export', review)}>从候选导出可移植包</Button>
            {folders?.owner && folders.defaultPath && <>
              <Button onClick={() => void openFolder('default')}>打开默认插件开发目录</Button>
              <Button disabled={Boolean(busy)} loading={busy === 'save'} onClick={() => void saveCandidate(review)}>保存到默认插件开发目录</Button>
            </>}
          </div>
          {savedPath && <p>已保存 <code>{savedPath}</code></p>}
        </details>}
      </section>}
    </div>
  </Modal>;
}
