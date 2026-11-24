'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MARKER_FILE, seedBundledPlugins } = require('./bundled-plugins.cjs');

const PACKAGE = '@local/somnus-home-plugin';
const TEMPLATE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'somnus-seed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeProfile(dshHome, bundles, extra = {}) {
  const dir = path.join(dshHome, 'profiles', 'desktop');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop', private: true, dependencies: {},
    dsh: { profile: { bundles } }, ...extra,
  }, null, 2) + '\n');
  return dir;
}

function readProfile(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

function writeBundle(root, name = 'somnus-home', version = '1.0.0') {
  const directory = path.join(root, 'bundles', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    name: PACKAGE, version, private: true, dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'cordis.patch.yml'), '[]\n');
  return directory;
}

function linkOf(profileDir) {
  return path.join(profileDir, 'node_modules', '@local', 'somnus-home-plugin');
}

test('first launch seeds the bundle, the profile link, and the marker', t => {
  const root = tempRoot(t);
  const dshHome = path.join(root, 'harness');
  const profileDir = writeProfile(dshHome, [...TEMPLATE]);
  const bundleDir = writeBundle(root);
  const logs = [];

  const result = seedBundledPlugins({ bundlesDir: path.join(root, 'bundles'), dshHome,
    log: message => logs.push(message) });

  assert.deepEqual(result.added, [PACKAGE]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.alreadyPresent, []);
  assert.deepEqual(result.errors, []);
  const profile = readProfile(profileDir);
  assert.deepEqual(profile.dsh.profile.bundles, [...TEMPLATE, PACKAGE]);
  assert.equal(profile.dependencies[PACKAGE], 'link:' + bundleDir.replace(/\\/g, '/'));
  assert.equal(fs.lstatSync(linkOf(profileDir)).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(linkOf(profileDir)), fs.realpathSync(bundleDir));
  const marker = JSON.parse(fs.readFileSync(path.join(profileDir, MARKER_FILE), 'utf8'));
  assert.equal(marker[PACKAGE].version, '1.0.0');
  assert.match(marker[PACKAGE].seededAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(logs.length > 0);
});

test('an already selected bundle is reported and left untouched', t => {
  const root = tempRoot(t);
  const dshHome = path.join(root, 'harness');
  const bundlesDir = path.join(root, 'bundles');
  writeBundle(root);
  const profileDir = writeProfile(dshHome, [...TEMPLATE]);
  assert.deepEqual(seedBundledPlugins({ bundlesDir, dshHome }).added, [PACKAGE]);
  const manifestBefore = fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8');
  const markerBefore = fs.readFileSync(path.join(profileDir, MARKER_FILE), 'utf8');

  const result = seedBundledPlugins({ bundlesDir, dshHome });

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.alreadyPresent, [PACKAGE]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.errors, []);
  assert.equal(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'), manifestBefore);
  assert.equal(fs.readFileSync(path.join(profileDir, MARKER_FILE), 'utf8'), markerBefore);
});

test('a bundle the user disabled is never installed again', t => {
  const root = tempRoot(t);
  const dshHome = path.join(root, 'harness');
  const bundlesDir = path.join(root, 'bundles');
  writeBundle(root);
  const profileDir = writeProfile(dshHome, [...TEMPLATE]);
  assert.deepEqual(seedBundledPlugins({ bundlesDir, dshHome }).added, [PACKAGE]);

  // Simulate the user disabling the plugin in the DSH plugin manager.
  const disabled = readProfile(profileDir);
  disabled.dsh.profile.bundles = [...TEMPLATE];
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify(disabled, null, 2) + '\n');
  fs.rmSync(linkOf(profileDir), { recursive: true, force: true });
  const markerBefore = fs.readFileSync(path.join(profileDir, MARKER_FILE), 'utf8');

  const result = seedBundledPlugins({ bundlesDir, dshHome });

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.skipped, [PACKAGE]);
  assert.deepEqual(result.alreadyPresent, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(readProfile(profileDir).dsh.profile.bundles, [...TEMPLATE]);
  assert.equal(fs.existsSync(linkOf(profileDir)), false);
  assert.equal(fs.readFileSync(path.join(profileDir, MARKER_FILE), 'utf8'), markerBefore);
});

test('a missing bundles directory is a silent no-op', t => {
  const root = tempRoot(t);
  const dshHome = path.join(root, 'harness');
  const profileDir = writeProfile(dshHome, [...TEMPLATE]);
  const manifestBefore = fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8');
  const logs = [];

  const result = seedBundledPlugins({ bundlesDir: path.join(root, 'missing'), dshHome,
    log: message => logs.push(message) });

  assert.deepEqual(result, { added: [], skipped: [], alreadyPresent: [], errors: [] });
  assert.equal(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'), manifestBefore);
  assert.equal(fs.existsSync(path.join(profileDir, MARKER_FILE)), false);
  assert.match(logs.join('\n'), /not found/);
});

test('a link pointing elsewhere is reported and never overwritten', t => {
  const root = tempRoot(t);
  const dshHome = path.join(root, 'harness');
  const bundlesDir = path.join(root, 'bundles');
  writeBundle(root);
  const other = path.join(root, 'other-plugin');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: PACKAGE, version: '9.9.9' }));
  const profileDir = writeProfile(dshHome, [...TEMPLATE]);
  fs.mkdirSync(path.dirname(linkOf(profileDir)), { recursive: true });
  fs.symlinkSync(other, linkOf(profileDir), process.platform === 'win32' ? 'junction' : 'dir');

  const result = seedBundledPlugins({ bundlesDir, dshHome });

  assert.deepEqual(result.added, []);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /points elsewhere/);
  assert.deepEqual(readProfile(profileDir).dsh.profile.bundles, [...TEMPLATE]);
  assert.equal(fs.realpathSync(linkOf(profileDir)), fs.realpathSync(other));
  assert.equal(fs.existsSync(path.join(profileDir, MARKER_FILE)), false);
});

test('an uninitialized profile is skipped until DSH creates it', t => {
  const root = tempRoot(t);
  const dshHome = path.join(root, 'harness');
  writeBundle(root);
  const logs = [];

  const result = seedBundledPlugins({ bundlesDir: path.join(root, 'bundles'), dshHome,
    log: message => logs.push(message) });

  assert.deepEqual(result, { added: [], skipped: [], alreadyPresent: [], errors: [] });
  assert.equal(fs.existsSync(path.join(dshHome, 'profiles', 'desktop')), false);
  assert.match(logs.join('\n'), /not initialized/);
});

test('a hand-installed bundle is adopted by the marker so a later disable sticks', t => {
  const root = tempRoot(t);
  const dshHome = path.join(root, 'harness');
  const bundlesDir = path.join(root, 'bundles');
  writeBundle(root);
  // Simulates this machine: the plugin was installed through the plugin page
  // before the installer shipped a copy, so there is no marker yet.
  const profileDir = writeProfile(dshHome, [...TEMPLATE, PACKAGE]);
  const manifestBefore = fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8');

  const adopted = seedBundledPlugins({ bundlesDir, dshHome });

  assert.deepEqual(adopted.added, []);
  assert.deepEqual(adopted.alreadyPresent, [PACKAGE]);
  assert.deepEqual(adopted.errors, []);
  assert.equal(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'), manifestBefore);
  assert.equal(fs.existsSync(linkOf(profileDir)), false);
  const marker = JSON.parse(fs.readFileSync(path.join(profileDir, MARKER_FILE), 'utf8'));
  assert.equal(marker[PACKAGE].version, '1.0.0');

  const disabled = readProfile(profileDir);
  disabled.dsh.profile.bundles = [...TEMPLATE];
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify(disabled, null, 2) + '\n');

  const result = seedBundledPlugins({ bundlesDir, dshHome });

  assert.deepEqual(result.skipped, [PACKAGE]);
  assert.deepEqual(result.added, []);
  assert.deepEqual(readProfile(profileDir).dsh.profile.bundles, [...TEMPLATE]);
});
