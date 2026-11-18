const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { test } = require('node:test');
const { archiveManifest, assertProtectedMcpUnchanged, buildSourceArchive, parsePackageSource,
  resolvePackageSource, sourceNeedsBuild } = require('./acp-dsh-package-source.cjs');
const { DshPluginMarket } = require('./acp-dsh-market.cjs');

const run = promisify(execFile);
const commit = 'a'.repeat(40);
const runtime = process.env.SOMNUS_TEST_DSH_RUNTIME;
const installer = process.env.SOMNUS_TEST_DSH_PNPM;
const metadata = { name: 'somnus-test-dsh-bundle', version: '1.0.0', main: 'dist/index.js',
  scripts: { build: 'node build.cjs' }, files: ['dist', 'cordis.patch.yml'], dsh: { bundle: { patch: './cordis.patch.yml' } } };

test('source parser supports exact npm, provider-style shorthand, pinned GitHub and HTTPS release assets', () => {
  assert.deepEqual(parsePackageSource(' @open-design/dsh-runtime@0.1.0 '), { kind: 'npm', id: '@open-design/dsh-runtime', revision: '0.1.0' });
  assert.deepEqual(parsePackageSource('fixture-plugin'), { kind: 'npm', id: 'fixture-plugin', revision: 'latest' });
  const marked = { kind: 'git', owner: 'nexu-io', repo: 'open-design', ref: 'HEAD', directory: 'packages/dsh-runtime' };
  assert.deepEqual(parsePackageSource('github:nexu-io/open-design#path:packages/dsh-runtime'), marked);
  assert.deepEqual(parsePackageSource('https://github.com/nexu-io/open-design/tree/main/packages/dsh-runtime'), { ...marked, ref: 'main' });
  assert.deepEqual(parsePackageSource(`git+https://github.com/nexu-io/open-design.git#${commit}&path:/packages/dsh-runtime`), { ...marked, ref: commit });
  assert.equal(parsePackageSource('https://github.com/owner/repo/releases/download/v1.0/pack.tgz').kind, 'release');
  for (const value of ['--ignore-scripts', 'https://not-github.invalid/owner/repo', 'file:C:/plugin', 'owner/repo#path:../private',
    'https://name:password@github.com/org/name', '@deepseek-ai/dsh-base', '@open-design/dsh-runtime@latest']) {
    assert.throws(() => parsePackageSource(value));
  }
});

test('GitHub preview requests only metadata at the fixed commit and identifies an explicit build', async () => {
  const target = await resolvePackageSource('github:nexu-io/open-design#path:packages/dsh-runtime', {
    fetch: async () => {},
    fetchJson: async (_fetch, url) => {
      if (url === 'https://api.github.com/repos/nexu-io/open-design/commits/HEAD') return { sha: commit };
      assert.equal(url, `https://raw.githubusercontent.com/nexu-io/open-design/${commit}/packages/dsh-runtime/package.json`);
      return metadata;
    },
    tools: async () => ({ marketInstallTarget: (_name, { source }) => {
      assert.equal(source.path, 'packages/dsh-runtime');
      assert.equal(source.commit, commit);
      return { spec: `git+${source.url}.git#${source.commit}&path:/${source.path}` };
    } }),
  });
  assert.equal(target.spec, `git+https://github.com/nexu-io/open-design.git#${commit}&path:/packages/dsh-runtime`);
  assert.equal(await sourceNeedsBuild(target, async (url, options) => {
    assert.equal(url, `${target.raw}/dist/index.js`);
    assert.equal(options.method, 'HEAD');
    return new Response(null, { status: 404 });
  }), true);
  assert.equal(await sourceNeedsBuild(target, async () => new Response(null, { status: 200 })), false);
  assert.throws(() => assertProtectedMcpUnchanged({ content: [{ insert: [{ id: 'somnus_database' }] }] }), /内置/);
  assert.doesNotThrow(() => assertProtectedMcpUnchanged([{ name: 'somnus-test-dsh-bundle' }]));
});

test('isolated GitHub build and restricted Release install use the real managed pnpm and DSH package operation',
  { skip: process.platform !== 'win32' || !runtime || !installer, timeout: 40_000 }, async t => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'somnus-source-integration-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const launch = { executable: process.execPath };
    const origin = 'https://github.com/fixture/pack/releases/download/v1.0.0/fixture.tgz';
    const artifact = await buildSourceArchive({ owner: 'fixture', repo: 'pack', sha: commit, directory: 'packages/plugin', metadata },
      launch, installer, async (executable, args, cwd, env) => {
        assert.ok(!cwd.startsWith(root));
        assert.ok(!env.DEEPSEEK_API_KEY);
        if (executable !== 'git') return run(executable, args, { cwd, env, windowsHide: true });
        if (!args.includes('checkout')) return;
        const pkg = path.join(cwd, 'packages', 'plugin');
        await mkdir(pkg, { recursive: true });
        await writeFile(path.join(cwd, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
        await writeFile(path.join(pkg, 'package.json'), JSON.stringify(metadata));
        await writeFile(path.join(pkg, 'build.cjs'), 'require("node:fs").mkdirSync("dist",{recursive:true});require("node:fs").writeFileSync("dist/index.js","module.exports={}");');
        await writeFile(path.join(pkg, 'cordis.patch.yml'), '[]\n');
      });
    assert.equal(archiveManifest(artifact.bytes).name, metadata.name);

    const market = new DshPluginMarket(root, root);
    const profileDir = path.join(market.home, 'profiles', 'web');
    const manifest = path.join(profileDir, 'package.json');
    await mkdir(profileDir, { recursive: true });
    const before = { name: 'dsh-profile-web', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } };
    await writeFile(manifest, JSON.stringify(before));
    market.launch = async () => launch;
    market.runtimeFile = async (name, file) => path.join(runtime, name, file);
    market.community.installer = async () => installer;
    const packageCommand = market.community.runPackageCommand.bind(market.community);
    market.community.runPackageCommand = (start, profile, tool, profileName, args) => packageCommand(start, profile, tool,
      profileName, [...args, '--store-dir=' + path.join(profileDir, '.pnpm-store'), '--config.node-linker=hoisted']);
    market.community.fetch = async (url, options) => {
      assert.equal(options.redirect, 'manual');
      if (url === origin) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } });
      assert.equal(url, 'https://release-assets.githubusercontent.com/asset');
      return new Response(artifact.bytes);
    };
    const excluded = await market.community.installSource(origin, () => {}, async () => false);
    assert.equal(excluded.cancelled, true);
    assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), before);
    await assert.rejects(lstat(path.join(profileDir, '.somnus-plugin-archives')), /ENOENT/);
    let trusted = true;
    await assert.rejects(market.community.installSource(origin, () => assert.ok(trusted), async () => { trusted = false; return true; }));
    assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), before);
    const external = { ...before, dependencies: { [metadata.name]: '9.9.9' } };
    await assert.rejects(market.community.installSource(origin, () => {}, async () => {
      await writeFile(manifest, JSON.stringify(external));
      return true;
    }), /配置已变更/);
    assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), external);
    await writeFile(manifest, JSON.stringify(before));
    const result = await market.community.installSource(origin, () => {}, async ({ id, version, sourceUrl, profile }) => {
      assert.deepEqual([id, version, sourceUrl, profile], [metadata.name, metadata.version, origin, 'web']);
      return true;
    });
    assert.deepEqual(result, { id: metadata.name, version: metadata.version, profile: 'web', installed: true });
    const after = await market.webProfile();
    assert.deepEqual(after.bundles, before.dsh.profile.bundles);
    assert.ok(after.data.dependencies[metadata.name].startsWith('file:'));
    assert.equal((await market.community.installSource(origin, () => {}, async () => assert.fail('Already installed'))).alreadyInstalled, true);
  });
