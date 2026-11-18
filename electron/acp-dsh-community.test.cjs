const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DshCommunityMarket } = require('./acp-dsh-community.cjs');

test('custom plugin sources persist in the user profile and are selected explicitly', async t => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'somnus-dsh-market-'));
  t.after(() => rm(profileDir, { recursive: true, force: true }));
  const makeMarket = () => new DshCommunityMarket({ profileDir }, null, null, '0.2.2-rc.1', async url => {
    assert.equal(url, 'https://example.invalid/plugins.json');
    return Response.json({ plugins: [] });
  });
  const first = makeMarket();
  assert.throws(() => first.setSources(['https://127.0.0.1/plugins.json'], () => {}), /HTTPS/);
  const { sources } = await first.setSources(['https://example.invalid/plugins.json', 'https://example.invalid/plugins.json'], () => {});
  assert.equal(sources.length, 3);
  const reopened = makeMarket();
  reopened.tools = async () => ({ parseMarketIndex: data => data, semver: {} });
  assert.deepEqual(await reopened.sources(), sources);
  assert.equal((await reopened.index(false, sources[2].id)).source.url, sources[2].url);
  await reopened.setSources([], () => {});
  await assert.rejects(reopened.index(false, sources[2].id), /已删除/);
});

test('community starts with no active partner and selects real browsing sources explicitly', async t => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'somnus-dsh-market-modes-'));
  t.after(() => rm(profileDir, { recursive: true, force: true }));
  const market = { profileDir, launch: async () => null, profile: async () => null, webProfile: async () => null };
  const calls = [];
  const api = new DshCommunityMarket(market, null, null, '0.2.2-rc.1', async url => {
    calls.push(url);
    if (url === 'https://api.dshfind.com/v1/catalog') return Response.json({ total: 2, data_version: 'sha256:' + 'a'.repeat(64), data: [
      { is_plugin: true, is_risky: false, full_name: 'Dev/Flight', name: 'Flight', repository_url: 'https://github.com/Dev/Flight' },
      { is_plugin: true, is_risky: true, full_name: 'Dev/Danger', name: 'Danger', repository_url: 'https://github.com/Dev/Danger' },
    ] });
    assert.equal(url, 'https://deepseek1024.com/api/v2/plugins?page=1&limit=2&q=use&sort=active');
    return Response.json({ page: 1, limit: 2, total: 1, categories: [{ id: 'tools', count: 1 }], plugins: [
      { name: 'Use', id: 'Dev/Use', url: 'https://github.com/Dev/Use', description: { en: 'Tools' },
        install: 'dsh plugin --profile web add example-package', stars: 3 },
    ] });
  });
  api.installer = async () => null;

  const empty = await api.status();
  assert.deepEqual(empty.plugins, []);
  assert.deepEqual(empty.sources.map(source => [source.id, source.builtin]), [['dsh-1024store', true], ['dshfind', true]]);
  assert.equal(calls.length, 0);
  const tools = await api.status('use', false, 'dsh-1024store', { pageSize: 2, sort: 'newest' });
  assert.deepEqual(tools.plugins.map(item => [item.name, item.browseOnly, item.available, item.stars]), [['Use', true, false, 3]]);
  const flight = await api.status('', false, 'dshfind');
  assert.deepEqual(flight.plugins.map(item => item.name), ['Flight']);
  assert.equal(flight.plugins[0].authorAvatarUrl, 'https://avatars.githubusercontent.com/Dev?size=96');
  await assert.rejects(api.change(flight.plugins[0].id, 'install', () => {}, { marketSource: 'dshfind', confirm: async () => true }), /无效/);
  await api.status('Flight', false, 'dshfind');
  assert.equal(calls.length, 2);
});

test('community catalog filters, sorts and pages matching rows using feed metadata', async () => {
  const packageId = index => 'fixture-plugin-' + index;
  const profile = { data: { dependencies: { [packageId(1)]: '1.0.0' } }, bundles: [packageId(1)] };
  const market = { profileDir: os.tmpdir(), launch: async () => ({}), profile: async () => profile, webProfile: async () => null };
  const api = new DshCommunityMarket(market, null, null, '0.2.2-rc.1');
  const plugins = Array.from({ length: 60 }, (_, index) => ({ name: packageId(index),
    metadata: { category: index % 2 === 0 ? 'tools' : 'assistant', keywords: ['sample'] },
    versions: [{ version: '2.0.0', source: { type: 'npm' }, engines: {}, publishTimestamp: 1_700_000_000 + index }],
  }));
  Object.assign(plugins[54], { author: 'Fixture author', icon: 'https://art.example.invalid/plugin.png',
    homepage: 'https://author.example.invalid/plugin', repository: { url: 'https://github.com/fixture/plugin' } });
  Object.assign(plugins[52], { icon: 'https://127.0.0.1/plugin.png', homepage: 'https://user:pass@example.invalid/',
    repository: { url: 'http://github.com/fixture/plugin' } });
  plugins[1].icon = 'data:image/png;base64,AAAA';
  api.sources = async () => [{ name: 'Fixture', url: 'https://catalog.invalid/', id: 'community' }];
  api.installer = async () => 'fixture-installer';
  api.richIndex = async () => undefined;
  api.index = async () => ({ plugins, semver: { gt: (a, b) => a > b },
    metadata: { categories: { tools: { title: { en: 'Tools' } }, assistant: { title: { en: 'Assistant' } } } },
  });
  const inspected = [];
  api.installed = async (_profile, id) => {
    inspected.push(id);
    return id === packageId(1) ? { version: '1.0.0' } : null;
  };

  const tail = await api.status('', false, 'dsh-market', { page: 2 });
  assert.equal(tail.total, 60);
  assert.equal(tail.page, 2);
  assert.equal(tail.plugins.length, 20);
  assert.equal(inspected.length, 20);
  const recent = await api.status('sample', false, 'dsh-market', { page: 2, pageSize: 2, sort: 'newest', category: 'tools' });
  assert.deepEqual(recent.categories, [{ id: 'tools', label: 'Tools', count: 30 }, { id: 'assistant', label: 'Assistant', count: 30 }]);
  assert.equal(recent.total, 30);
  assert.deepEqual(recent.plugins.map(plugin => plugin.id), [packageId(54), packageId(52)]);
  assert.deepEqual(recent.plugins[0].categories, ['tools']);
  assert.equal(recent.plugins[0].updatedAt, new Date(1_700_000_054_000).toISOString());
  assert.equal(recent.plugins[0].author, 'Fixture author');
  assert.equal(recent.plugins[0].iconUrl, 'https://art.example.invalid/plugin.png');
  assert.equal(recent.plugins[0].homepageUrl, 'https://author.example.invalid/plugin');
  assert.equal(recent.plugins[0].repositoryUrl, 'https://github.com/fixture/plugin');
  assert.equal(recent.plugins[1].iconUrl, undefined);
  assert.equal(recent.plugins[1].homepageUrl, undefined);
  assert.equal(recent.plugins[1].repositoryUrl, undefined);

  const installed = await api.status('', false, 'dsh-market', { installedOnly: true });
  assert.equal(installed.plugins[0].id, packageId(1));
  assert.equal(installed.plugins[0].canUpdate, true);
  assert.equal(installed.plugins[0].iconUrl, 'data:image/png;base64,AAAA');
  const favorite = await api.status('', false, 'dsh-market', { page: 100, includeIds: [packageId(1), packageId(2)], excludeIds: [packageId(1)] });
  assert.deepEqual(favorite.plugins.map(plugin => plugin.id), [packageId(2)]);
  assert.equal(favorite.page, 1);
  assert.deepEqual((await api.status('', false, 'dsh-market', { includeIds: [] })).plugins, []);
  await assert.rejects(api.status('', false, 'dsh-market', { pageSize: 81 }), /无效/);
});

test('desktop storefront enriches verified packages and adds separate non-installable listings', async () => {
  const profile = { data: {}, bundles: [] };
  const market = { profileDir: os.tmpdir(), launch: async () => ({}), profile: async () => profile, webProfile: async () => null };
  const project = 'https://awesome-dsh-plugin.com/p/maintainer/plugin/packages/widget/';
  const wanted = 'https://raw.githubusercontent.com/maintainer/plugin/main/desktop.png';
  const repo = 'https://github.com/maintainer/plugin';
  const requests = [];
  const api = new DshCommunityMarket(market, null, null, '0.2.2-rc.1', async url => {
    requests.push(url);
    if (url === 'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/plugins.json') return new Response(null, { status: 502 });
    assert.equal(url, 'https://awesome-dsh-plugin.com/plugins.json');
    return Response.json({ plugins: [
      { npm: 'fixture-widget', url: repo + '/tree/main/packages/widget', page: project,
        added: '2026-10-15', stars: 13, downloads: 0, githubReleaseDownloads: 275, screenshots: [wanted, wanted, 'https://example.invalid/a.png',
          'https://raw.githubusercontent.com/maintainer/plugin/main/drawing.svg'] },
      { npm: 'fixture-release', url: 'https://github.com/maintainer/release',
        page: 'https://awesome-dsh-plugin.com/p/maintainer/release/', added: '2026-10-30', downloads: null, githubReleaseDownloads: 54 },
      { npm: 'fixture-alias', url: 'https://github.com/other/alias',
        page: 'https://awesome-dsh-plugin.com/p/other/alias/', stars: 79 },
      { name: 'GitHub-only listing', npm: null, url: 'https://github.com/other/github-only',
        page: 'https://awesome-dsh-plugin.com/p/other/github-only/' },
      { npm: 'fixture-malformed', url: 'https://github.com', page: 'https://awesome-dsh-plugin.com/p/invalid/' },
    ] });
  });
  api.installer = async () => 'fixture-installer';
  api.sources = async () => [{ id: 'community', url: 'https://catalog.invalid/' }, { id: 'custom', url: 'https://other.invalid/' }];
  api.installed = async () => null;
  api.index = async () => ({ semver: {}, plugins: [
    { name: 'fixture-widget', homepage: project, repository: { url: repo } },
    { name: 'fixture-release', repository: { url: 'https://github.com/maintainer/release' } },
    { name: 'fixture-alias', repository: { url: 'https://github.com/maintainer/alias' } },
  ].map(item => ({ ...item, versions: [{ version: '1.0.0', source: { type: 'npm' }, engines: {} }] })) });

  const { plugins, total } = await api.status('', false, 'dsh-market');
  const find = id => plugins.find(plugin => plugin.id === id);
  const widget = find('fixture-widget');
  const release = find('fixture-release');
  const alias = find('fixture-alias');
  assert.equal(total, 5);
  assert.equal(plugins[0].id, widget.id);
  assert.equal(widget.author, 'maintainer');
  assert.equal(widget.authorAvatarUrl, 'https://avatars.githubusercontent.com/maintainer?size=96');
  assert.equal(widget.repositoryUrl, repo + '/tree/main/packages/widget');
  assert.equal(widget.commentsUrl, project);
  assert.equal(widget.addedAt, '2026-10-15');
  assert.equal(widget.stars, 13);
  assert.equal(widget.downloads, 0);
  assert.equal(widget.downloadSource, 'npm');
  assert.deepEqual(widget.screenshots, [{ url: wanted }]);
  assert.equal(release.downloads, 54);
  assert.equal(release.downloadSource, 'github');
  assert.equal(alias.stars, undefined);
  assert.equal((await api.status('', false, 'dsh-market', { sort: 'newest' })).plugins[0].id, 'fixture-release');
  const { plugins: [browseOnly] } = await api.status('GitHub-only listing', false, 'dsh-market');
  assert.match(browseOnly.id, /^rich:[a-f0-9]{40}$/);
  assert.equal(browseOnly.browseOnly, true);
  assert.equal(browseOnly.available, false);
  assert.equal(browseOnly.version, '');
  assert.equal(browseOnly.repositoryUrl, 'https://github.com/other/github-only');
  assert.deepEqual((await api.status('', false, 'dsh-market', { includeIds: [browseOnly.id] })).plugins, [browseOnly]);
  await assert.rejects(api.change(browseOnly.id, 'install', () => {}, { confirm: async () => true }), /无效/);
  assert.equal((await api.status('', false, 'custom')).plugins[0].stars, undefined);
  await api.status('', false, 'dsh-market');
  assert.equal(requests.length, 2);
});

test('explicit compatible version stays in its Web profile and restores after a partial installation failure', async () => {
  const id = '@fixture/native-plugin';
  const acp = { bundles: [] };
  const web = { bundles: [id] };
  let current = '1.0.0';
  const installs = [];
  const metadata = version => ({ name: id, version, dsh: { bundle: { patch: 'fixture.yml' } },
    dist: { tarball: 'https://registry.npmjs.org/fixture.tgz', integrity: 'sha512-fake' } });
  const market = { profileDir: os.tmpdir(), launch: async () => ({}), profile: async () => acp,
    webProfile: async () => web, closeSettings: async () => {} };
  const api = new DshCommunityMarket(market, null, null, '0.2.2-rc.1', async url => {
    assert.match(url, /2\.0\.0$/);
    return Response.json(metadata('2.0.0'));
  });
  api.installer = async () => 'installer';
  api.index = async (_refresh, source) => {
    assert.equal(source, 'source-fixture');
    return { semver: {}, byId: new Map([[id, { versions: ['1.0.0', '2.0.0'].map(version =>
      ({ version, source: { type: 'npm' }, engines: {} })) }]]) };
  };
  api.installed = async profile => profile === web ? metadata(current) : null;
  api.validateBundle = async () => {};
  api.install = async (_launch, target, _installer, requested, version, profileName) => {
    assert.equal(target, web);
    assert.equal(requested, id);
    assert.equal(profileName, 'web');
    installs.push(version);
    current = version;
    if (version === '2.0.0') throw new Error('simulated partial install');
  };
  let confirmed = false;
  const options = { marketSource: 'source-fixture', requestedVersion: '2.0.0', confirm: async info => {
    assert.equal(info.version, '2.0.0');
    confirmed = true;
    return true;
  } };
  await assert.rejects(api.change(id, 'version', () => {}, options), /恢复原插件版本 1\.0\.0/);
  assert.equal(confirmed, true);
  assert.deepEqual(installs, ['2.0.0', '1.0.0']);
  assert.equal(current, '1.0.0');
  assert.deepEqual(web.bundles, [id]);
  assert.equal(market.webPluginMutation, false);
});

test('community uninstall confirms once, removes owned ACP and Web registrations, and preserves unrelated choices', async () => {
  const id = '@fixture/personal-plugin';
  const other = '@fixture/unchanged';
  const profiles = Object.fromEntries(['acp', 'web'].map((name, index) => [name, {
    file: `${name}/package.json`, bundles: ['@deepseek-ai/dsh-base', id, other],
    data: { dependencies: { [id]: index === 0 ? 'file:../plugin-workspace' : '2.0.0', [other]: '1.0.0' } },
  }]));
  const profile = name => Promise.resolve(structuredClone(profiles[name]));
  const steps = [];
  const market = { profileDir: os.tmpdir(), launch: async () => ({ executable: 'somnus' }),
    profile: () => profile('acp'), webProfile: () => profile('web'),
    async closeSettings() { steps.push('close-web'); },
    async writeBundleSelection(value, name, enabled) {
      assert.equal(name, id);
      assert.equal(enabled, false);
      profiles[value.file.split('/')[0]].bundles = value.bundles.filter(bundle => bundle !== name);
    },
  };
  const api = new DshCommunityMarket(market, null, null, '0.2.2-rc.1', async () => assert.fail('uninstall contacted market'));
  api.installer = async () => 'bundled-pnpm';
  api.installed = async (row, name) => Object.hasOwn(row.data.dependencies, name)
    && { version: row.file.startsWith('acp') ? '1.0.0' : '2.0.0' };
  api.runPackageCommand = async (_launch, manifest, installer, name, args) => {
    assert.equal(market.webPluginMutation, true);
    assert.equal(manifest.file, name + '/package.json');
    assert.equal(installer, 'bundled-pnpm');
    assert.deepEqual(args, ['remove', id, '--config.ignore-scripts=true']);
    delete profiles[name].data.dependencies[id];
    steps.push(name);
    return { exitCode: 0 };
  };

  await assert.rejects(api.uninstall('@deepseek-ai/dsh-base', () => {}, async () => true), /个人安装/);
  await api.uninstall(id, () => {}, async () => false);
  assert.deepEqual(steps, []);
  assert.ok(profiles.acp.data.dependencies[id]);
  await api.uninstall(id, () => {}, async consent => {
    assert.deepEqual(consent, { id, versions: ['1.0.0', '2.0.0'] });
    return true;
  });
  assert.deepEqual(steps, ['close-web', 'acp', 'web']);
  for (const row of Object.values(profiles)) {
    assert.deepEqual(row.data.dependencies, { [other]: '1.0.0' });
    assert.deepEqual(row.bundles, ['@deepseek-ai/dsh-base', other]);
  }
  assert.equal(market.webPluginMutation, false);
});

test('failed uninstall keeps an installed bundle selected and cleans selection if package removal already committed', async () => {
  const id = 'personal-plugin';
  const row = { file: 'web/package.json', bundles: [id], data: { dependencies: { [id]: '1.0.0' } } };
  const market = { profileDir: os.tmpdir(), launch: async () => ({}), profile: async () => null,
    webProfile: async () => structuredClone(row), closeSettings: async () => {},
    async writeBundleSelection(_, name) { row.bundles = row.bundles.filter(bundle => bundle !== name); } };
  const api = new DshCommunityMarket(market, null, null, '0.2.2-rc.1');
  api.installer = async () => 'pnpm';
  api.installed = async () => ({ version: '1.0.0' });
  api.runPackageCommand = async () => ({ exitCode: 1 });
  await assert.rejects(api.uninstall(id, () => {}, async () => true), /未能卸载/);
  assert.deepEqual(row.bundles, [id]);
  api.runPackageCommand = async () => {
    delete row.data.dependencies[id];
    throw new Error('process ended after writing manifest');
  };
  await assert.rejects(api.uninstall(id, () => {}, async () => true), /ended after writing/);
  assert.deepEqual(row.bundles, []);
  assert.equal(market.webPluginMutation, false);
});
