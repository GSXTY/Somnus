import { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Segmented, Select, Space, Spin } from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import { workspaces } from '../chat/assistantApi';
import type { ConversationWorktree } from '../chat/assistantApi';
import type { DevelopmentApprovalDetails } from '../chat/assistantAcp';
import { describeError } from '../shared/errors.mjs';
import './projectTools.css';

export type TestRunner = { id: string; name: string; source: string; executable: string; args: string[] };
export type GitChanges = { staged: string; unstaged: string; untracked?: string[]; truncated: boolean };
export type ProjectToolsBridge = {
  chooseTestExecutable?: () => Promise<string | null>;
  listTestRunners?: (workspace: string) => Promise<TestRunner[]>;
  saveTestRunner?: (workspace: string, runner: Omit<TestRunner, 'id'> & { id?: string }) => Promise<TestRunner>;
  removeTestRunner?: (workspace: string, id: string) => Promise<void>;
  gitDiff?: (workspace: string, source: string, conversationId?: string) => Promise<GitChanges>;
  createWorktree?: (conversationId: string, source: string) => Promise<{ worktree: ConversationWorktree } | null>;
  openWorktree?: (conversationId: string, target?: 'explorer' | 'vscode' | 'git-bash' | 'terminal') => Promise<void>;
  worktreeLocation?: (conversationId: string) => Promise<string>;
  openApprovedFile?: (conversationId: string, proposalId: string) => Promise<void>;
  revealProposal?: (conversationId: string, proposalId: string) => Promise<void>;
  prepareDevelopment?: (conversationId: string, jobId: string) => Promise<{ kind: 'complete' } | { kind: 'approval'; details: DevelopmentApprovalDetails }>;
  respondDevelopment?: (conversationId: string, jobId: string, approved: boolean) => Promise<{ kind: 'complete' }>;
  cancelDevelopment?: (conversationId: string, jobId: string) => Promise<void>;
};

function sourceOptions(paths: string[]) {
  return paths.map((path, index) => ({ label: path, value: 'source_' + (index + 1) }));
}

function useProjectTools(workspace: string, enabled = true, loadRunners = true) {
  const bridge = window.vvmanProjects;
  const [folders, setFolders] = useState<string[]>([]);
  const [runners, setRunners] = useState<TestRunner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setLoading(true);
    setError('');
    Promise.all([workspaces(), (loadRunners && bridge?.listTestRunners?.(workspace)) || Promise.resolve([])])
      .then(([projects, configs]) => {
        if (!current) return;
        const project = projects.find(item => item.id === workspace);
        setFolders(project?.source_folders ?? (project?.root_path ? [project.root_path] : []));
        setRunners(configs);
      })
      .catch(failure => { if (current) setError(describeError(failure, '无法读取项目设置')); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspace, bridge, enabled, loadRunners]);
  return { bridge, folders, runners, setRunners, loading, error, setError };
}

function Output({ text, empty }: { text: string; empty: string }) {
  return text ? <pre className="project-tool-output" tabIndex={0}>{text}</pre> : <p className="small-note">{empty}</p>;
}

function DiffOutput({ text }: { text: string }) {
  return text ? <pre className="project-tool-output project-tool-diff" tabIndex={0}>{text.split('\n').map((line, index) =>
    <span key={index} data-line={line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('@@')
      ? 'heading' : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : undefined}>{line}{'\n'}</span>
  )}</pre> : <p className="small-note">没有差异。</p>;
}

export function ProjectTools({ workspace, conversationId, worktree }: { workspace: string; conversationId?: string; worktree?: ConversationWorktree | null }) {
  const [open, setOpen] = useState(false);
  if (!window.vvmanProjects?.gitDiff || workspace === 'default') return null;
  return <>
    <Button type="text" size="small" icon={<CodeOutlined />} aria-label="Git 差异" onClick={() => setOpen(true)}>Git 差异</Button>
    <Modal title="Git 差异" open={open} width={820} footer={null} destroyOnHidden onCancel={() => setOpen(false)}>
      <ProjectToolsPanel key={conversationId || workspace} workspace={workspace} open={open} conversationId={conversationId} worktree={worktree} />
    </Modal>
  </>;
}

export function ProjectToolsPanel({ workspace, open, conversationId, worktree }: { workspace: string; open: boolean; conversationId?: string; worktree?: ConversationWorktree | null }) {
  const { bridge, folders, loading, error, setError } = useProjectTools(workspace, open, false);
  const [source, setSource] = useState('source_1');
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<GitChanges>();
  const [section, setSection] = useState<'staged' | 'unstaged' | 'untracked'>('unstaged');
  const options = sourceOptions(folders);
  const selectedSource = worktree?.source || (options.some(option => option.value === source) ? source : 'source_1');
  async function readDiff() {
    if (busy || !bridge?.gitDiff) return;
    setBusy(true);
    setError('');
    setChanges(undefined);
    try {
      const result = await bridge.gitDiff(workspace, selectedSource, conversationId);
      setChanges(result);
      setSection(result.unstaged ? 'unstaged' : result.staged ? 'staged' : result.untracked?.length ? 'untracked' : 'unstaged');
    } catch (failure) { setError(describeError(failure, '无法读取 Git 差异')); }
    finally { setBusy(false); }
  }
  if (loading) return <Spin size="small" />;
  return <div className="project-tools-panel">
    {error && <Alert type="error" showIcon message={error} />}
    {!folders.length ? <p className="small-note">请先在项目设置中添加本机文件夹。</p> : <>
      <p className="small-note">{worktree ? '查看此会话的工作树差异。' : '查看项目目录的 Git 差异。'}审阅并应用文件修改后，可在这里查看对应变更。</p>
      <div className="project-tool-controls">
        {worktree ? <code>{worktree.label}</code> : <Select aria-label="Git 来源文件夹" value={selectedSource} options={options} disabled={busy}
          onChange={value => { setSource(value); setChanges(undefined); setError(''); }} />}
        <Button loading={busy} onClick={() => void readDiff()}>查看差异</Button>
      </div>
      {changes && <>
        <Segmented aria-label="差异范围" size="small" value={section} onChange={setSection} options={[
          { label: '未暂存', value: 'unstaged' }, { label: '已暂存', value: 'staged' },
          ...(changes.untracked ? [{ label: '未跟踪', value: 'untracked' as const }] : []),
        ]} />
        {changes.truncated && <Alert type="warning" showIcon message="部分差异已省略" />}
        {section === 'untracked'
          ? <Output text={(changes.untracked || []).join('\n')} empty="没有未跟踪文件。" />
          : <DiffOutput text={changes[section]} />}
      </>}
    </>}
  </div>;
}

export function ChatWorktree({ workspace, conversationId, worktree, disabled, open, onOpenChange, onBind, onBusy }: {
  workspace: string;
  conversationId: string;
  worktree?: ConversationWorktree | null;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBind: (worktree: ConversationWorktree) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [source, setSource] = useState('source_1');
  const [busy, setBusy] = useState(false);
  const { bridge, folders, loading, error, setError } = useProjectTools(workspace, open, false);
  if (workspace === 'default' || (!bridge?.createWorktree && !worktree)) return null;
  const options = sourceOptions(folders);
  const selected = options.some(option => option.value === source) ? source : options[0]?.value;
  const boundFolder = options.find(option => option.value === worktree?.source)?.label;
  async function create() {
    if (!bridge?.createWorktree || !selected || disabled || busy) return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const result = await bridge.createWorktree(conversationId, selected);
      if (result) {
        onBind(result.worktree);
        onOpenChange(false);
      }
    } catch (failure) { setError(describeError(failure, '无法创建会话工作树')); }
    finally { setBusy(false); onBusy(false); }
  }
  async function openFolder() {
    setError('');
    try { await bridge?.openWorktree?.(conversationId); }
    catch (failure) { setError(describeError(failure, '无法打开工作树')); }
  }
  return <>
    <Modal open={open} title={worktree ? '会话工作树' : '创建会话工作树'} onCancel={() => { if (!busy) onOpenChange(false); }}
      closable={!busy} keyboard={!busy} maskClosable={!busy}
      footer={worktree ? <Space>
        <Button onClick={() => onOpenChange(false)}>关闭</Button>
        {bridge?.openWorktree && <Button type="primary" onClick={() => void openFolder()}>打开工作树</Button>}
      </Space> : <Space>
        <Button disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
        <Button type="primary" loading={busy} disabled={loading || !selected || disabled} onClick={() => void create()}>创建并绑定</Button>
      </Space>}>
      {worktree ? <dl className="project-test-result">
        <div><dt>工作树</dt><dd>{worktree.label}</dd></div>
        <div><dt>项目来源</dt><dd>{boundFolder || worktree.source}</dd></div>
        <div><dt>分支</dt><dd><code>{worktree.branch}</code></dd></div>
        <div><dt>基线提交</dt><dd><code>{worktree.commit}</code></dd></div>
      </dl> : <>
        <p>以所选 Git 目录当前已提交的 HEAD 创建独立工作树。原目录的未提交改动不会带入，会话中建议的文件修改仍需审阅后写入。</p>
        {loading ? <Spin size="small" /> : options.length ? <Select aria-label="工作树来源文件夹" style={{ width: '100%' }}
          value={selected} options={options} disabled={busy} onChange={setSource} />
          : <p className="small-note">请先在项目设置中添加 Git 仓库所在的本机文件夹。</p>}
      </>}
      {error && <Alert type="error" showIcon message={error} />}
    </Modal>
  </>;
}

type RunnerDraft = { id?: string; name: string; source: string; executable: string; argumentsText: string };

export function ProjectTestSettings({ workspace }: { workspace: string }) {
  const { bridge, folders, runners, setRunners, loading, error, setError } = useProjectTools(workspace);
  const [draft, setDraft] = useState<RunnerDraft>();
  const [removal, setRemoval] = useState<TestRunner>();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [editorError, setEditorError] = useState('');
  const supported = bridge?.saveTestRunner && bridge.chooseTestExecutable && bridge.removeTestRunner;
  if (!supported) return <Alert type="info" showIcon message="请在 Somnus 桌面版管理项目测试。" />;
  if (loading) return <Spin size="small" />;
  function edit(runner?: TestRunner) {
    setEditorError('');
    setDraft(runner ? { ...runner, argumentsText: runner.args.join('\n') } : { name: '', source: 'source_1', executable: '', argumentsText: '' });
  }
  async function chooseExecutable() {
    setPicking(true);
    setEditorError('');
    try {
      const executable = await bridge?.chooseTestExecutable?.();
      if (executable) setDraft(previous => previous && { ...previous, executable });
    } catch (failure) { setEditorError(describeError(failure, '无法选择测试程序')); }
    finally { setPicking(false); }
  }
  async function save() {
    if (!draft || busy || picking || !bridge?.saveTestRunner) return;
    setBusy(true);
    setEditorError('');
    try {
      const saved = await bridge.saveTestRunner(workspace, {
        id: draft.id, name: draft.name.trim(), source: draft.source, executable: draft.executable,
        args: draft.argumentsText ? draft.argumentsText.split(/\r?\n/).filter(line => line.length > 0) : [],
      });
      setRunners(current => draft.id ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved]);
      setDraft(undefined);
    } catch (failure) { setEditorError(describeError(failure, '无法保存测试预设')); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!removal || busy || !bridge?.removeTestRunner) return;
    setBusy(true);
    setError('');
    try {
      await bridge.removeTestRunner(workspace, removal.id);
      setRunners(current => current.filter(item => item.id !== removal.id));
      setRemoval(undefined);
    } catch (failure) { setError(describeError(failure, '无法移除测试预设')); setRemoval(undefined); }
    finally { setBusy(false); }
  }
  return <div className="project-test-settings">
    {error && <Alert type="error" showIcon message={error} />}
    {!folders.length ? <p className="small-note">请先选择一个项目，并为项目添加本机文件夹。</p> : <>
      <p className="small-note">为当前项目设置测试程序和参数。每次运行前可在本机确认完整命令和工作目录。</p>
      <div className="settings-card">
        {runners.map(item => <div className="settings-row" key={item.id}>
          <div><h3>{item.name}</h3><p>{sourceOptions(folders).find(folder => folder.value === item.source)?.label || '来源文件夹不可用'}</p></div>
          <Space wrap><Button onClick={() => edit(item)}>编辑</Button><Button onClick={() => setRemoval(item)}>移除</Button></Space>
        </div>)}
        {!runners.length && <div className="settings-row">暂无测试预设</div>}
      </div>
      <Button type="primary" onClick={() => edit()}>添加测试预设</Button>
    </>}
    <Modal title={draft?.id ? '编辑测试预设' : '添加测试预设'} open={Boolean(draft)} onCancel={() => { if (!busy && !picking) setDraft(undefined); }}
      onOk={() => void save()} okText="保存" confirmLoading={busy} okButtonProps={{ disabled: picking || !draft?.name.trim() || !draft.executable }}>
      {draft && <div className="project-runner-form">
        <label>预设名称<Input value={draft.name} maxLength={80} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>来源文件夹<Select aria-label="测试来源文件夹" value={draft.source} options={sourceOptions(folders)} onChange={source => setDraft({ ...draft, source })} /></label>
        <label>测试程序<Input readOnly value={draft.executable} placeholder="选择 Windows 可执行文件" /></label>
        <Button loading={picking} onClick={() => void chooseExecutable()}>选择测试程序</Button>
        <label>参数（每行一个）<Input.TextArea value={draft.argumentsText} placeholder={'-m\npytest'} autoSize={{ minRows: 3, maxRows: 6 }}
          onChange={event => setDraft({ ...draft, argumentsText: event.target.value })} /></label>
        {editorError && <Alert type="error" showIcon message={editorError} />}
      </div>}
    </Modal>
    <Modal title="移除测试预设" open={Boolean(removal)} onCancel={() => { if (!busy) setRemoval(undefined); }} onOk={() => void remove()}
      okText="移除" okButtonProps={{ danger: true }} confirmLoading={busy}>
      移除“{removal?.name}”？
    </Modal>
  </div>;
}
