const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createDocumentLibrary, registerDocumentLibrary } = require('./acp-document-library.cjs');

async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'somnus-documents-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const profileDir = path.join(folder, 'profile');
  const sharedDir = path.join(folder, 'shared');
  await fs.mkdir(profileDir);
  return { folder, profileDir, sharedDir, library: createDocumentLibrary({ profileDir, sharedDir }) };
}

test('personal files are copied into nested folders and never overwritten', async t => {
  const { folder, library } = await fixture(t);
  const source = path.join(folder, '报告.txt');
  await fs.writeFile(source, 'first');
  assert.deepEqual(await library.list('private'), { folder: '', entries: [], configured: true });
  await library.createFolder('', '客户');
  await library.createFolder('客户', '资料');
  const destination = '客户/资料';
  await library.importPaths(destination, [source]);
  await fs.writeFile(source, 'second');
  const { entries } = await library.importPaths(destination, [source]);
  assert.deepEqual(entries.map(entry => entry.name).sort(), ['报告 (2).txt', '报告.txt']);
  assert.deepEqual(await library.readFile('private', destination + '/报告.txt'), {
    name: '报告.txt', size: 5, mimeType: 'text/plain', dataBase64: Buffer.from('first').toString('base64'),
  });
  assert.equal(path.basename(await library.privateFolder(destination)), '资料');
  assert.equal(await fs.readFile(source, 'utf8'), 'second');
});

test('shared root is optional and unsafe paths and links are refused', async t => {
  const { folder, sharedDir, library } = await fixture(t);
  assert.deepEqual(await library.list('shared'), { folder: '', entries: [], configured: false });
  await fs.mkdir(sharedDir);
  const outside = path.join(folder, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'outside.txt'), 'not for the library');
  await fs.symlink(outside, path.join(sharedDir, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.link(path.join(outside, 'outside.txt'), path.join(sharedDir, 'hardlink.txt'));
  await fs.writeFile(path.join(sharedDir, 'inside.txt'), 'ok');
  for (const file of ['../outside/outside.txt', 'C:/outside.txt', 'foo\\outside.txt', './inside.txt', 'inside.txt::$DATA',
    'junction/outside.txt', 'hardlink.txt']) {
    await assert.rejects(library.readFile('shared', file));
  }
  for (const folderName of ['..', 'AUX.txt', 'space ', 'colon:ads']) await assert.rejects(library.createFolder('', folderName));
  assert.deepEqual((await library.list('shared')).entries.map(entry => entry.name), ['inside.txt']);
  assert.equal((await library.readFile('shared', 'inside.txt')).size, 2);
  await assert.rejects(library.privateFolder('junction'));
});

test('imports reject oversize and unsupported selections before copying a batch', async t => {
  const { folder, library } = await fixture(t);
  const ok = path.join(folder, 'valid.txt');
  const big = path.join(folder, 'big.png');
  const bad = path.join(folder, 'shortcut.lnk');
  await fs.writeFile(ok, 'ok');
  const handle = await fs.open(big, 'w');
  await handle.truncate(5 * 1024 * 1024 + 1);
  await handle.close();
  await fs.writeFile(bad, '');
  await assert.rejects(library.importPaths('', [ok, big]), /大小限制/);
  await assert.rejects(library.importPaths('', [ok, bad]), /文件格式/);
  assert.deepEqual((await library.list('private')).entries, []);
});

test('new text documents keep their initial content and existing documents intact', async t => {
  const { library } = await fixture(t);
  await library.createFolder('', '笔记');
  const listing = await library.createFile('笔记', '说明.md', '中文内容');
  assert.deepEqual(listing.entries.map(entry => entry.name), ['说明.md']);
  await assert.rejects(library.createFile('笔记', '说明.md', '覆盖'), /同名/);
  await assert.rejects(library.createFile('笔记', '命令.ps1'), /有效的文件名/);
  await assert.rejects(library.createFile('笔记', '../escape.txt'), /有效的文件名/);
  assert.equal(Buffer.from((await library.readFile('private', '笔记/说明.md')).dataBase64, 'base64')
    .toString('utf8'), '中文内容');
  assert.equal((await library.createFile('笔记', '空白.txt')).entries.find(entry => entry.name === '空白.txt').size, 0);
});

test('native actions require the main workbench and open shared files as copies', async t => {
  const { folder, profileDir, sharedDir, library } = await fixture(t);
  await fs.mkdir(sharedDir);
  const original = path.join(sharedDir, 'shared.txt');
  await fs.writeFile(original, 'original');
  const privateRoot = await library.privateFolder('');
  await fs.writeFile(path.join(privateRoot, 'hello.c'), 'int main(void) {}');
  await fs.writeFile(path.join(privateRoot, 'danger.ps1'), 'exit 0');
  const trash = path.join(folder, 'trash');
  await fs.mkdir(trash);
  const handlers = new Map();
  const origin = 'http://127.0.0.1:8765';
  const frame = { url: origin + '/' };
  const window = new EventEmitter();
  window.webContents = { mainFrame: frame };
  const event = { sender: window.webContents, senderFrame: frame };
  let opened;
  registerDocumentLibrary({
    ipcMain: { handle: (name, action) => handlers.set(name, action), removeHandler: name => handlers.delete(name) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: {
      openPath: async file => { opened = file; return ''; },
      trashItem: async file => fs.rename(file, path.join(trash, path.basename(file))),
    },
    window, origin, token: 'fixture', profileDir, tempDir: folder, defaultSharedDir: sharedDir, sharedDir: undefined,
  });
  const open = handlers.get('somnus-documents:open-file');
  await assert.rejects(open({ ...event, senderFrame: { url: origin + '/' } }, 'shared', 'shared.txt'));
  await open(event, 'shared', 'shared.txt');
  assert.notEqual(opened, original);
  await fs.writeFile(opened, 'changed');
  assert.equal(await fs.readFile(original, 'utf8'), 'original');
  await open(event, 'private', 'hello.c');
  assert.equal(opened, path.join(privateRoot, 'hello.c'));
  await assert.rejects(open(event, 'private', 'danger.ps1'), /无法调用系统应用/);
  const create = handlers.get('somnus-documents:create-file');
  const remove = handlers.get('somnus-documents:delete-entry');
  const listing = await create(event, '', '新建.txt', '正文');
  assert(listing.entries.some(entry => entry.name === '新建.txt'));
  await assert.rejects(remove({ ...event, senderFrame: { url: origin + '/' } }, '新建.txt'));
  for (const name of ['', '../shared/shared.txt', 'shared.txt']) await assert.rejects(remove(event, name));
  const remaining = await remove(event, '新建.txt');
  assert(!remaining.entries.some(entry => entry.name === '新建.txt'));
  assert.equal(await fs.readFile(path.join(trash, '新建.txt'), 'utf8'), '正文');
  await library.createFolder('', '资料');
  await create(event, '资料', '说明.txt', '保留子项');
  await remove(event, '资料');
  assert.equal(await fs.readFile(path.join(trash, '资料', '说明.txt'), 'utf8'), '保留子项');
  const selection = await handlers.get('somnus-documents:import-files')(event, '');
  assert.deepEqual(selection.entries.map(entry => entry.name), ['danger.ps1', 'hello.c']);
  window.emit('closed');
  assert.equal(handlers.size, 0);
});
