import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Spin, Tag } from 'antd';
import { ArrowUpOutlined, FileOutlined, FolderOpenOutlined, FolderOutlined, FolderAddOutlined, ImportOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { describeError } from './errors.mjs';
import { documentBridge, personalDocumentsChangedEvent } from './documentLibraryBridge';
import type { DocumentEntry, DocumentListing, DocumentScope } from './documentLibraryBridge';
import './document-library.css';

const labels = { private: '个人文档', shared: '共享文档' };

function DocumentBrowser({ scope, pickKind, onPick }: {
  scope: DocumentScope;
  pickKind?: DocumentEntry['kind'];
  onPick?: (scope: DocumentScope, entry: DocumentEntry) => void;
}) {
  const bridge = documentBridge();
  const [folder, setFolder] = useState('');
  const [listing, setListing] = useState<DocumentListing>();
  const [fetching, setFetching] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState<string>();
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const current = listing?.folder === folder ? listing : undefined;
  const folderParts = folder ? folder.split('/') : [];
  const privateLibrary = scope === 'private' && !onPick;

  useEffect(() => {
    if (scope !== 'private' || !bridge) return;
    const reload = () => setRevision(value => value + 1);
    window.addEventListener(personalDocumentsChangedEvent, reload);
    return () => window.removeEventListener(personalDocumentsChangedEvent, reload);
  }, [scope, bridge]);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    setFetching(true);
    setError('');
    void bridge.list(scope, folder).then(next => {
      if (active) setListing(next);
    }).catch(failure => {
      if (active) setError(describeError(failure, '无法读取文档'));
    }).finally(() => { if (active) setFetching(false); });
    return () => { active = false; };
  }, [bridge, scope, folder, revision]);

  async function mutate(run: () => Promise<DocumentListing | void>) {
    if (lock.current) return false;
    lock.current = true;
    setMutating(true);
    setError('');
    try {
      const next = await run();
      if (next) setListing(next);
      return true;
    } catch (failure) {
      setError(describeError(failure, '文档操作失败'));
      return false;
    } finally {
      lock.current = false;
      setMutating(false);
    }
  }

  const entries = (current?.entries || []).filter(entry => pickKind !== 'folder' || entry.kind === 'folder');
  const busy = fetching || mutating;
  return <section className="document-browser" aria-label={labels[scope]}>
    <header className="document-browser-header">
      <div>
        <h2>{labels[scope]} {scope === 'shared' && <Tag>只读</Tag>}</h2>
        {!onPick && <p>{scope === 'private' ? '本机保管，可在会话和项目中引用。' : '由作者统一维护。'}</p>}
      </div>
      {bridge && <div className="document-library-actions">
        <Button size="small" type="text" icon={<ReloadOutlined />} aria-label={'刷新' + labels[scope]} disabled={busy}
          onClick={() => setRevision(value => value + 1)} />
        {privateLibrary && <>
          <Button size="small" icon={<FolderAddOutlined />} disabled={busy || !current} onClick={() => setName('')}>新建文件夹</Button>
          <Button size="small" type="primary" icon={<ImportOutlined />} disabled={busy || !current}
            onClick={() => void mutate(() => bridge.importFiles(folder))}>导入文件</Button>
        </>}
      </div>}
    </header>
    {!bridge ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请在 Somnus Windows 桌面版使用文档库" /> : <>
      {folder && <div className="document-library-path">
        <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={mutating} aria-label="上一级文件夹"
          onClick={() => setFolder(folderParts.slice(0, -1).join('/'))} />
        <span>{labels[scope]} / {folderParts.join(' / ')}</span>
      </div>}
      {error && <Alert type="error" showIcon message={error} />}
      {fetching && <div className="document-library-loading"><Spin size="small" /></div>}
      {!fetching && current && (entries.length ? <ul className="document-library-entries">
        {entries.map(entry => <li key={entry.path}>
          <button type="button" className="document-library-row" disabled={mutating} onClick={() => {
            if (entry.kind === 'folder') setFolder(entry.path);
            else if (onPick) onPick(scope, entry);
            else void mutate(() => bridge.openFile(scope, entry.path));
          }}>
            {entry.kind === 'folder' ? <FolderOutlined aria-hidden="true" /> : <FileOutlined aria-hidden="true" />}
            <span>{entry.name}</span>
            {entry.kind === 'folder' ? <RightOutlined aria-hidden="true" /> : !onPick && <FolderOpenOutlined aria-hidden="true" />}
          </button>
        </li>)}
      </ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={scope === 'shared' && current.configured === false ? '尚未配置共享文档库' :
          scope === 'shared' ? '暂无共享文档' : folder ? '此文件夹为空' : '暂无个人文档'} />)}
      {pickKind === 'folder' && folder && current && <div className="document-library-actions">
        <Button type="primary" disabled={busy} onClick={() => onPick?.(scope, {
          kind: 'folder', name: folderParts[folderParts.length - 1], path: folder,
        })}>选择此文件夹</Button>
      </div>}
    </>}
    {privateLibrary && bridge && <Modal title="新建文件夹" open={name !== undefined} onCancel={() => setName(undefined)}
      confirmLoading={mutating} okText="创建" cancelText="取消" okButtonProps={{ disabled: !name?.trim() }}
      onOk={async () => { if (name?.trim() && await mutate(() => bridge.createFolder(folder, name.trim()))) setName(undefined); }}>
      {error && <Alert type="error" showIcon message={error} />}
      <Input value={name || ''} aria-label="文件夹名称" placeholder="输入文件夹名称"
        onChange={event => { setError(''); setName(event.target.value); }} disabled={mutating} />
    </Modal>}
  </section>;
}

export function DocumentLibrary() {
  return <main className="document-library">
    <h1>文档</h1>
    <DocumentBrowser scope="private" />
    <DocumentBrowser scope="shared" />
  </main>;
}

export function DocumentPicker({ open, onClose, onPick, title, kind = 'file' }: {
  open: boolean; onClose: () => void;
  onPick: (scope: DocumentScope, entry: DocumentEntry) => void;
  title?: string; kind?: DocumentEntry['kind'];
}) {
  return <Modal title={title || (kind === 'file' ? '从个人文档选择文件' : '从个人文档选择文件夹')}
    open={open} onCancel={onClose} footer={null}>
    {open && <DocumentBrowser scope="private" pickKind={kind} onPick={onPick} />}
  </Modal>;
}
