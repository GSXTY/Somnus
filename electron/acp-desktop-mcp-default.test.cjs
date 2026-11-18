const assert = require('node:assert/strict');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const { defaultDesktopConnection, initializeDesktopMcpDefault } = require('./acp-desktop-mcp-default.cjs');

test('known wrapper moves within its profile preserving bytes and does not overwrite a default directory', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'somnus-desktop-mcp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'documents/test1/agent-desktop-mcp');
  const yamlRoot = path.join(root, 'dsh-runtime/0.2.2-rc.1/node_modules/yaml');
  await mkdir(source, { recursive: true });
  await mkdir(yamlRoot, { recursive: true });
  await writeFile(path.join(yamlRoot, 'index.js'), 'exports.parse=JSON.parse;');
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: '@local/agent-desktop-mcp', private: true,
    dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  const patch = JSON.stringify([{ insert: [{ name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'agent-desktop' } }] }]);
  await writeFile(path.join(source, 'cordis.patch.yml'), patch);
  await writeFile(path.join(source, 'icon.svg'), 'fixture icon');
  const result = await initializeDesktopMcpDefault(root, root);
  assert.equal(result.migrated, true);
  assert.equal(await readFile(path.join(result.directory, 'cordis.patch.yml'), 'utf8'), patch);
  assert.equal(await readFile(path.join(result.directory, 'icon.svg'), 'utf8'), 'fixture icon');
  await mkdir(source, { recursive: true });
  for (const file of ['package.json', 'cordis.patch.yml']) await writeFile(path.join(source, file), await readFile(path.join(result.directory, file)));
  const conflict = await initializeDesktopMcpDefault(root, root);
  assert.equal(conflict.migrated, false);
  assert.match(conflict.message, /已存在/);
  assert.equal(await readFile(path.join(source, 'cordis.patch.yml'), 'utf8'), patch);
  await writeFile(path.join(source, 'cordis.patch.yml'), 'malformed');
  await assert.rejects(initializeDesktopMcpDefault(root, root));
});

test('default classification requires the verified command and exact MCP args', () => {
  const file = path.resolve('desktop.exe');
  const config = { serverName: 'agent-desktop', transport: 'stdio', command: file, args: ['mcp'] };
  assert.equal(defaultDesktopConnection(config, file), true);
  assert.equal(defaultDesktopConnection({ ...config, command: 'foreign.exe' }, file), false);
  assert.equal(defaultDesktopConnection({ ...config, args: [] }, file), false);
});
