import { useEffect, useState } from 'react';
import { workspaces } from './assistantApi';
import type { Conversation, Workspace } from './assistantApi';

export function ChatProjectContext({ workspace, conversation, visible }: {
  workspace: string; conversation: Conversation | null; visible: boolean;
}) {
  const [project, setProject] = useState<Workspace>();
  const [projectError, setProjectError] = useState(false);
  const [worktree, setWorktree] = useState<{ id: string; path: string }>();
  const [worktreeError, setWorktreeError] = useState(false);
  const conversationId = conversation?.id;
  const worktreeCommit = conversation?.worktree?.commit;

  useEffect(() => {
    if (!visible) return;
    let request: AbortController | undefined;
    function load() {
      request?.abort();
      const current = new AbortController();
      request = current;
      setProjectError(false);
      void workspaces(current.signal).then(projects => {
        if (!current.signal.aborted) setProject(projects.find(item => item.id === workspace));
      }).catch(() => { if (!current.signal.aborted) setProjectError(true); });
    }
    load();
    window.addEventListener('somnus:projects-changed', load);
    return () => { request?.abort(); window.removeEventListener('somnus:projects-changed', load); };
  }, [workspace, visible]);

  useEffect(() => {
    setWorktree(undefined);
    setWorktreeError(false);
    if (!visible || !worktreeCommit || !conversationId) return;
    const locate = window.vvmanProjects?.worktreeLocation;
    if (!locate) { setWorktreeError(true); return; }
    let current = true;
    void locate(conversationId).then(path => {
      if (current) setWorktree({ id: conversationId, path });
    }).catch(() => { if (current) setWorktreeError(true); });
    return () => { current = false; };
  }, [conversationId, visible, worktreeCommit]);

  const currentProject = project?.id === workspace ? project : undefined;
  const roots = currentProject?.source_folders ?? (currentProject?.root_path ? [currentProject.root_path] : []);
  const activeWorktree = worktree?.id === conversationId ? worktree : undefined;
  const permission = conversation?.permission_mode === 'full' ? '完全访问' :
    conversation?.permission_mode === 'workspace_direct' ? '工作区直接修改' : conversation?.permission_mode === 'workspace_write' ? '修改前确认' : '只读';
  return <dl className="assistant-project-context" aria-label="当前会话项目">
    <div><dt>项目</dt><dd>{currentProject?.name || (workspace === 'default' ? '默认项目' : projectError ? '读取失败' : '加载中…')}</dd></div>
    <div><dt>{worktreeCommit ? '工作树保存位置' : '项目保存位置'}</dt><dd>
      {worktreeCommit ? activeWorktree?.path ? <code>{activeWorktree.path}</code> : worktreeError ? '工作树位置不可用' : '加载中…' :
        roots.length ? roots.map(path => <code key={path}>{path}</code>) :
          projectError ? '读取失败' : currentProject || workspace === 'default' ? '未关联文件夹' : '加载中…'}
    </dd></div>
    <div><dt>文件权限</dt><dd>{permission}</dd></div>
  </dl>;
}
