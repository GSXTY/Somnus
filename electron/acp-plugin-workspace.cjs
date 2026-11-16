const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { nativeRequest, trustWorkbench } = require('./project-folders.cjs');

const maxManifest = 32 * 1024;
const maxReview = 128 * 1024;
const workspaceConfig = 'somnus-plugin-workspace.json';

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function validDirectory(value) {
  return typeof value === 'string' && path.isAbsolute(value) &&
    (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(value));
}

async function readBounded(file, size, expected) {
  const handle = await fs.open(file, 'r');
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n || info.size > BigInt(size) ||
        (expected && (info.dev !== expected.dev || info.ino !== expected.ino))) {
      throw new Error('请选择工作区内的普通插件清单。');
    }
    const data = Buffer.alloc(Number(info.size) + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== Number(info.size)) throw new Error('文件正在变化，请重试。');
    return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

async function directoryAt(input) {
  if (!validDirectory(input)) throw new Error('插件工作区需要本机绝对路径。');
  const directory = path.resolve(input);
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(directory, await fs.realpath(directory))) {
    throw new Error('插件工作区无法访问链接或重定向目录。');
  }
  return directory;
}

async function discoverWorkspace(profileDir, env) {
  let configured = env.SOMNUS_PLUGIN_WORKSPACE_DIR;
  if (!configured) {
    const filename = path.join(profileDir, workspaceConfig);
    try {
      const info = await fs.lstat(filename, { bigint: true });
      if (info.isSymbolicLink()) throw new Error('插件工作区配置无法使用链接。');
      configured = JSON.parse(await readBounded(filename, 4096, info))?.directory;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('无法读取插件工作区配置。');
    }
  }
  if (!configured) return null;
  const root = await directoryAt(configured);
  const personal = await directoryAt(path.join(root, 'personal'));
  const defaults = await directoryAt(path.join(root, 'default'));
  return { personal, defaults };
}

async function selectedManifest(personal, selected) {
  if (!validDirectory(selected) || path.extname(selected).toLowerCase() !== '.json') {
    throw new Error('请选择 personal 工作区内的 JSON 插件清单。');
  }
  const relative = path.relative(personal, selected);
  const parts = relative.split(path.sep);
  if (!relative || path.isAbsolute(relative) || parts.some(part => part === '..' || part.startsWith('.') || /[:\x00-\x1f]/.test(part))) {
    throw new Error('请选择 personal 工作区内的 JSON 插件清单。');
  }
  let target = personal;
  for (const piece of parts.slice(0, -1)) target = await directoryAt(path.join(target, piece));
  target = path.join(target, parts.at(-1));
  const info = await fs.lstat(target, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n ||
      !samePath(await fs.realpath(target), target)) throw new Error('插件清单无法使用链接。');
  let manifest;
  try {
    manifest = JSON.parse(await readBounded(target, maxManifest, info));
  } catch {
    throw new Error('无法读取 JSON 插件清单，请检查格式和大小。');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('插件清单必须是 JSON 对象。');
  return { name: path.basename(target), manifest };
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function snapshot(candidate, id) {
  if (candidate?.id !== id || !candidate.manifest || candidate.report?.ok !== true ||
      typeof candidate.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
    throw new Error('本机服务未确认该已审核候选。');
  }
  const manifest = canonical(candidate.manifest);
  const review = JSON.stringify({
    id, sha256: candidate.sha256, created_at: candidate.created_at, report: candidate.report,
  }, null, 2) + '\n';
  if (Buffer.byteLength(manifest) > maxManifest || Buffer.byteLength(review) > maxReview ||
      createHash('sha256').update(manifest).digest('hex') !== candidate.sha256) {
    throw new Error('插件候选内容与审核快照不一致。');
  }
  return { manifest, review };
}

async function exportCandidate(directory, id, contents) {
  const target = path.join(await directoryAt(directory), id);
  await fs.mkdir(target).catch(error => {
    if (error.code === 'EEXIST') throw new Error('这个候选已保存到 default 工作区。');
    throw error;
  });
  const manifestFile = path.join(target, 'plugin.json');
  const reviewFile = path.join(target, 'review.json');
  try {
    await fs.writeFile(manifestFile, contents.manifest, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(reviewFile, contents.review, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await Promise.all([manifestFile, reviewFile].map(file => fs.unlink(file).catch(() => {})));
    await fs.rmdir(target).catch(() => {});
    throw error;
  }
  return { path: target };
}

function registerPluginWorkspace({ ipcMain, dialog, shell, window, origin, token, profileDir, env = process.env,
  request = nativeRequest }) {
  const owner = async () => (await request(origin, token, '/plugins/defaults'))?.owner_configured === true;
  const requireOwner = async () => {
    if (!await owner()) throw new Error('只有本机插件所有者可以保存发行候选。');
  };
  const requireWorkspace = async () => {
    const workspace = await discoverWorkspace(profileDir, env);
    if (!workspace) throw new Error('尚未设置插件工作区。');
    return workspace;
  };
  const actions = {
    status: async () => {
      const [workspace, isOwner] = await Promise.all([discoverWorkspace(profileDir, env), owner()]);
      return { configured: Boolean(workspace), owner: isOwner,
        ...(workspace ? { personalPath: workspace.personal, ...(isOwner ? { defaultPath: workspace.defaults } : {}) } : {}) };
    },
    'open-folder': async (event, scope) => {
      if (scope !== 'personal' && scope !== 'default') throw new Error('请选择工作区目录。');
      if (scope === 'default') await requireOwner();
      const workspace = await requireWorkspace();
      trustWorkbench(event, window, origin);
      if (await shell.openPath(scope === 'personal' ? workspace.personal : workspace.defaults)) {
        throw new Error('无法打开插件工作区。');
      }
    },
    'choose-personal-manifest': async event => {
      const { personal } = await requireWorkspace();
      const selection = await dialog.showOpenDialog(window, {
        title: '选择 personal 中的插件清单',
        defaultPath: personal, properties: ['openFile'],
        filters: [{ name: '插件清单', extensions: ['json'] }],
      });
      if (selection.canceled || !selection.filePaths.length) return null;
      trustWorkbench(event, window, origin);
      await directoryAt(personal);
      return selectedManifest(personal, selection.filePaths[0]);
    },
    'save-candidate': async (event, id) => {
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('请选择已提交审核的插件候选。');
      await requireOwner();
      const workspace = await requireWorkspace();
      const endpoint = '/plugins/development/candidates/' + id;
      const { candidate } = await request(origin, token, endpoint);
      const contents = snapshot(candidate, id);
      trustWorkbench(event, window, origin);
      const answer = await dialog.showMessageBox(window, {
        type: 'question', title: '保存插件发行候选',
        message: '将审核快照保存到本机 default 工作区？',
        detail: workspace.defaults + '\n此操作只复制清单和审核记录。',
        buttons: ['保存候选', '取消'], defaultId: 1, cancelId: 1,
      });
      if (answer.response !== 0) return null;
      trustWorkbench(event, window, origin);
      await requireOwner();
      const latest = await request(origin, token, endpoint);
      const confirmed = snapshot(latest.candidate, id);
      if (confirmed.manifest !== contents.manifest || confirmed.review !== contents.review) {
        throw new Error('审核快照已变更，请重新查看候选。');
      }
      trustWorkbench(event, window, origin);
      return exportCandidate(workspace.defaults, id, contents);
    },
  };
  for (const [name, handler] of Object.entries(actions)) {
    ipcMain.handle('somnus-plugin-workspace:' + name, async (event, ...args) => {
      trustWorkbench(event, window, origin);
      try {
        return await handler(event, ...args);
      } catch (error) {
        if (error.code) throw new Error('插件工作区操作失败，请检查目录和文件权限。');
        throw error;
      }
    });
  }
  window.once('closed', () => Object.keys(actions).forEach(name => ipcMain.removeHandler('somnus-plugin-workspace:' + name)));
}

module.exports = { registerPluginWorkspace };
