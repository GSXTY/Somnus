const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { hostFiles, copyHostFiles } = require('./resources.cjs');
test('the real Host tree stages nested adapters and mode modules, excludes tests, and rejects missing required resources', async t => {
  const root = path.resolve(__dirname, '..');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'somnus-host-stage-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const copied = await copyHostFiles(root, folder);
  assert(copied.includes('runtime/registry.cjs')); assert(copied.includes('acp-dsh-mode-scope.mjs'));
  assert(!copied.some(file => /\.test\./.test(file)));
  for (const file of copied) assert.equal((await fs.readFile(path.join(root, file))).compare(await fs.readFile(path.join(folder, file))), 0);
  await fs.unlink(path.join(folder, 'runtime', 'registry.cjs'));
  await assert.rejects(hostFiles(folder), /Missing required Host resource/);
});
