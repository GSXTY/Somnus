const assert = require('node:assert/strict');
const { link, mkdtemp, mkdir, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installChatSkill, installWorkspaceSkill } = require('./acp-chat-skill.cjs');

const manifest = '---\nname: ppt-master\ndescription: >\n  Slides\n---\n# Skill\n';
const entry = file => '100644 blob ' + 'a'.repeat(40) + '\t' + file + '\0';

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'somnus-chat-skill-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const market = { home: path.join(home, 'dsh-managed') };
  await mkdir(market.home);
  return { market, userHome: home, reference: 'ppt-master' };
}

test('copies a named workspace Skill out to the user profile without changing its source', async t => {
  const options = await fixture(t);
  const workspaceRoot = path.join(options.userHome, 'project');
  const source = path.join(workspaceRoot, '.dsh', 'skills', 'ppt-master');
  await mkdir(path.join(source, 'scripts'), { recursive: true });
  await writeFile(path.join(source, 'SKILL.md'), manifest);
  await writeFile(path.join(source, 'scripts', 'example.py'), 'print("copied")');
  const stages = [];
  const settings = { ...options, workspaceRoot, validateSender: () => {}, onProgress: stage => stages.push(stage) };
  const installed = await installWorkspaceSkill(settings);
  assert.equal(installed.alreadyInstalled, false);
  const target = path.join(options.market.home, 'skills', 'ppt-master');
  assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), manifest);
  assert.equal(await readFile(path.join(source, 'scripts', 'example.py'), 'utf8'), 'print("copied")');
  assert.equal(await readFile(path.join(target, 'scripts', 'example.py'), 'utf8'), 'print("copied")');
  assert.equal((await installWorkspaceSkill(settings)).alreadyInstalled, true);
  assert.deepEqual(stages, ['installing', 'verifying']);
});

test('a workspace Skill with a hard link is never written to user scope', async t => {
  const options = await fixture(t);
  const workspaceRoot = path.join(options.userHome, 'project');
  const source = path.join(workspaceRoot, '.agents', 'skills', 'ppt-master');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'SKILL.md'), manifest);
  await link(path.join(source, 'SKILL.md'), path.join(source, 'linked.md'));
  await assert.rejects(installWorkspaceSkill({ ...options, workspaceRoot, validateSender() {}, onProgress() {} }), /清单无效/);
  assert.deepEqual(await readdir(options.market.home), []);
});

test('checks the selected Skill only, installs it in managed DSH, and skips an existing install', async t => {
  const options = await fixture(t);
  const external = path.join(options.userHome, '.dsh', 'skills', 'ppt-master');
  await mkdir(external, { recursive: true });
  await writeFile(path.join(external, 'SKILL.md'), manifest);
  const calls = [];
  const git = async (_executable, folder, args, _signal, input) => {
    calls.push(args[0] === '-c' ? args[2] : args[0]);
    if (args[0] === 'clone') {
      assert.equal(args.at(-2), 'https://github.com/hugohe3/ppt-master.git');
      await mkdir(args.at(-1));
    } else if (args[0] === 'ls-tree') {
      return entry('README.md') + entry('skills/ppt-master/SKILL.md') + entry('skills/ppt-master/scripts/demo.py');
    } else if (args[2] === 'fetch') {
      assert.equal(input, 'a'.repeat(40) + '\n');
    } else {
      assert.deepEqual(args, ['checkout', 'HEAD', '--', 'skills/ppt-master']);
      const selected = path.join(folder, 'skills', 'ppt-master');
      await mkdir(path.join(selected, 'scripts'), { recursive: true });
      await writeFile(path.join(selected, 'SKILL.md'), manifest);
      await writeFile(path.join(selected, 'scripts/demo.py'), '# stays unexecuted');
    }
  };
  const install = () => installChatSkill({ ...options, git, findGit: async () => 'fixture' });
  const result = await install();
  assert.equal(result.verified, true);
  assert.equal(result.alreadyInstalled, false);
  assert.equal(await readFile(path.join(options.market.home, 'skills/ppt-master/SKILL.md'), 'utf8'), manifest);
  assert.equal((await install()).alreadyInstalled, true);
  assert.deepEqual(calls, ['clone', 'ls-tree', 'fetch', 'checkout']);
  assert.deepEqual(await readdir(options.market.home), ['skills']);
});

test('rejects foreign URLs and repository link entries before materializing content', async t => {
  const options = await fixture(t);
  await assert.rejects(installChatSkill({ ...options, reference: 'https://github.example/ppt-master' }), /GitHub/);
  const git = async (_executable, _folder, args) => {
    if (args[0] === 'ls-tree') return entry('SKILL.md') + '120000 blob ' + 'f'.repeat(40) + '\tlink\0';
    assert.equal(args[0], 'clone');
  };
  await assert.rejects(installChatSkill({ ...options, git, findGit: async () => 'fixture' }), /链接/);
  assert.deepEqual(await readdir(options.market.home), ['skills']);
});
