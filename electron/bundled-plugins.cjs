'use strict';

// Seed the plugins shipped inside the installer into the DSH desktop profile.
//
// The packaged application carries plugins under `<resources>/bundles/<name>`.
// On the first launch we register one of them in
// `<DSH_HOME>/profiles/<profile>/package.json` (`dsh.profile.bundles`) and link
// the package directory into that profile's `node_modules`. The link points at
// the installer directory, so replacing the installation upgrades the plugin
// without touching the profile.
//
// A marker file records every package this module installed. It is the only
// reason a bundle missing from `dsh.profile.bundles` stays out: the user
// disabled it, and the installer must never install it back.

const fs = require('node:fs');
const path = require('node:path');

/** Marker recording the packages seeded by the installer. */
const MARKER_FILE = '.somnus-seeded-bundles.json';

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function sameDirectory(left, right) {
  try {
    return fs.realpathSync.native(left) === fs.realpathSync.native(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

/** Collect one candidate per `bundlesDir/<name>/package.json`, in a deterministic order. */
function collectBundles(bundlesDir, log, errors) {
  const bundles = [];
  let entries;
  try {
    entries = fs.readdirSync(bundlesDir, { withFileTypes: true });
  } catch (error) {
    errors.push(`bundles: cannot read ${bundlesDir}: ${error.message}`);
    return bundles;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(bundlesDir, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    } catch (error) {
      errors.push(`${entry.name}: cannot read package.json: ${error.message}`);
      continue;
    }
    if (!isPlainObject(manifest) || typeof manifest.name !== 'string' || manifest.name.trim() === '') {
      errors.push(`${entry.name}: package.json has no package name`);
      continue;
    }
    bundles.push({ name: manifest.name.trim(), version: typeof manifest.version === 'string' ? manifest.version : '',
      directory });
  }
  return bundles;
}

function readMarker(markerFile) {
  let raw;
  try {
    raw = fs.readFileSync(markerFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { marker: {}, error: null };
    return { marker: null, error: `marker: cannot read ${markerFile}: ${error.message}` };
  }
  try {
    const marker = JSON.parse(raw);
    if (!isPlainObject(marker)) return { marker: null, error: `marker: ${markerFile} is not a JSON object` };
    return { marker, error: null };
  } catch (error) {
    return { marker: null, error: `marker: cannot parse ${markerFile}: ${error.message}` };
  }
}

/** Compare the profile link with the packaged bundle directory without changing anything. */
function linkState(linkPath, target) {
  let info;
  try {
    info = fs.lstatSync(linkPath);
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing' };
    return { state: 'error', reason: error.message };
  }
  if (!info.isSymbolicLink()) return { state: 'conflict', target: linkPath };
  try {
    if (sameDirectory(linkPath, target)) return { state: 'ok' };
  } catch {}
  return { state: 'conflict', target: fs.readlinkSync(linkPath) };
}

function createLink(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  if (process.platform === 'win32') fs.symlinkSync(target, linkPath, 'junction');
  else fs.symlinkSync(target, linkPath, 'dir');
}

/**
 * Register installer-shipped plugin bundles in a DSH profile.
 *
 * Called after DSH initializes `<dshHome>/profiles/<profileName>` and before the
 * DSH host loads it. A missing `bundlesDir` or uninitialized profile is a no-op;
 * any other failure is reported in `errors` and never throws, so the
 * application still starts.
 * @param {{ bundlesDir: string, dshHome: string, profileName?: string,
 *   log?: (message: string) => void }} options
 * @returns {{ added: string[], skipped: string[], alreadyPresent: string[], errors: string[] }}
 */
function seedBundledPlugins({ bundlesDir, dshHome, profileName = 'desktop', log = () => {} } = {}) {
  const result = { added: [], skipped: [], alreadyPresent: [], errors: [] };
  if (typeof bundlesDir !== 'string' || bundlesDir.trim() === '' ||
      typeof dshHome !== 'string' || dshHome.trim() === '') {
    result.errors.push('seed: bundlesDir and dshHome are required');
    return result;
  }
  if (!fs.existsSync(bundlesDir)) {
    log(`bundles directory not found, skipping: ${bundlesDir}`);
    return result;
  }
  const profileDir = path.join(dshHome, 'profiles', profileName);
  const manifestFile = path.join(profileDir, 'package.json');
  if (!fs.existsSync(manifestFile)) {
    // DSH owns profile creation. Running before it would create a profile that
    // shadows the upstream template, so skip and let the next start seed it.
    log(`profile manifest not initialized yet, skipping: ${manifestFile}`);
    return result;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    result.errors.push(`profile: cannot read ${manifestFile}: ${error.message}`);
    return result;
  }
  if (!isPlainObject(manifest) || !isPlainObject(manifest.dsh) || !isPlainObject(manifest.dsh.profile) ||
      !Array.isArray(manifest.dsh.profile.bundles)) {
    result.errors.push(`profile: ${manifestFile} has no dsh.profile.bundles array`);
    return result;
  }

  const markerFile = path.join(profileDir, MARKER_FILE);
  const { marker, error: markerError } = readMarker(markerFile);
  if (markerError !== null) {
    // An unreadable marker cannot prove the user kept a plugin disabled, so
    // installing anything could resurrect it. Leave the profile untouched.
    result.errors.push(markerError);
    return result;
  }

  const bundles = manifest.dsh.profile.bundles;
  let changed = false;
  let markerChanged = false;
  const seededAt = new Date().toISOString();
  for (const bundle of collectBundles(bundlesDir, log, result.errors)) {
    if (bundles.includes(bundle.name)) {
      result.alreadyPresent.push(bundle.name);
      // Adopt a bundle the user installed by hand before the installer shipped
      // one: without a marker, disabling it later would resurrect it once.
      if (!Object.hasOwn(marker, bundle.name)) {
        marker[bundle.name] = { version: bundle.version, seededAt };
        markerChanged = true;
      }
      continue;
    }
    if (Object.hasOwn(marker, bundle.name)) {
      // The user disabled this bundle after the installer added it.
      result.skipped.push(bundle.name);
      continue;
    }
    const scope = bundle.name.startsWith('@') ? bundle.name.split('/')[0] : '';
    const linkPath = path.join(profileDir, 'node_modules', ...scope ? [scope, bundle.name.split('/')[1]] : [bundle.name]);
    const link = linkState(linkPath, bundle.directory);
    if (link.state === 'conflict') {
      result.errors.push(`${bundle.name}: ${linkPath} already points elsewhere (${link.target}); left unchanged`);
      continue;
    }
    try {
      if (link.state === 'missing') createLink(bundle.directory, linkPath);
      else if (link.state === 'error') throw new Error(link.reason);
    } catch (error) {
      result.errors.push(`${bundle.name}: cannot link ${linkPath}: ${error.message}`);
      continue;
    }
    bundles.push(bundle.name);
    // Keep the dependency edge in step with the link so a later `pnpm install`
    // in the profile keeps resolving the packaged copy, exactly like a manual
    // install through the plugin manager does.
    if (manifest.dependencies === undefined) manifest.dependencies = {};
    if (isPlainObject(manifest.dependencies) && manifest.dependencies[bundle.name] === undefined) {
      manifest.dependencies[bundle.name] = `link:${toPosix(bundle.directory)}`;
    }
    marker[bundle.name] = { version: bundle.version, seededAt };
    result.added.push(bundle.name);
    changed = true;
  }

  if (!changed) {
    if (markerChanged) {
      try {
        writeJsonAtomic(markerFile, marker);
      } catch (error) {
        result.errors.push(`marker: cannot write ${markerFile}: ${error.message}`);
      }
    }
    log(`nothing to seed (added 0, present ${result.alreadyPresent.length}, skipped ${result.skipped.length})`);
    return result;
  }
  try {
    writeJsonAtomic(manifestFile, manifest);
  } catch (error) {
    result.errors.push(`profile: cannot write ${manifestFile}: ${error.message}`);
    result.added.length = 0;
    return result;
  }
  try {
    writeJsonAtomic(markerFile, marker);
  } catch (error) {
    result.errors.push(`marker: cannot write ${markerFile}: ${error.message}`);
  }
  log(`seeded ${result.added.join(', ') || 'nothing'}`);
  return result;
}

module.exports = { MARKER_FILE, seedBundledPlugins };
