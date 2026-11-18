export type DocumentScope = 'private' | 'shared';
export const personalDocumentsChangedEvent = 'somnus:personal-documents-changed';
export type DocumentEntry = {
  name: string; path: string; kind: 'folder' | 'file'; size?: number; modifiedAt?: string;
};
export type DocumentListing = { folder: string; entries: DocumentEntry[]; configured?: boolean };
type DocumentFile = { name: string; size: number; mimeType: string; dataBase64: string };

type DocumentBridge = {
  list(scope: DocumentScope, folder?: string): Promise<DocumentListing>;
  createFolder(folder: string, name: string): Promise<DocumentListing>;
  createFile?(folder: string, name: string, content?: string): Promise<DocumentListing>;
  deleteEntry?(path: string): Promise<DocumentListing>;
  importFiles(folder: string): Promise<DocumentListing>;
  openFile(scope: DocumentScope, path: string): Promise<void>;
  readFile(scope: DocumentScope, path: string): Promise<DocumentFile>;
};

export function documentBridge(): DocumentBridge | undefined {
  return (window as Window & { somnusDocuments?: DocumentBridge }).somnusDocuments;
}

export function readDocumentFile(scope: DocumentScope, path: string) {
  const bridge = documentBridge();
  if (!bridge) throw new Error('此运行方式暂不支持文档库');
  return bridge.readFile(scope, path);
}
