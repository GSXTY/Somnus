export type DocumentScope = 'private' | 'shared';
export const personalDocumentsChangedEvent = 'somnus:personal-documents-changed';
export type DocumentEntry = {
  name: string; path: string; kind: 'folder' | 'file'; size?: number; modifiedAt?: string;
};
export type DocumentListing = { folder: string; entries: DocumentEntry[]; configured?: boolean };
export type DocumentFile = { name: string; size: number; mimeType: string; dataBase64: string };

type DocumentBridge = {
  list(scope: DocumentScope, folder?: string): Promise<DocumentListing>;
  createFolder(folder: string, name: string): Promise<DocumentListing>;
  createFile?(folder: string, name: string, content?: string): Promise<DocumentListing>;
  deleteEntry?(path: string): Promise<DocumentListing>;
  importFiles(folder: string): Promise<DocumentListing>;
  openFile(scope: DocumentScope, path: string): Promise<void>;
  readFile(scope: DocumentScope, path: string): Promise<DocumentFile>;
};

const api = '/api/assistant/documents';
const importAccept = '.pdf,.docx,.docm,.xlsx,.xlsm,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,.log,.json,.yaml,.yml,.csv,.tsv,.py,.js,.mjs,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.go,.rs,.sql,.sh,.bat,.ps1,.ini,.toml,.conf,.html,.htm,.xml';
const maxFile = 10 * 1024 * 1024;
const maxImport = 40 * 1024 * 1024;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const bridge = (window as unknown as {
    somnusApi?: {
      request(path: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }):
        Promise<{ status: number; body: ArrayBuffer }>;
    };
  }).somnusApi;
  if (bridge) {
    const response = await bridge.request(api + path, {
      method: init?.method, headers: { 'Content-Type': 'application/json' }, body: init?.body,
    });
    const text = new TextDecoder().decode(response.body);
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { throw new Error('文档服务返回了无效数据'); }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(body?.error?.message || body?.error || `文档操作失败（${response.status}）`);
    }
    return body as T;
  }
  const response = await fetch(api + path, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `文档操作失败（${response.status}）`);
  return body as T;
}

function encode(value: string) {
  return encodeURIComponent(value);
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function chooseFiles(): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = importAccept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    });
    document.body.append(input);
    input.click();
  });
}

const httpBridge: DocumentBridge = {
  list: (scope, folder = '') => request<DocumentListing>(`?scope=${encode(scope)}&folder=${encode(folder)}`),
  createFolder: (folder, name) => request<DocumentListing>('/folder', {
    method: 'POST', body: JSON.stringify({ folder, name }),
  }),
  createFile: (folder, name, content = '') => request<DocumentListing>('/file', {
    method: 'POST', body: JSON.stringify({ folder, name, content }),
  }),
  deleteEntry: path => request<DocumentListing>('/delete', {
    method: 'POST', body: JSON.stringify({ path }),
  }),
  async importFiles(folder) {
    const files = await chooseFiles();
    if (!files.length) return request<DocumentListing>(`?scope=private&folder=${encode(folder)}`);
    let total = 0;
    const prepared = [];
    for (const file of files) {
      if (file.size > maxFile) throw new Error(`“${file.name}”超过 10 MiB 限制。`);
      total += file.size;
      if (total > maxImport) throw new Error('每次最多导入 40 MiB 文档。');
      prepared.push({ name: file.name, dataBase64: toBase64(await file.arrayBuffer()) });
    }
    return request<DocumentListing>('/import', {
      method: 'POST', body: JSON.stringify({ folder, files: prepared }),
    });
  },
  async readFile(scope, path) {
    return request<DocumentFile>(`/read?scope=${encode(scope)}&path=${encode(path)}`);
  },
  async openFile(scope, path) {
    const file = await httpBridge.readFile(scope, path);
    const bytes = Uint8Array.from(atob(file.dataBase64), char => char.charCodeAt(0));
    const href = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 30_000);
  },
};

let fallback: DocumentBridge | undefined;

export function documentBridge(): DocumentBridge | undefined {
  const native = (window as Window & { somnusDocuments?: DocumentBridge }).somnusDocuments;
  if (native) return native;
  fallback ??= httpBridge;
  return fallback;
}

export function readDocumentFile(scope: DocumentScope, path: string) {
  const bridge = documentBridge();
  if (!bridge) throw new Error('此运行方式暂不支持文档库');
  return bridge.readFile(scope, path);
}
