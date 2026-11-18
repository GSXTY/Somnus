const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createUpdaterState, findPublicRelease, isPublicFeedEmpty, resolveWindowsUpdater, updateUrl } = require('./acp-somnus-updater.cjs');

async function resolveFixture(t, { env = {}, profile, release, version = '0.3.0' } = {}) {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'somnus-updater-'));
  t.after(() => rm(profileDir, { recursive: true, force: true }));
  if (profile) await writeFile(path.join(profileDir, 'somnus-updates.json'), JSON.stringify(profile));
  if (release) await writeFile(path.join(profileDir, 'app-update.yml'), JSON.stringify(release));
  const updater = new EventEmitter();
  updater.setFeedURL = feed => { updater.feed = feed; };
  updater.loadUpdateConfig = async () => JSON.parse(await readFile(path.join(profileDir, 'app-update.yml'), 'utf8'));
  const result = await resolveWindowsUpdater({
    app: { isPackaged: true, getVersion: () => version }, profileDir, resourcesPath: profileDir, env, createUpdater: () => updater,
  });
  return result;
}

test('default stable GitHub feed does not receive environment credentials', async t => {
  const { updater, requiresPublisher } = await resolveFixture(t, {
    env: { GH_TOKEN: 'test-gh-token', GITHUB_TOKEN: 'test-github-token' },
  });
  assert.deepEqual(updater.feed, {
    provider: 'github', owner: 'GSXTY', repo: 'Somnus-Releases', private: false, protocol: 'https',
  });
  assert.equal(updater.allowPrerelease, false);
  assert.equal(requiresPublisher, true);
  assert.equal(JSON.parse(await readFile(updater.updateConfigPath)).updaterCacheDirName, 'somnus-updater');
});

test('environment HTTPS override wins and keeps packaged publisher metadata', async t => {
  const release = { provider: 'github', owner: 'GSXTY', repo: 'Somnus-Releases', channel: 'latest', publisherName: ['Publisher'] };
  const { updater, requiresPublisher } = await resolveFixture(t, {
    release, profile: { url: 'https://profile.example/windows' }, env: { SOMNUS_UPDATE_URL: 'https://override.example/windows' },
  });
  assert.deepEqual(updater.feed, { provider: 'generic', url: 'https://override.example/windows/', channel: 'latest' });
  assert.equal(updater.updateConfigPath, undefined);
  assert.deepEqual((await updater.loadUpdateConfig()).publisherName, ['Publisher']);
  assert.equal(requiresPublisher, false);
});

test('profile HTTPS override and packaged signed GitHub feed can be used', async t => {
  const profile = await resolveFixture(t, { profile: { url: 'https://profile.example/windows', publisherName: 'Publisher' } });
  assert.equal(profile.updater.feed.url, 'https://profile.example/windows/');
  assert.deepEqual(JSON.parse(await readFile(profile.updater.updateConfigPath)).publisherName, ['Publisher']);
  const signed = await resolveFixture(t, {
    release: { provider: 'github', owner: 'GSXTY', repo: 'Somnus-Releases', publisherName: ['Publisher'] },
  });
  assert.equal(signed.updater.feed.provider, 'github');
  assert.equal(signed.requiresPublisher, false);
});

test('an empty public releases response is distinguished from missing artifacts and failed requests', async () => {
  const error = { code: 'ERR_UPDATER_INVALID_RELEASE_FEED' };
  const empty = await isPublicFeedEmpty(error, async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/GSXTY/Somnus-Releases/releases?per_page=1');
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => [] };
  });
  assert.equal(empty, true);
  assert.equal(await isPublicFeedEmpty(error, async () => ({ ok: true, json: async () => [{}] })), false);
  assert.equal(await isPublicFeedEmpty(error, async () => ({ ok: false })), false);
  assert.equal(await isPublicFeedEmpty({ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }, async () => {
    assert.fail('The release exists but lacks an update manifest.');
  }), false);
});

test('a verified empty release feed remains checkable', async t => {
  const fixture = await resolveFixture(t, { release: {
    provider: 'github', owner: 'GSXTY', repo: 'Somnus-Releases', publisherName: ['Publisher'],
  } });
  fixture.updater.checkForUpdates = async () => {
    throw Object.assign(new Error('No published versions on GitHub'), { code: 'ERR_XML_MISSED_ELEMENT' });
  };
  fixture.checkEmptyFeed = error => isPublicFeedEmpty(error, async () => {
    assert.fail('An empty Atom feed does not need the GitHub REST API.');
  });
  const currentVersion = '0.3.0-beta.4';
  const updates = createUpdaterState({ currentVersion, supported: true, resolveUpdater: () => fixture });
  assert.deepEqual(await updates.check(), { phase: 'no-release', currentVersion });
  assert.deepEqual(await updates.check(), { phase: 'no-release', currentVersion });
});

test('preview feed allows checking but links to GitHub for manual download without a publisher', async t => {
  const fixture = await resolveFixture(t, { version: '0.3.0-beta.4', profile: { publisherName: 'Unexpected Publisher' } });
  assert.equal(fixture.updater.allowPrerelease, true);
  assert.equal(fixture.requiresPublisher, true);
  fixture.updater.checkForUpdates = async () => assert.fail('must not initialize automatic update');
  const manual = { version: '0.3.0-beta.5', url: 'https://github.com/GSXTY/Somnus-Releases/releases/tag/v0.3.0-beta.5' };
  fixture.publicRelease = async () => manual;
  fixture.updater.downloadUpdate = async () => assert.fail('must not download');
  const updates = createUpdaterState({
    currentVersion: '0.3.0-beta.4', supported: true, resolveUpdater: () => fixture,
  });
  assert.deepEqual(await updates.check(), {
    phase: 'manual', currentVersion: '0.3.0-beta.4', ...manual,
  });
  assert.equal((await updates.download()).phase, 'manual');
  assert.equal((await updates.install()).phase, 'manual');
});

test('manual release listing validates version, channel, and asset without trusting remote URLs', async () => {
  const release = (version, values = {}) => ({
    tag_name: 'v' + version, draft: false, prerelease: version.includes('-beta.'),
    html_url: 'https://untrusted.invalid/file.exe',
    assets: [{ name: 'Somnus-Setup-' + version + '-windows-x64.exe', state: 'uploaded' }], ...values,
  });
  const request = async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/GSXTY/Somnus-Releases/releases?per_page=30');
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => [
      release('0.5.0-beta.1', { draft: true }), release('0.4.0-beta.11'), release('0.4.0-beta.9'),
      release('0.4.1', { assets: [] }), release('0.4.0-beta.2'), release('0.3.1'),
    ] };
  };
  assert.deepEqual(await findPublicRelease('0.4.0-beta.1', request), {
    version: '0.4.0-beta.11', url: 'https://github.com/GSXTY/Somnus-Releases/releases/tag/v0.4.0-beta.11',
  });
  assert.equal((await findPublicRelease('0.3.0', request)).version, '0.3.1');
});

test('rate-limited public API falls back to published Atom tags and verifies the Windows installer', async () => {
  const requests = [];
  const releasePage = 'https://github.com/GSXTY/Somnus-Releases/releases';
  const tags = ['v0.3.0-beta.10', 'v0.3.0-beta.3', 'v0.3.0-beta.9', 'v0.3.0-beta.8'];
  const request = async (url, options) => {
    requests.push(url);
    assert.equal(options.credentials, 'omit');
    if (url.startsWith('https://api.github.com/')) return { ok: false, status: 403 };
    if (url === releasePage + '.atom') return {
      ok: true,
      text: async () => `<feed><id>tag:github.com,2008:${releasePage}</id>${tags.map(tag =>
        `<entry><id>tag:github.com,2008:Repository/1458474107/${tag}</id></entry>`).join('')}</feed>`,
    };
    assert.equal(options.method, 'HEAD');
    return url.includes('/v0.3.0-beta.9/') ? { ok: true } : { ok: false, status: 404 };
  };
  assert.deepEqual(await findPublicRelease('0.3.0-beta.7', request), {
    version: '0.3.0-beta.9', url: releasePage + '/tag/v0.3.0-beta.9',
  });
  assert.deepEqual(requests.slice(2), [
    releasePage + '/download/v0.3.0-beta.10/Somnus-Setup-0.3.0-beta.10-windows-x64.exe',
    releasePage + '/download/v0.3.0-beta.9/Somnus-Setup-0.3.0-beta.9-windows-x64.exe',
  ]);
  assert.equal(await findPublicRelease('0.3.0', request), undefined);
});

test('signed clients missing an update manifest use the manual-release route', async t => {
  const fixture = await resolveFixture(t, { version: '0.3.0-beta.4', release: {
    provider: 'github', owner: 'GSXTY', repo: 'Somnus-Releases', publisherName: ['Publisher'],
  } });
  fixture.updater.checkForUpdates = async () => {
    throw Object.assign(new Error('Missing beta.yml'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' });
  };
  const release = { version: '0.3.0-beta.6', url: 'https://github.com/GSXTY/Somnus-Releases/releases/tag/v0.3.0-beta.6' };
  fixture.publicRelease = async () => release;
  const updates = createUpdaterState({
    currentVersion: '0.3.0-beta.4', supported: true, resolveUpdater: () => fixture,
  });
  assert.deepEqual(await updates.check(), { phase: 'manual', currentVersion: '0.3.0-beta.4', ...release });
});

test('disabling Authenticode verification in packaged config is rejected', async t => {
  await assert.rejects(resolveFixture(t, { release: {
    provider: 'github', owner: 'GSXTY', repo: 'Somnus-Releases', publisherName: ['Publisher'], verifyUpdateCodeSignature: false,
  } }));
});

test('update feeds require HTTPS outside explicit local development', () => {
  assert.equal(updateUrl('https://updates.example/somnus'), 'https://updates.example/somnus/');
  assert.equal(updateUrl('https://user:secret@updates.example/'), null);
  assert.equal(updateUrl('https://updates.example/?token=secret'), null);
  assert.equal(updateUrl('http://127.0.0.1:4123/'), null);
  assert.equal(updateUrl('http://127.0.0.1:4123/', true), 'http://127.0.0.1:4123/');
  assert.equal(updateUrl('http://192.168.1.1/', true), null);
});

test('unsupported and unconfigured apps do not start an update', async () => {
  const currentVersion = '0.3.0-beta.4';
  const unsupported = createUpdaterState({
    currentVersion, supported: false, resolveUpdater: () => assert.fail('must not initialize'),
  });
  const unconfigured = createUpdaterState({ currentVersion, supported: true, resolveUpdater: () => null });
  assert.equal((await unsupported.check()).phase, 'unsupported');
  assert.equal((await unconfigured.getState()).phase, 'unconfigured');
  assert.equal((await unconfigured.download()).phase, 'unconfigured');
  assert.equal((await unconfigured.install()).phase, 'unconfigured');
});

test('updates require separate check, download and install actions', async () => {
  const currentVersion = '0.3.0-beta.4';
  const version = '0.3.1';
  const events = [];
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => updater.emit('update-available', { version });
  updater.downloadUpdate = async () => {
    updater.emit('download-progress', { percent: 27 });
    updater.emit('update-downloaded', { version });
  };
  updater.quitAndInstall = () => events.push('install');
  const updates = createUpdaterState({
    currentVersion,
    supported: true,
    resolveUpdater: () => ({ updater }),
    publish: state => events.push(state.phase === 'downloading' ? state.percent : state.phase),
    prepareInstall: async () => events.push('stopped'),
  });
  assert.equal((await updates.getState()).phase, 'idle');
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal((await updates.install()).phase, 'idle');
  assert.deepEqual(await updates.check(), { phase: 'available', currentVersion, version });
  assert.deepEqual(await updates.download(), { phase: 'downloaded', currentVersion, version, percent: 100 });
  assert.deepEqual(events, ['idle', 'checking', 'available', 0, 27, 'downloaded']);
  await updates.install();
  assert.deepEqual(events.slice(-2), ['stopped', 'install']);
});
