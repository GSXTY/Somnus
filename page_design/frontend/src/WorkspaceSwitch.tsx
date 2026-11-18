import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { InputRef } from 'antd';
import { Alert, Button, Dropdown, Input, Modal, Select } from 'antd';
import { CloseOutlined, EllipsisOutlined, FolderAddOutlined, FolderOutlined, PushpinOutlined, PlusOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { createWorkspace, updateWorkspace, removeWorkspace, workspaces as listWorkspaces } from './assistantApi';
import type { ProjectToolsBridge } from './ProjectTools';
import type { ProjectMemoryMode, ProjectSourceFolder, Workspace } from './assistantApi';
import { DocumentPicker } from './DocumentLibrary';
import { documentBridge } from './documentLibraryBridge';

declare global {
  interface Window {
    vvmanProjects?: ProjectToolsBridge & {
      chooseDirectory: () => Promise<{ root_path: string; folder_grant: string } | null>;
      chooseDocumentFolder?: (path: string) => Promise<{ root_path: string; folder_grant: string }>;
      openDirectory: (projectId: string, sourceIndex?: number, target?: 'explorer' | 'vscode' | 'git-bash' | 'terminal') => Promise<void>;
    };
  }
}

const defaultProject: Workspace = { id: 'default', name: '默认项目', conversation_count: 0 };
type Props = { value: string; onChange: (id: string) => void; disabled?: boolean; children?: ReactNode;
  onSearch?: () => void; onSettings?: () => void;
  chooser?: { open: boolean; onOpenChange: (open: boolean) => void } };
type Editor = {
  project?: Workspace; name: string; folders: ProjectSourceFolder[];
  memory: ProjectMemoryMode; instructions: string;
};
const memoryChoices = [
  { value: 'default', label: '默认记忆' },
  { value: 'project', label: '仅项目记忆' },
] satisfies { value: ProjectMemoryMode; label: string }[];

function sourcePaths(project?: Workspace) {
  return project?.source_folders ?? (project?.root_path ? [project.root_path] : []);
}

export function WorkspaceSwitch({ value, onChange, disabled, chooser, onSearch, onSettings, children }: Props) {
  const [projects, setProjects] = useState<Workspace[]>([defaultProject]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [remove, setRemove] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);
  const editorName = useRef<InputRef>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const selected = useRef(value);
  selected.current = value;

  function choose(id: string) {
    try { localStorage.setItem('ya70.workspace', id); } catch { /* optional preference */ }
    onChange(id);
  }
  useEffect(() => {
    let alive = true;
    let generation = 0;
    function load() {
      const current = ++generation;
      listWorkspaces().then(list => {
        if (!alive || current !== generation) return;
        setProjects(list);
        if (!list.some(project => project.id === selected.current && !project.archived)) choose('default');
      }).catch(() => { if (alive && current === generation) setError('无法读取项目列表'); });
    }
    load();
    window.addEventListener('somnus:projects-changed', load);
    return () => { alive = false; window.removeEventListener('somnus:projects-changed', load); };
  }, []);

  function startEdit(project?: Workspace) {
    setError('');
    setInstructionsOpen(false);
    setLibraryOpen(false);
    setEditor({
      project, name: project?.name || '', folders: sourcePaths(project).map(root_path => ({ root_path })),
      memory: project?.memory_mode || 'default', instructions: project?.instructions || '',
    });
  }
  async function run(action: () => Promise<void>) {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '项目操作失败'); }
    finally { setBusy(false); }
  }
  function update(project: Workspace) {
    setProjects(old => old.some(item => item.id === project.id)
      ? old.map(item => item.id === project.id ? project : item) : [...old, project]);
    window.dispatchEvent(new Event('somnus:projects-changed'));
  }
  function save() {
    if (!editor?.name.trim()) return;
    void run(async () => {
      const { project, name, folders, memory, instructions } = editor;
      const foldersChanged = JSON.stringify(folders.map(folder => folder.root_path)) !== JSON.stringify(sourcePaths(project));
      const settings = { memory_mode: memory, instructions, ...(foldersChanged ? { source_folders: folders } : {}) };
      const result = project
        ? await updateWorkspace(project.id, { name: name.trim(), ...settings })
        : await createWorkspace(name.trim(), settings);
      update(result);
      if (!project) choose(result.id);
      setEditor(null);
    });
  }
  function pickFolder(libraryPath?: string) {
    const bridge = window.vvmanProjects;
    if (!bridge || !editor || editor.folders.length >= 8) return;
    void run(async () => {
      const folder = libraryPath === undefined
        ? await bridge.chooseDirectory()
        : await bridge.chooseDocumentFolder?.(libraryPath);
      if (!folder) return;
      setEditor(current => {
        if (!current || current.folders.some(item => item.root_path.toLowerCase() === folder.root_path.toLowerCase())) return current;
        return { ...current, folders: [...current.folders, folder] };
      });
    });
  }
  function row(project: Workspace) {
    const custom = project.id !== 'default';
    const menu = {
      items: [
        ...(sourcePaths(project).length && window.vvmanProjects ? [{
          key: 'open', label: '打开本地文件夹',
          ...(sourcePaths(project).length > 1 ? { children: sourcePaths(project).map((path, index) => ({
            key: 'open:' + index, label: index === 0 ? path + '（主文件夹）' : path,
          })) } : {}),
        }] : []),
        ...(custom ? [
          { key: 'edit', label: '编辑项目' },
          { key: 'pin', label: project.pinned ? '取消置顶' : '置顶项目' },
          { key: 'archive', label: project.archived ? '恢复项目' : '归档项目' },
          { key: 'remove', label: '移除项目', danger: true },
        ] : []),
      ],
      onClick: ({ key }: { key: string }) => {
        if (key === 'edit') startEdit(project);
        if (key === 'remove') { setError(''); setRemove(project); }
        if (key === 'open' || key.startsWith('open:')) void run(async () => { await window.vvmanProjects?.openDirectory(project.id, key === 'open' ? 0 : Number(key.slice(5))); });
        if (key === 'pin' || key === 'archive') void run(async () => {
          const result = await updateWorkspace(project.id, key === 'pin' ? { pinned: !project.pinned } : { archived: !project.archived });
          update(result);
          if (result.archived && value === project.id) choose('default');
        });
      },
    };
    const button = <button type="button" className="nav-project-row" aria-pressed={project.id === value}
      disabled={disabled || busy || project.archived} onClick={() => choose(project.id)} title={project.root_path || project.name}>
      {project.pinned ? <PushpinOutlined /> : <FolderOutlined />}<span>{project.name}</span>
    </button>;
    return <div className="nav-project-group" key={project.id}>
      <div className="nav-project-line">
        {Boolean(menu.items.length) && !project.archived ? <Dropdown menu={menu} trigger={['contextMenu']} disabled={disabled || busy}>{button}</Dropdown> : button}
        {Boolean(menu.items.length) && <Dropdown menu={menu} trigger={['click']} disabled={disabled || busy}>
          <button type="button" className="nav-recent-more" aria-label={`更多项目操作：${project.name}`} aria-haspopup="menu"
            disabled={disabled || busy}><EllipsisOutlined /></button>
        </Dropdown>}
      </div>
      {project.id === value && !project.archived && children}
    </div>;
  }
  const archived = projects.filter(project => project.archived);
  const projectList = <section className="nav-project-section" aria-label="工作区">
    <header><h2>工作区</h2><div className="nav-workspace-actions">
      {onSearch && <Button type="text" size="small" icon={<SearchOutlined />}
        onClick={onSearch} aria-label="搜索会话" title="搜索会话" />}
      {onSettings && <Button type="text" size="small" icon={<SettingOutlined />} disabled={disabled || busy}
        onClick={() => {
          const project = projects.find(item => item.id === value && item.id !== 'default' && !item.archived);
          if (project) startEdit(project);
          else { chooser?.onOpenChange(false); onSettings(); }
        }} aria-label="工作区设置" title="工作区设置" />}
      <Button type="text" size="small" icon={<FolderAddOutlined />}
        disabled={disabled || busy} onClick={() => startEdit()} aria-label="新建项目" title="新建项目" />
    </div></header>
    {!editor && !remove && error && <Alert type="error" showIcon message={error} />}
    <div className="nav-project-list">
      {projects.filter(project => !project.archived).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))).map(row)}
      {archived.length > 0 && <Button type="text" size="small" aria-expanded={archivedOpen}
        onClick={() => setArchivedOpen(open => !open)}>已归档项目（{archived.length}）</Button>}
      {archivedOpen && archived.map(row)}
    </div>
  </section>;

  return <>
    {chooser ? <><button type="button" className="nav-project-compact" aria-label="项目" title="项目"
      aria-expanded={chooser.open} aria-haspopup="dialog" onClick={() => chooser.onOpenChange(true)}><FolderOutlined /></button>
      <Modal title="项目" open={chooser.open} footer={null} onCancel={() => chooser.onOpenChange(false)}>
        {chooser.open && projectList}
      </Modal></> : projectList}
    <Modal className="project-editor" width={640} centered title={editor?.project ? '编辑项目' : '新建项目'} open={Boolean(editor)}
      onCancel={() => { if (!busy) setEditor(null); }}
      afterOpenChange={open => { if (open) editorName.current?.focus(); }}
      closable={!busy} maskClosable={!busy} keyboard={!busy}
      footer={<div className="project-editor-footer">
        <Select<ProjectMemoryMode> id="project-memory" aria-label="项目记忆" value={editor?.memory || 'default'} options={memoryChoices}
          optionRender={option => <div>{option.label}<small className="project-memory-hint">
            {option.value === 'project' ? '参考此项目的近期会话' : '使用当前会话的历史消息'}
          </small></div>} disabled={busy}
          onChange={memory => setEditor(current => current && { ...current, memory })} />
        <Button type="primary" className="project-editor-save" onClick={save} loading={busy}
          disabled={disabled || !editor?.name.trim()}>{editor?.project ? '保存项目' : '创建项目'}</Button>
      </div>}>
      <div className="project-editor-fields">
        <div className="project-editor-field">
          <label htmlFor="project-name">项目名称</label>
          <Input id="project-name" ref={editorName} prefix={<FolderOutlined />} value={editor?.name || ''} maxLength={60} disabled={busy} placeholder="例如：呼吸数据周报" onPressEnter={save}
            onChange={event => { const name = event.target.value; setEditor(current => current && { ...current, name }); }} />
        </div>
        <div className="project-editor-field">
          <span className="project-editor-label" id="project-sources">来源文件夹</span>
          <div className="project-editor-sources" aria-labelledby="project-sources">
            {editor?.folders.map((folder, index) => <div className="project-editor-source" key={folder.root_path}>
              <FolderOutlined /><span title={folder.root_path}>{folder.root_path}</span>
              {editor.folders.length > 1 && (index === 0 ? <small>主文件夹</small> : <Button type="text" size="small"
                disabled={busy || !window.vvmanProjects} onClick={() => setEditor(current => current && ({
                  ...current, folders: [folder, ...current.folders.filter(item => item.root_path !== folder.root_path)],
                }))}>设为主文件夹</Button>)}
              <Button type="text" size="small" icon={<CloseOutlined />} disabled={busy || !window.vvmanProjects}
                aria-label={'移除来源文件夹 ' + folder.root_path}
                onClick={() => setEditor(current => current && { ...current, folders: current.folders.filter(item => item.root_path !== folder.root_path) })} />
            </div>)}
            <div className="project-editor-add">
              <Button icon={<PlusOutlined />} onClick={() => pickFolder()} disabled={busy || !window.vvmanProjects || (editor?.folders.length || 0) >= 8}>添加本机文件夹</Button>
              {documentBridge() && window.vvmanProjects?.chooseDocumentFolder &&
                <Button icon={<FolderOutlined />} onClick={() => setLibraryOpen(true)}
                  disabled={busy || (editor?.folders.length || 0) >= 8}>从个人文档选择</Button>}
              {!window.vvmanProjects && <small>在 Windows 桌面版添加</small>}
            </div>
          </div>
          {editor?.folders.length === 8 && <small>一个项目最多关联 8 个来源文件夹。</small>}
        </div>
        <div className="project-editor-field project-editor-instructions">
          <Button type="text" onClick={() => setInstructionsOpen(open => !open)}
            aria-expanded={instructionsOpen} aria-controls="project-instructions">项目指令{instructionsOpen ? ' ⌃' : ' ⌄'}</Button>
          {instructionsOpen && <Input.TextArea id="project-instructions" aria-label="项目指令" rows={2} maxLength={6000}
            disabled={busy} placeholder="希望此项目中的回复遵循什么要求？" value={editor?.instructions || ''}
            onChange={event => { const instructions = event.target.value; setEditor(current => current && { ...current, instructions }); }} />}
        </div>
        {error && <Alert type="error" showIcon message={error} />}
      </div>
    </Modal>
    {editor && <DocumentPicker open={libraryOpen} kind="folder" title="选择项目来源文件夹"
      onClose={() => setLibraryOpen(false)} onPick={(scope, entry) => {
        setLibraryOpen(false);
        if (scope === 'private' && entry.kind === 'folder') pickFolder(entry.path);
      }} />}
    <Modal title="移除项目" open={Boolean(remove)} okText="移除项目" cancelText="取消"
      confirmLoading={busy} closable={!busy} maskClosable={!busy} keyboard={!busy} cancelButtonProps={{ disabled: busy }} okButtonProps={{ danger: true }}
      onCancel={() => { if (!busy) setRemove(null); }} onOk={() => {
        if (remove) void run(async () => {
          await removeWorkspace(remove.id);
          setProjects(old => old.filter(item => item.id !== remove.id));
          if (value === remove.id) choose('default');
          setRemove(null);
        });
      }}>
      <p>移除「{remove?.name}」后，会话将移至默认项目。本地文件夹和文件会保留。</p>
      {error && <Alert type="error" showIcon message={error} />}
    </Modal>
  </>;
}
