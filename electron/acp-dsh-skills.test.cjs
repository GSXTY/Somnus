const assert = require('node:assert/strict');
const { mkdir, mkdtemp, rm, symlink, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { listDshSkills } = require('./acp-dsh-skills.cjs');

test('lists linked and flat Somnus skills without reading external profile folders', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'somnus-dsh-skill-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const managed = path.join(root, 'managed');
  const user = path.join(root, 'user');
  const userSkills = path.join(user, '.dsh', 'skills');
  const target = path.join(root, 'workspace');
  await mkdir(target);
  await mkdir(userSkills, { recursive: true });
  await mkdir(path.join(managed, 'skills'), { recursive: true });
  await mkdir(path.join(user, '.agents', 'skills', 'directory-with-no-skill'), { recursive: true });
  await writeFile(path.join(target, 'SKILL.md'), 'private skill instruction');
  await writeFile(path.join(userSkills, 'external-only.md'), 'external native skill');
  await writeFile(path.join(user, '.agents', 'skills', 'external-agent-only.md'), 'external agent skill');
  const linked = await symlink(target, path.join(managed, 'skills', 'linked-example'), process.platform === 'win32' ? 'junction' : 'dir')
    .then(() => true, error => {
      if (error.code !== 'EPERM') throw error;
      t.diagnostic('Directory links are unavailable in this environment.');
      return false;
    });
  await writeFile(path.join(userSkills, 'example.md'), 'lower priority');
  await writeFile(path.join(managed, 'skills', 'example.md'), 'managed instructions');
  const items = await listDshSkills(managed, user);
  assert.deepEqual(items, [{ name: 'example', source: 'managed' },
    ...(linked ? [{ name: 'linked-example', source: 'managed' }] : [])]);
});
