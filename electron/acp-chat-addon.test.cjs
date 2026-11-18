const assert = require('node:assert/strict');
const test = require('node:test');
const { authorize, createChatAddonInstaller, profileFor } = require('./acp-chat-addon.cjs');

test('an explicit user install request must name the exact addon or an established alias', () => {
  assert.equal(authorize({ kind: 'plugin', reference: '@xmanrui/dsh-im', request: '请安装 DSH IM' }).reference,
    '@xmanrui/dsh-im');
  assert.equal(authorize({ kind: 'skill', reference: 'ppt-master', request: '帮我把 PPT Master 安装好' }).reference,
    'https://github.com/hugohe3/ppt-master');
  for (const request of [
    '不要安装 @team/pkg', '解释如何安装 @team/pkg', '请安装 @team/pkg-other', '> 安装 @team/pkg',
    '安装 @team/pkg\n安装 @team/other', '安装 @team/nope',
  ]) assert.throws(() => authorize({ kind: 'plugin', reference: '@team/pkg', request }));
});

test('addon profile follows declared client requirements', () => {
  assert.equal(profileFor({ dsh: { client: { platform: 'web' } } }), 'web');
  assert.equal(profileFor({ dsh: { compatibility: { profiles: ['web'] } } }), 'web');
  assert.equal(profileFor({ dsh: { compatibility: { profiles: ['acp'] } } }), 'acp');
  assert.throws(() => profileFor({ dsh: { client: { platform: 'desktop' } } }));
});

test('a chat request pins npm version, installs into Web, rereads registration and probes loaded inventory', async () => {
  const id = '@team/pkg';
  const metadata = {
    name: id, version: '1.2.3',
    dist: { tarball: 'https://registry.npmjs.org/@team/pkg/-/pkg-1.2.3.tgz', integrity: 'sha512-test==' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
  };
  const web = { bundles: [] };
  const acp = { bundles: [] };
  let installed = false;
  const stages = [];
  const market = {
    status: async () => ({ plugins: [] }),
    launch: async () => ({ executable: 'node' }),
    profile: async () => acp,
    webProfile: async () => web,
    closeSettings: () => assert.equal(web.bundles[0], id),
    settings: async validate => { validate(); return {}; },
    writeBundleSelection: async (profile, name, enabled) => {
      assert.equal(profile, web);
      assert.equal(enabled, true);
      profile.bundles.push(name);
    },
    account: { request: async (_server, method) => {
      assert.equal(method, 'pluginInventory/list');
      return { entries: [{ moduleName: id, enabled: true, fiberPhase: 'active' }] };
    } },
    community: {
      installed: async profile => profile === web && installed ? metadata : null,
      fetch: async url => {
        assert.equal(url, 'https://registry.npmjs.org/%40team%2Fpkg/latest');
        return new Response(JSON.stringify(metadata));
      },
      validateBundle: async value => {
        assert.deepEqual(value, metadata);
        return { bundlePatchPaths: () => ['C:/fixture/cordis.patch.yml'], loadOverlayPatches: () => {} };
      },
      installer: async () => 'pnpm',
      install: async (_launch, profile, installer, name, version, profileName) => {
        assert.equal(profile, web);
        assert.equal(installer, 'pnpm');
        assert.equal(name, id);
        assert.equal(version, '1.2.3');
        assert.equal(profileName, 'web');
        installed = true;
      },
      packageRoot: async () => 'C:/fixture',
    },
  };
  const install = createChatAddonInstaller(market);
  const request = { kind: 'plugin', reference: id, request: '帮我安装 @team/pkg' };
  const result = await install(request, () => {}, stage => stages.push(stage));
  assert.deepEqual(stages, ['discovering', 'installing', 'verifying']);
  assert.equal(result.version, '1.2.3');
  assert.equal(result.profile, 'web');
  assert.equal(result.verified, true);
  assert.equal(result.alreadyInstalled, false);
  assert.deepEqual(acp.bundles, []);
  assert.equal((await install(request, () => {})).alreadyInstalled, true);
});
