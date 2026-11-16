const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createReadStream, readFileSync, statSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

// Resolve the YAML parser used by the installed, pinned electron-builder.
function loadYaml() {
  const electronRequire = createRequire(path.join(__dirname, '../electron/package.json'));
  const builderRequire = createRequire(electronRequire.resolve('electron-builder'));
  return createRequire(builderRequire.resolve('app-builder-lib'))('js-yaml');
}

async function verify(directory, version, channel, publisher, yaml = loadYaml()) {
  const setup = `Somnus-Setup-${version}-windows-x64.exe`;
  const filename = path.join(directory, setup);
  const manifest = yaml.load(readFileSync(path.join(directory, `${channel}.yml`), 'utf8'));
  const config = yaml.load(readFileSync(path.join(directory, 'win-unpacked/resources/app-update.yml'), 'utf8'));
  assert.equal(config.provider, 'github');
  assert.equal(config.owner, 'GSXTY');
  assert.equal(config.repo, 'Somnus-Releases');
  assert.equal(config.private, false);
  assert.equal(config.channel, channel);
  assert.notEqual(config.verifyUpdateCodeSignature, false);
  assert.ok(publisher);
  assert.deepEqual(config.publisherName, [publisher]);
  assert.equal(manifest.version, version);
  assert.equal(manifest.path, setup);
  assert.equal(manifest.files.length, 1);
  const installer = manifest.files[0];
  assert.equal(installer.url, setup);
  assert.equal(installer.size, statSync(filename).size);
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  const digest = hash.digest('base64');
  assert.equal(installer.sha512, digest);
  assert.equal(manifest.sha512, digest);
  assert.ok(statSync(filename + '.blockmap').size > 0);
}

if (require.main === module) {
  const [version, channel, publisher] = process.argv.slice(2);
  verify('dist/electron', version, channel, publisher).catch(error => {
    console.error('Windows update verification failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { verify };
