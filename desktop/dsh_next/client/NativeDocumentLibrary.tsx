import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { documentBridge, personalDocumentsChangedEvent } from '../../../page_design/frontend/src/documents/documentLibraryBridge'
import type { DocumentEntry, DocumentFile, DocumentListing, DocumentScope } from '../../../page_design/frontend/src/documents/documentLibraryBridge'
import { describeError } from '../../../page_design/frontend/src/shared/errors.mjs'
import './native-documents.css'

const folders: Record<DocumentScope, string> = { private: '', shared: '' }
const labels = { private: '个人文档', shared: '共享文档' }
type EditDialog = { kind: 'folder' } | { kind: 'file' } | { kind: 'delete'; entry: DocumentEntry }

function DocumentModal({ title, busy = false, onClose, children }: {
  title: string; busy?: boolean; onClose(): void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} className="somnus-document-dialog" aria-label={title}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header><h2>{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="关闭">×</button></header>
    {children}
  </dialog>
}

function DocumentPreview({ file, onClose, onDownload }: {
  file: DocumentFile; onClose(): void; onDownload(): void
}) {
  const [url, setUrl] = useState('')
  const isImage = /^image\/(png|jpeg|gif|webp)$/.test(file.mimeType)
  const isPdf = file.mimeType === 'application/pdf'
  const isText = file.mimeType === 'text/plain'
  const bytes = Uint8Array.from(atob(file.dataBase64), char => char.charCodeAt(0))
  useEffect(() => {
    if (!isImage && !isPdf) return
    const href = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
    setUrl(href)
    return () => URL.revokeObjectURL(href)
  }, [file])
  return <DocumentModal title={file.name} onClose={onClose}>
    <div className="somnus-document-preview">
      {isText ? <pre>{new TextDecoder().decode(bytes)}</pre> : isImage && url ?
        <img src={url} alt={file.name} /> : isPdf && url ?
          <object data={url} type="application/pdf" aria-label={file.name}><p>可下载后查看 PDF。</p></object> :
          <p>{isImage || isPdf ? '正在打开预览…' : '此格式可下载后使用本机应用查看。'}</p>}
    </div>
    <footer><button type="button" onClick={onDownload}>下载</button><button type="button" onClick={onClose}>关闭</button></footer>
  </DocumentModal>
}

function DocumentBrowser({ scope }: { scope: DocumentScope }) {
  const bridge = documentBridge()!
  const [folder, setFolder] = useState(folders[scope])
  const [listing, setListing] = useState<DocumentListing>()
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [dialog, setDialog] = useState<EditDialog>()
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [preview, setPreview] = useState<{ file: DocumentFile; entry: DocumentEntry }>()
  const locked = useRef(false)
  const mounted = useRef(true)
  const current = listing?.folder === folder ? listing : undefined
  const busy = loading || mutating
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void bridge.list(scope, folder).then(value => { if (active) setListing(value) })
      .catch(failure => { if (active) setError(describeError(failure, '读取文档失败')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [bridge, scope, folder, revision])
  useEffect(() => {
    if (scope !== 'private') return
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener(personalDocumentsChangedEvent, refresh)
    return () => window.removeEventListener(personalDocumentsChangedEvent, refresh)
  }, [scope])

  function navigate(path: string) {
    folders[scope] = path
    setFolder(path)
  }
  async function run(action: () => Promise<DocumentListing | void>, report = setError) {
    if (locked.current) return false
    locked.current = true
    setMutating(true)
    setError('')
    try {
      const result = await action()
      if (mounted.current && result) {
        setListing(result)
        setRevision(value => value + 1)
      }
      return true
    } catch (failure) {
      if (mounted.current) report(describeError(failure, '文档操作失败'))
      return false
    } finally {
      locked.current = false
      if (mounted.current) setMutating(false)
    }
  }
  function edit(next: EditDialog) {
    setName('')
    setContent('')
    setDialogError('')
    setDialog(next)
  }
  async function confirm() {
    if (!dialog) return
    setDialogError('')
    const succeeded = await run(async () => {
      if (dialog.kind === 'folder') return bridge.createFolder(folder, name.trim())
      if (dialog.kind === 'file') return bridge.createFile!(folder, name.trim(), content)
      return bridge.deleteEntry!(dialog.entry.path)
    }, setDialogError)
    if (succeeded && mounted.current) setDialog(undefined)
  }
  async function open(entry: DocumentEntry) {
    await run(async () => {
      const file = await bridge.readFile(scope, entry.path)
      if (mounted.current) setPreview({ file, entry })
    })
  }
  const title = dialog?.kind === 'folder' ? '新建文件夹' : dialog?.kind === 'file' ? '新建文件' : '删除文档'
  return <section className="somnus-document-browser" aria-label={labels[scope]} aria-busy={busy}>
    <header>
      <div><h2>{labels[scope]}{scope === 'shared' && <small>只读</small>}</h2>
        <p>{scope === 'private' ? '管理本机文档，供会话和工具使用' : '查看共享资料'}</p></div>
      <div className="somnus-document-actions">
        <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新</button>
        {scope === 'private' && <>
          <button type="button" disabled={busy || !current} onClick={() => edit({ kind: 'folder' })}>新建文件夹</button>
          {bridge.createFile && <button type="button" disabled={busy || !current} onClick={() => edit({ kind: 'file' })}>新建文件</button>}
          <button type="button" disabled={busy || !current} onClick={() => void run(() => bridge.importFiles(folder))}>导入文件</button>
        </>}
      </div>
    </header>
    <nav className="somnus-document-path" aria-label={`${labels[scope]}路径`}>
      <button type="button" disabled={!folder || mutating} onClick={() => navigate('')}>{labels[scope]}</button>
      {folder && <><span>/ {folder.replaceAll('/', ' / ')}</span><button type="button" disabled={mutating}
        onClick={() => navigate(folder.split('/').slice(0, -1).join('/'))}>返回上级</button></>}
    </nav>
    {error && <p className="somnus-document-error" role="alert">{error}</p>}
    {loading ? <p role="status">正在读取文档…</p> : current && (current.entries.length ?
      <ul className="somnus-document-entries">{current.entries.map(entry => <li key={entry.path}>
        <button type="button" className="somnus-document-row" disabled={mutating}
          onClick={() => entry.kind === 'folder' ? navigate(entry.path) : void open(entry)}>
          <span aria-hidden="true">{entry.kind === 'folder' ? '▱' : '▤'}</span><span>{entry.name}</span>
          <span>{entry.kind === 'folder' ? '打开' : '预览'}</span>
        </button>
        {entry.kind === 'file' && <button type="button" disabled={busy} aria-label={`下载 ${entry.name}`}
          onClick={() => void run(() => bridge.openFile(scope, entry.path))}>下载</button>}
        {scope === 'private' && bridge.deleteEntry && <button type="button" disabled={busy}
          aria-label={`删除 ${entry.name}`} onClick={() => edit({ kind: 'delete', entry })}>删除</button>}
      </li>)}</ul> : <p role="status">{scope === 'shared' && current.configured === false ? '尚未配置共享文档目录' : '此目录暂无文档'}</p>)}
    {dialog && <DocumentModal title={title} busy={mutating} onClose={() => setDialog(undefined)}>
      <form onSubmit={event => { event.preventDefault(); void confirm() }}>
        {dialogError && <p className="somnus-document-error" role="alert">{dialogError}</p>}
        {dialog.kind === 'delete' ? <p>删除“{dialog.entry.name}”？{dialog.entry.kind === 'folder' ? '文件夹及其内容将被删除。' : '删除后无法恢复。'}</p> :
          <label>{dialog.kind === 'folder' ? '文件夹名称' : '文件名'}
            <input autoFocus required value={name} disabled={mutating} placeholder={dialog.kind === 'file' ? '例如 notes.md' : undefined}
              onChange={event => setName(event.target.value)} />
          </label>}
        {dialog.kind === 'file' && <><p>支持 TXT、Markdown、CSV 和 TSV。</p><label>文件内容（可选）
          <textarea rows={7} value={content} disabled={mutating} onChange={event => setContent(event.target.value)} />
        </label></>}
        <footer><button type="button" disabled={mutating} onClick={() => setDialog(undefined)}>取消</button>
          <button type="submit" disabled={mutating || (dialog.kind !== 'delete' && !name.trim())}>
            {mutating ? '正在处理…' : dialog.kind === 'delete' ? '确认删除' : '创建'}</button></footer>
      </form>
    </DocumentModal>}
    {preview && <DocumentPreview file={preview.file} onClose={() => setPreview(undefined)}
      onDownload={() => void run(() => bridge.openFile(scope, preview.entry.path))} />}
  </section>
}

export function NativeDocumentLibrary() {
  return <main className="somnus-native-documents"><h1>文档</h1>
    <DocumentBrowser scope="private" /><DocumentBrowser scope="shared" />
  </main>
}
