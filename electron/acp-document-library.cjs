const fs = require('node:fs/promises');
const path = require('node:path');
const { nativeRequest, trustWorkbench } = require('./project-folders.cjs');

const mib = 1024 * 1024;
const fileTypes = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docm': 'application/vnd.ms-word.document.macroenabled.12',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroenabled.12',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};
const textTypes = '.txt .md .markdown .log .json .yaml .yml .csv .tsv .py .js .mjs .ts .tsx .jsx .java .c .cpp .h .go .rs .sql .sh .bat .ps1 .ini .toml .conf .html .htm .xml'.split(' ');
const newFileExtensions = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv']);
const nativeExtensions = new Set([
  '.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg', '.gif', '.webp',
  ...newFileExtensions, '.log', '.json', '.yaml', '.yml', '.ts', '.tsx',
  '.jsx', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.sql', '.ini', '.toml', '.conf',
]);
const extensions = [...Object.keys(fileTypes), ...textTypes];
const maxFolderEntries = 2000;

function validName(name) {
  return typeof name === 'string' && name.length >= 1 && name.length <= 180 &&
    name.trim() === name && !name.startsWith('.') && !name.endsWith('.') &&
    !/[<>:"/\\|?*\u0000-\u001f]/.test(name) &&
    !/^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\s*\.|$)/i.test(name);
}

function pathParts(relativePath) {
  if (relativePath === '') return [];
  if (typeof relativePath !== 'string' || relativePath.length > 1024) throw new Error('无效的文档库路径。');
  const parts = relativePath.split('/');
  if (parts.length > 21 || !parts.every(validName)) throw new Error('无效的文档库路径。');
  return parts;
}

function within(base, target) {
  const relative = path.relative(base, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function fileType(name) {
  const extension = path.extname(name).toLowerCase();
  const mimeType = fileTypes[extension] ?? (textTypes.includes(extension) ? 'text/plain' : null);
  return mimeType ? { mimeType, limit: mimeType.startsWith('image/') ? 5 * mib : 10 * mib } : null;
}

function sameFile(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

async function checkedRead(file, limit, expected) {
  const handle = await fs.open(file, 'r');
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n || !sameFile(info, expected)) throw new Error('无法读取链接或非普通文档。');
    if (info.size > BigInt(limit)) throw new Error('文档超过可导入或添加的大小限制。');
    const buffer = Buffer.alloc(Number(info.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== Number(info.size)) throw new Error('文档正在变化，请重试。');
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function createDocumentLibrary({ profileDir, sharedDir }) {
  const roots = { private: path.join(profileDir, 'documents'), shared: sharedDir };

  async function locate(scope, relativePath, kind, missingShared = false) {
    if (scope !== 'private' && scope !== 'shared') throw new Error('请选择有效的文档区。');
    const parts = pathParts(relativePath);
    const root = roots[scope];
    if (scope === 'private') await fs.mkdir(root, { recursive: true });
    const rootInfo = await fs.lstat(root).catch(error => {
      if (scope === 'shared' && missingShared && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!rootInfo) return null;
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('文档区目录无法访问。');
    const canonical = await fs.realpath(root);
    let target = canonical;
    let info = await fs.lstat(target, { bigint: true });
    for (const part of parts) {
      target = path.join(target, part);
      info = await fs.lstat(target, { bigint: true });
      if (info.isSymbolicLink() || !within(canonical, await fs.realpath(target))) {
        throw new Error('文档区无法读取链接或区外路径。');
      }
    }
    if ((kind === 'folder' && !info.isDirectory()) || (kind === 'file' && (!info.isFile() || info.nlink !== 1n))) {
      throw new Error('请选择文档区中的有效文件或文件夹。');
    }
    return { target, info };
  }

  async function list(scope, folder = '') {
    const location = await locate(scope, folder, 'folder', true);
    const entries = [];
    if (!location) return { folder, entries, configured: false };
    const dir = await fs.opendir(location.target);
    let count = 0;
    for await (const item of dir) {
      if (++count > maxFolderEntries) throw new Error('文件夹中的项目太多，请分到子文件夹。');
      if (!validName(item.name) || item.isSymbolicLink()) continue;
      const relativePath = folder ? folder + '/' + item.name : item.name;
      if (item.isDirectory()) entries.push({ name: item.name, path: relativePath, kind: 'folder' });
      if (item.isFile() && fileType(item.name)) {
        const info = await fs.lstat(path.join(location.target, item.name)).catch(() => null);
        if (!info?.isFile() || info.nlink !== 1) continue;
        entries.push({ name: item.name, path: relativePath, kind: 'file', size: info.size, modifiedAt: info.mtime.toISOString() });
      }
    }
    entries.sort((first, second) => Number(second.kind === 'folder') - Number(first.kind === 'folder') ||
      first.name.localeCompare(second.name, 'zh-CN', { numeric: true }));
    return { folder, entries, configured: true };
  }

  async function createFolder(folder, name) {
    if (!validName(name)) throw new Error('请输入可用的文件夹名称。');
    const { target } = await locate('private', folder, 'folder');
    if (pathParts(folder).length >= 20 || (folder ? folder.length + 1 : 0) + name.length > 1024) {
      throw new Error('文档库的文件夹层级或路径长度已达上限。');
    }
    await fs.mkdir(path.join(target, name));
    return list('private', folder);
  }

  async function createFile(folder, name, content = '') {
    if (!validName(name) || !newFileExtensions.has(path.extname(name).toLowerCase())) {
      throw new Error('请输入有效的文件名，格式支持 TXT、Markdown、CSV 和 TSV。');
    }
    const { target } = await locate('private', folder, 'folder');
    const relativePath = folder ? folder + '/' + name : name;
    pathParts(relativePath);
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > fileType(name).limit) {
      throw new Error('请输入有效的文本内容，文件大小不得超过 10 MiB。');
    }
    const destination = path.join(target, name);
    const handle = await fs.open(destination, 'wx', 0o600).catch(error => {
      if (error.code === 'EEXIST') throw new Error('当前目录已有同名文件或文件夹。');
      throw error;
    });
    try {
      try { await handle.writeFile(content, 'utf8'); }
      finally { await handle.close(); }
    } catch (error) {
      await fs.unlink(destination).catch(() => {});
      throw error;
    }
    return list('private', folder);
  }

  async function privateEntry(entryPath) {
    if (!pathParts(entryPath).length) throw new Error('请选择要删除的文件或文件夹。');
    const { target, info } = await locate('private', entryPath);
    if (!info.isDirectory() && (!info.isFile() || info.nlink !== 1n || !fileType(path.basename(target)))) {
      throw new Error('请选择文档区中的有效文件或文件夹。');
    }
    return target;
  }

  async function importPaths(folder, paths) {
    const { target } = await locate('private', folder, 'folder');
    if (paths.length > 16) throw new Error('每次最多导入 16 个文档。');
    let total = 0;
    const selected = [];
    for (const source of paths) {
      const name = path.basename(source);
      const format = fileType(name);
      if (!validName(name) || !format || (folder ? folder.length + 1 : 0) + name.length + 7 > 1024) {
        throw new Error('选择中包含暂不支持的文件格式或路径。');
      }
      const info = await fs.lstat(source, { bigint: true });
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) {
        throw new Error('只能导入普通文件。');
      }
      total += Number(info.size);
      if (total > 40 * mib) throw new Error('每次最多导入 40 MiB 文档。');
      selected.push({ name, bytes: await checkedRead(source, format.limit, info) });
    }
    const created = [];
    try {
      for (const { name, bytes } of selected) {
        const extension = path.extname(name);
        let destination;
        let handle;
        for (let index = 1; index <= 2000; index++) {
          const suffix = index === 1 ? '' : ` (${index})`;
          const base = path.basename(name, extension).slice(0, 180 - suffix.length - extension.length);
          destination = path.join(target, base + suffix + extension);
          handle = await fs.open(destination, 'wx', 0o600).catch(error => {
            if (error.code === 'EEXIST') return null;
            throw error;
          });
          if (handle) break;
        }
        if (!handle) throw new Error('同名文档太多，请先更改文件名。');
        created.push(destination);
        try {
          await handle.writeFile(bytes);
        } finally {
          await handle.close();
        }
      }
    } catch (error) {
      await Promise.all(created.map(file => fs.unlink(file).catch(() => {})));
      throw error;
    }
    return list('private', folder);
  }

  async function readFile(scope, file) {
    const { target, info } = await locate(scope, file, 'file');
    const name = path.basename(target);
    const format = fileType(name);
    if (!format) throw new Error('暂不支持读取此文件类型。');
    const bytes = await checkedRead(target, format.limit, info);
    return { name, size: bytes.length, mimeType: format.mimeType, dataBase64: bytes.toString('base64') };
  }

  async function localFile(scope, file) {
    const { target } = await locate(scope, file, 'file');
    if (!nativeExtensions.has(path.extname(target).toLowerCase())) {
      throw new Error('此文件类型只能在文档库中作为附件读取，无法调用系统应用打开。');
    }
    return target;
  }

  async function privateFolder(folder) {
    const { target } = await locate('private', folder, 'folder');
    return target;
  }

  return { list, createFolder, createFile, importPaths, readFile, localFile, privateFolder, privateEntry };
}

function registerDocumentLibrary({ ipcMain, dialog, shell, window, origin, token, profileDir, defaultSharedDir,
  tempDir, sharedDir = process.env.SOMNUS_SHARED_DOCUMENTS_DIR }) {
  const configuredShared = sharedDir && path.isAbsolute(sharedDir) &&
    (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(sharedDir)) ? path.resolve(sharedDir) : defaultSharedDir;
  const library = createDocumentLibrary({ profileDir, sharedDir: configuredShared });
  const previews = new Set();
  const actions = {
    'somnus-documents:list': (_event, scope, folder) => library.list(scope, folder),
    'somnus-documents:create-folder': (_event, folder, name) => library.createFolder(folder, name),
    'somnus-documents:create-file': (_event, folder, name, content) => library.createFile(folder, name, content),
    'somnus-documents:delete-entry': async (event, entryPath) => {
      const target = await library.privateEntry(entryPath);
      trustWorkbench(event, window, origin);
      try { await shell.trashItem(target); }
      catch { throw new Error('无法将所选项目移到回收站。'); }
      return library.list('private', pathParts(entryPath).slice(0, -1).join('/'));
    },
    'somnus-documents:import-files': async (event, folder) => {
      await library.privateFolder(folder);
      const selected = await dialog.showOpenDialog(window, {
        title: '导入个人文档', properties: ['openFile', 'multiSelections'],
        filters: [{ name: '文档、文本与图片', extensions: extensions.map(extension => extension.slice(1)) }],
      });
      if (selected.canceled || !selected.filePaths.length) return library.list('private', folder);
      trustWorkbench(event, window, origin);
      return library.importPaths(folder, selected.filePaths);
    },
    'somnus-documents:read-file': (_event, scope, file) => library.readFile(scope, file),
    'somnus-documents:open-file': async (event, scope, file) => {
      let target = await library.localFile(scope, file);
      if (scope === 'shared') {
        const document = await library.readFile(scope, file);
        const folder = await fs.mkdtemp(path.join(tempDir, 'somnus-document-preview-'));
        target = path.join(folder, document.name);
        previews.add(target);
        await fs.writeFile(target, Buffer.from(document.dataBase64, 'base64'), { flag: 'wx', mode: 0o600 });
      }
      trustWorkbench(event, window, origin);
      if (await shell.openPath(target)) throw new Error('无法打开文档。');
    },
    'vvman-projects:choose-document-folder': async (event, folder) => {
      const target = await library.privateFolder(folder);
      trustWorkbench(event, window, origin);
      const grant = await nativeRequest(origin, token, '/project-folder-grants', { path: target });
      if (typeof grant?.root_path !== 'string' || typeof grant.folder_grant !== 'string') {
        throw new Error('未能绑定选中的个人文档文件夹。');
      }
      return { root_path: grant.root_path, folder_grant: grant.folder_grant };
    },
  };
  for (const [channel, action] of Object.entries(actions)) {
    ipcMain.handle(channel, async (event, ...args) => {
      trustWorkbench(event, window, origin);
      try {
        return await action(event, ...args);
      } catch (error) {
        if (error.code) throw new Error('文档操作未完成，请检查文件是否仍可访问。');
        throw error;
      }
    });
  }
  window.once('closed', () => {
    Object.keys(actions).forEach(channel => ipcMain.removeHandler(channel));
    for (const preview of previews) {
      void fs.unlink(preview).catch(() => {}).then(() => fs.rmdir(path.dirname(preview))).catch(() => {});
    }
  });
}

module.exports = { createDocumentLibrary, registerDocumentLibrary };
