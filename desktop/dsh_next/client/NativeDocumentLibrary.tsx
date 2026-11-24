import { Fragment, useEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { documentBridge, personalDocumentsChangedEvent } from '../../../page_design/frontend/src/documents/documentLibraryBridge'
import type { DocumentEntry, DocumentFile, DocumentListing, DocumentScope } from '../../../page_design/frontend/src/documents/documentLibraryBridge'
import { describeError } from '../../../page_design/frontend/src/shared/errors.mjs'
import './native-documents.css'

const labels: Record<DocumentScope, string> = { private: '个人文档', shared: '共享文档' }
const emptyPaths: Record<DocumentScope, string> = { private: '', shared: '' }
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

type EditDialog = { kind: 'folder' } | { kind: 'file' } | { kind: 'delete'; entry: DocumentEntry }
type ViewMode = 'list' | 'grid'
type SortMode = 'name' | 'modified' | 'size'

type FileType = { label: string; abbr: string; tone: string }
const fileTypes: Record<string, FileType> = {
  md: { label: 'Markdown', abbr: 'MD', tone: 'md' },
  markdown: { label: 'Markdown', abbr: 'MD', tone: 'md' },
  csv: { label: 'CSV', abbr: 'CSV', tone: 'csv' },
  tsv: { label: 'TSV', abbr: 'TSV', tone: 'csv' },
  txt: { label: '纯文本', abbr: 'TXT', tone: 'txt' },
  log: { label: '纯文本', abbr: 'TXT', tone: 'txt' },
  json: { label: 'JSON', abbr: 'JSON', tone: 'code' },
  pdf: { label: 'PDF', abbr: 'PDF', tone: 'pdf' },
  doc: { label: 'Word', abbr: 'DOC', tone: 'doc' },
  docx: { label: 'Word', abbr: 'DOC', tone: 'doc' },
  docm: { label: 'Word', abbr: 'DOC', tone: 'doc' },
  xls: { label: 'Excel', abbr: 'XLS', tone: 'xls' },
  xlsx: { label: 'Excel', abbr: 'XLS', tone: 'xls' },
  xlsm: { label: 'Excel', abbr: 'XLS', tone: 'xls' },
  png: { label: '图片', abbr: 'IMG', tone: 'img' },
  jpg: { label: '图片', abbr: 'IMG', tone: 'img' },
  jpeg: { label: '图片', abbr: 'IMG', tone: 'img' },
  gif: { label: '图片', abbr: 'IMG', tone: 'img' },
  webp: { label: '图片', abbr: 'IMG', tone: 'img' },
  py: { label: '代码', abbr: 'PY', tone: 'code' },
  js: { label: '代码', abbr: 'JS', tone: 'code' },
  mjs: { label: '代码', abbr: 'JS', tone: 'code' },
  ts: { label: '代码', abbr: 'TS', tone: 'code' },
  tsx: { label: '代码', abbr: 'TS', tone: 'code' },
  jsx: { label: '代码', abbr: 'JS', tone: 'code' },
  java: { label: '代码', abbr: 'JAVA', tone: 'code' },
  c: { label: '代码', abbr: 'C', tone: 'code' },
  cpp: { label: '代码', abbr: 'C++', tone: 'code' },
  h: { label: '代码', abbr: 'H', tone: 'code' },
  go: { label: '代码', abbr: 'GO', tone: 'code' },
  rs: { label: '代码', abbr: 'RS', tone: 'code' },
  sql: { label: 'SQL', abbr: 'SQL', tone: 'code' },
  sh: { label: '脚本', abbr: 'SH', tone: 'code' },
  bat: { label: '脚本', abbr: 'BAT', tone: 'code' },
  ps1: { label: '脚本', abbr: 'PS1', tone: 'code' },
  yaml: { label: '配置', abbr: 'YML', tone: 'code' },
  yml: { label: '配置', abbr: 'YML', tone: 'code' },
  toml: { label: '配置', abbr: 'TOML', tone: 'code' },
  ini: { label: '配置', abbr: 'INI', tone: 'code' },
  conf: { label: '配置', abbr: 'CFG', tone: 'code' },
  html: { label: '网页', abbr: 'HTML', tone: 'code' },
  htm: { label: '网页', abbr: 'HTML', tone: 'code' },
  xml: { label: 'XML', abbr: 'XML', tone: 'code' },
}

function typeOf(entry: DocumentEntry): FileType {
  if (entry.kind === 'folder') return { label: '文件夹', abbr: 'DIR', tone: 'folder' }
  const extension = entry.name.includes('.') ? entry.name.split('.').pop()!.toLowerCase() : ''
  return fileTypes[extension] ?? {
    label: extension ? extension.toUpperCase() : '文件',
    abbr: extension ? extension.toUpperCase().slice(0, 4) : 'FILE',
    tone: 'other',
  }
}

function formatSize(size?: number) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatModified(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function sortEntries(entries: DocumentEntry[], sort: SortMode) {
  const metric = (entry: DocumentEntry) => sort === 'modified'
    ? (entry.modifiedAt ? Date.parse(entry.modifiedAt) : Number.NaN)
    : sort === 'size' ? entry.size : undefined
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
    const a = metric(left), b = metric(right)
    if (typeof a === 'number' || typeof b === 'number') {
      const knownA = typeof a === 'number' && Number.isFinite(a), knownB = typeof b === 'number' && Number.isFinite(b)
      if (knownA && knownB && a !== b) return b - a
      if (knownA !== knownB) return knownA ? -1 : 1
    }
    return collator.compare(left.name, right.name)
  })
}

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

function FolderIcon({ depth = 0 }: { depth?: number }) {
  return <svg className="somnus-doc-folder-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M3.5 6.5h6l1.8 2.2h9.2v9.8h-17z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    {depth > 0 && <path d="M7 15h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
  </svg>
}

export function NativeDocumentLibrary() {
  const bridge = documentBridge()!
  const [scope, setScope] = useState<DocumentScope>('private')
  const [paths, setPaths] = useState<Record<DocumentScope, string>>(emptyPaths)
  const [listing, setListing] = useState<DocumentListing>()
  const [listingScope, setListingScope] = useState<DocumentScope>('private')
  const [listings, setListings] = useState<Record<string, DocumentListing>>({})
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [dialog, setDialog] = useState<EditDialog>()
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [preview, setPreview] = useState<{ file: DocumentFile; entry: DocumentEntry }>()
  const [view, setView] = useState<ViewMode>('list')
  const [sort, setSort] = useState<SortMode>('modified')
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  const folder = paths[scope]
  const current = listingScope === scope && listing?.folder === folder ? listing : undefined
  const busy = loading || mutating
  const cacheKey = (nextScope: DocumentScope, nextFolder: string) => `${nextScope}:${nextFolder}`

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void bridge.list(scope, folder).then(value => {
      if (!active) return
      setListing(value)
      setListingScope(scope)
      setListings(cache => ({ ...cache, [cacheKey(scope, value.folder)]: value }))
    })
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
    if (path === folder) return
    setLoading(true)
    setListing(undefined)
    setPaths(previous => ({ ...previous, [scope]: path }))
  }
  function switchScope(next: DocumentScope) {
    if (next === scope) return
    setLoading(true)
    setListing(undefined)
    setScope(next)
    setSearch('')
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
        setListingScope(scope)
        setListings(cache => ({ ...cache, [cacheKey(scope, result.folder)]: result }))
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
  async function dropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (scope !== 'private' || busy) return
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    await run(() => bridge.importFiles(folder, files))
  }

  const title = dialog?.kind === 'folder' ? '新建文件夹' : dialog?.kind === 'file' ? '新建文件' : '删除文档'
  const rootListing = listings[cacheKey(scope, '')]
  const rootCount = rootListing?.configured === false ? undefined : rootListing?.entries.length
  const filtered = sortEntries(
    (current?.entries ?? []).filter(entry => !search.trim() || entry.name.toLowerCase().includes(search.trim().toLowerCase())),
    sort)

  const folders: { entry: DocumentEntry; depth: number }[] = []
  function collect(parent: string, depth: number) {
    const value = listings[cacheKey(scope, parent)]
    if (!value) return
    for (const entry of value.entries) {
      if (entry.kind !== 'folder') continue
      folders.push({ entry, depth })
      collect(entry.path, depth + 1)
    }
  }
  collect('', 0)

  const emptyState = (() => {
    if (loading) return <p className="somnus-doc-status" role="status">正在读取文档…</p>
    if (!current) return <div className="somnus-doc-empty">
      <h3>暂时无法显示文档</h3><p>请确认文档服务可用，然后点击「刷新」重试。</p>
    </div>
    if (scope === 'shared' && current.configured === false) return <div className="somnus-doc-empty">
      <h3>尚未配置共享文档</h3>
      <p>共享文档需在配置中心授权共享目录后可见；未授权前不展示任何示例文件。</p>
    </div>
    if (search.trim() && !filtered.length) return <div className="somnus-doc-empty">
      <h3>没有匹配的文档</h3><p>当前文件夹中没有名称包含“{search.trim()}”的文件。</p>
    </div>
    if (current && !current.entries.length) return <div className="somnus-doc-empty">
      <h3>{folder ? '此文件夹暂无文档' : '暂无文档'}</h3>
      {scope === 'private' && <p>把文件拖到下方导入区，或使用「新建文件」创建。</p>}
    </div>
    return null
  })()

  const rowActions = (entry: DocumentEntry) => <div className="somnus-doc-row-actions">
    {entry.kind === 'folder'
      ? <button type="button" disabled={mutating} onClick={() => navigate(entry.path)}>打开</button>
      : <button type="button" disabled={mutating} onClick={() => void open(entry)}>预览</button>}
    {entry.kind === 'file' && <button type="button" disabled={busy}
      onClick={() => void run(() => bridge.openFile(scope, entry.path))}>下载</button>}
    {scope === 'private' && bridge.deleteEntry && <button type="button" className="danger" disabled={busy}
      onClick={() => edit({ kind: 'delete', entry })}>删除</button>}
  </div>

  return <main className="somnus-native-documents">
    <header className="somnus-doc-header">
      <div>
        <h1>文档</h1>
        <p>本机个人文档与团队共享资料 · 供会话与工具引用</p>
      </div>
      <div className="somnus-doc-header-actions">
        <label className="somnus-doc-search">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder="搜索文档名…" aria-label="搜索文档名" />
        </label>
        {scope === 'private' && <>
          <button type="button" className="somnus-doc-button" disabled={busy || !current}
            onClick={() => void run(() => bridge.importFiles(folder))}>导入文件</button>
          {bridge.createFile && <button type="button" className="somnus-doc-button primary" disabled={busy || !current}
            onClick={() => edit({ kind: 'file' })}>新建文件</button>}
        </>}
      </div>
    </header>

    <div className="somnus-doc-split">
      <aside className="somnus-doc-rail" aria-label="文档范围与文件夹">
        <div className="somnus-doc-scopes" role="tablist" aria-label="文档范围">
          {(['private', 'shared'] as const).map(value => <button type="button" key={value} role="tab"
            aria-selected={scope === value} onClick={() => switchScope(value)}>
            <span className="somnus-doc-scope-icon" aria-hidden="true">{value === 'private' ? '私' : '共'}</span>
            <span>{labels[value]}</span>
            <small>{value === 'shared' ? '只读' : rootCount === undefined ? '' : rootCount}</small>
          </button>)}
        </div>
        <div className="somnus-doc-rail-title">文件夹</div>
        <nav className="somnus-doc-tree" aria-label="文件夹树">
          <button type="button" aria-current={folder === '' ? 'true' : undefined} disabled={mutating}
            onClick={() => navigate('')}>
            <FolderIcon />
            <span>全部文件</span>
            {rootCount !== undefined && <small>{rootCount}</small>}
          </button>
          {folders.map(item => <button type="button" key={item.entry.path} disabled={mutating}
            className={item.depth ? 'is-sub' : undefined}
            aria-current={folder === item.entry.path ? 'true' : undefined}
            onClick={() => navigate(item.entry.path)}>
            <FolderIcon depth={item.depth} />
            <span>{item.entry.name}</span>
            <small>{listings[cacheKey(scope, item.entry.path)]?.entries.length}</small>
          </button>)}
        </nav>
        <p className="somnus-doc-rail-note">
          支持 TXT / Markdown / CSV / TSV / PDF / 图片 / Office 等格式，单文件不超过 10 MiB。<br />
          共享目录需在配置中心授权后可见。
        </p>
      </aside>

      <section className="somnus-doc-panel" aria-busy={busy} aria-label={labels[scope]}>
        <div className="somnus-doc-panel-head">
          <div className="somnus-doc-crumbs">
            <b>{labels[scope]}</b>
            {scope === 'shared' && <span className="somnus-doc-readonly">只读</span>}
            {folder.split('/').filter(Boolean).map((part, index, parts) => <Fragment key={part + index}>
              <span className="somnus-doc-sep" aria-hidden="true">/</span>
              <button type="button" disabled={mutating}
                onClick={() => navigate(parts.slice(0, index + 1).join('/'))}>{part}</button>
            </Fragment>)}
            {folder && <button type="button" className="somnus-doc-up" disabled={mutating}
              onClick={() => navigate(folder.split('/').slice(0, -1).join('/'))}>返回上级</button>}
          </div>
          <div className="somnus-doc-panel-tools">
            <button type="button" className="somnus-doc-ghost" disabled={busy}
              onClick={() => setRevision(value => value + 1)}>刷新</button>
            {scope === 'private' && <button type="button" className="somnus-doc-ghost" disabled={busy || !current}
              onClick={() => edit({ kind: 'folder' })}>新建文件夹</button>}
            <div className="somnus-doc-seg" role="group" aria-label="显示方式">
              {(['list', 'grid'] as const).map(mode => <button type="button" key={mode}
                aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'list' ? '列表' : '网格'}</button>)}
            </div>
            <select className="somnus-doc-sort" aria-label="排序方式" value={sort}
              onChange={event => setSort(event.target.value as SortMode)}>
              <option value="name">按名称</option>
              <option value="modified">按修改时间</option>
              <option value="size">按大小</option>
            </select>
          </div>
        </div>

        {error && <p className="somnus-document-error somnus-doc-error" role="alert">
          {error} <button type="button" onClick={() => setRevision(value => value + 1)}>重试</button>
        </p>}

        {emptyState ?? (view === 'list'
          ? <div className="somnus-doc-table-wrap">
            <table className="somnus-doc-table">
              <thead><tr>
                <th scope="col">名称</th><th scope="col">类型</th><th scope="col">修改时间</th>
                <th scope="col">大小</th><th scope="col" className="somnus-doc-actions-col">操作</th>
              </tr></thead>
              <tbody>{filtered.map(entry => {
                const type = typeOf(entry)
                return <tr key={entry.path}>
                  <td>
                    <button type="button" className="somnus-doc-name" disabled={mutating}
                      onClick={() => entry.kind === 'folder' ? navigate(entry.path) : void open(entry)}>
                      <span className="somnus-doc-type" data-type={type.tone} aria-hidden="true">{type.abbr}</span>
                      <span className="somnus-doc-name-text">
                        <b>{entry.name}</b>
                        <small>{folder || labels[scope]}</small>
                      </span>
                    </button>
                  </td>
                  <td><span className="somnus-doc-tag">{type.label}</span></td>
                  <td className="somnus-doc-meta">{formatModified(entry.modifiedAt)}</td>
                  <td className="somnus-doc-meta">{formatSize(entry.size)}</td>
                  <td>{rowActions(entry)}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
          : <div className="somnus-doc-grid">{filtered.map(entry => {
            const type = typeOf(entry)
            return <article className="somnus-doc-card" key={entry.path}>
              <button type="button" className="somnus-doc-card-main" disabled={mutating}
                onClick={() => entry.kind === 'folder' ? navigate(entry.path) : void open(entry)}>
                <span className="somnus-doc-type" data-type={type.tone} aria-hidden="true">{type.abbr}</span>
                <b>{entry.name}</b>
                <small>{type.label} · {formatSize(entry.size)} · {formatModified(entry.modifiedAt)}</small>
              </button>
              {rowActions(entry)}
            </article>
          })}</div>)}

        {scope === 'private'
          ? <div className="somnus-doc-drop" data-dragging={dragging}
            onDragEnter={event => { event.preventDefault(); if (!busy) setDragging(true) }}
            onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => void dropFiles(event)}>
            <span className="somnus-doc-drop-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V5M8 9l4-4 4 4" /><path d="M5 15v3.5h14V15" />
              </svg>
            </span>
            <div><b>把文件拖到这里即可导入</b><span>导入后保存到当前文件夹，原始文件内容不被改写</span></div>
            <button type="button" className="somnus-doc-button" disabled={busy}
              onClick={() => void run(() => bridge.importFiles(folder))}>选择文件</button>
          </div>
          : <p className="somnus-doc-shared-note">共享文档为只读，无法导入、新建或删除文件。</p>}
      </section>
    </div>

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
  </main>
}
