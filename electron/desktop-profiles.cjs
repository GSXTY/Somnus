const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT = 'default';
const PROFILE_ID = /^[a-f0-9]{32}$/;
const MAX_PROFILES = 24;
const RUNTIME_PROFILES = { acp: '@deepseek-ai/dsh-acp-app', web: '@deepseek-ai/dsh-web-app' };
const PROFILE_INFO = 'profile-info.json';

function nameFor(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 48 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new Error('请输入 1 至 48 个字符的配置名称。');
  }
  return name;
}

function plainDirectory(folder) {
  const info = fs.lstatSync(folder);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('运行配置目录不可用。');
  return folder;
}

function fileBytes(file, limit = 128 * 1024) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('运行配置文件不可用。');
  return fs.readFileSync(file);
}

function atomicWrite(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, value, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function json(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

class DesktopProfileStore {
  constructor(baseDir, isolatedDefault = false) {
    this.baseDir = path.resolve(baseDir);
    this.folder = path.join(this.baseDir, 'runtime-profiles');
    this.file = path.join(this.baseDir, 'runtime-profiles.json');
    this.isolatedDefault = isolatedDefault;
  }

  initial() {
    return { version: 1, active: DEFAULT, lastHealthy: null, previousHealthy: null, profiles: [] };
  }

  read() {
    let raw;
    try { raw = fileBytes(this.file); } catch (error) {
      if (error.code === 'ENOENT') return this.initial();
      throw error;
    }
    const state = JSON.parse(raw.toString('utf8'));
    const ids = new Set([DEFAULT]);
    if (state?.version !== 1 || !Array.isArray(state.profiles) || state.profiles.length >= MAX_PROFILES) {
      throw new Error('运行配置清单无法读取。');
    }
    for (const row of state.profiles) {
      if (!row || typeof row.id !== 'string' || !PROFILE_ID.test(row.id) || ids.has(row.id)) {
        throw new Error('运行配置清单无法读取。');
      }
      ids.add(row.id);
      nameFor(row.name);
    }
    if (!ids.has(state.active) || [state.lastHealthy, state.previousHealthy].some(id => id !== null && !ids.has(id))) {
      throw new Error('运行配置清单无法读取。');
    }
    return state;
  }

  resolve(id, state = this.read()) {
    if (id === DEFAULT) {
      return {
        id, name: '默认配置', roamingDir: this.baseDir,
        dataDir: this.isolatedDefault ? path.join(this.baseDir, 'data') : undefined,
      };
    }
    const entry = state.profiles.find(row => row.id === id);
    if (!entry) throw new Error('找不到这项运行配置。');
    plainDirectory(this.folder);
    const root = plainDirectory(path.join(this.folder, entry.id));
    return {
      ...entry,
      roamingDir: plainDirectory(path.join(root, 'roaming')),
      dataDir: plainDirectory(path.join(root, 'data')),
    };
  }

  prepare(profile) {
    if (!profile.dataDir || profile.id !== DEFAULT) return;
    fs.mkdirSync(profile.dataDir, { recursive: true });
    plainDirectory(profile.dataDir);
  }

  create(name) {
    name = nameFor(name);
    const state = this.read();
    if (state.profiles.length >= MAX_PROFILES - 1) throw new Error('运行配置已达到数量上限。');
    if (name === '默认配置' || state.profiles.some(row => row.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('已有同名运行配置。');
    }
    fs.mkdirSync(this.folder, { recursive: true });
    plainDirectory(this.folder);
    const id = randomUUID().replaceAll('-', '');
    const root = path.join(this.folder, id);
    fs.mkdirSync(root);
    const roamingDir = path.join(root, 'roaming');
    fs.mkdirSync(path.join(root, 'data'));
    for (const [mode, bundle] of Object.entries(RUNTIME_PROFILES)) {
      const folder = path.join(roamingDir, 'dsh-home', 'profiles', mode);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'package.json'), json({
        name: 'dsh-profile-' + mode, private: true, dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', bundle] } },
      }), { flag: 'wx' });
      for (const entry of ['cordis.yml', 'cordis.patch.yml']) {
        fs.writeFileSync(path.join(folder, entry), '[]\n', { flag: 'wx' });
      }
      fs.writeFileSync(path.join(folder, 'pnpm-workspace.yaml'),
        'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n', { flag: 'wx' });
    }
    fs.writeFileSync(path.join(root, PROFILE_INFO), json({ id, name }), { flag: 'wx' });
    state.profiles.push({ id, name });
    atomicWrite(this.file, json(state));
    return { id, name };
  }

  select(id) {
    const state = this.read();
    const profile = this.resolve(id, state);
    this.prepare(profile);
    if (state.active !== id) atomicWrite(this.file, json({ ...state, active: id }));
    return profile;
  }

  markHealthy(id) {
    const state = this.read();
    if (state.active !== id || state.lastHealthy === id) return;
    atomicWrite(this.file, json({ ...state, previousHealthy: state.lastHealthy, lastHealthy: id }));
  }

  rollbackTarget(state = this.read()) {
    for (const id of [state.lastHealthy, state.previousHealthy, DEFAULT]) {
      if (!id || id === state.active) continue;
      try { this.resolve(id, state); return id; } catch {}
    }
    return null;
  }

  resetRegistry() {
    const state = this.initial();
    let entries;
    try { entries = fs.readdirSync(plainDirectory(this.folder), { withFileTypes: true }); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROFILE_ID.test(entry.name)) continue;
      const root = path.join(this.folder, entry.name);
      try {
        plainDirectory(path.join(root, 'roaming'));
        plainDirectory(path.join(root, 'data'));
      } catch { continue; }
      let name = '恢复配置 ' + entry.name.slice(0, 8);
      try {
        const info = JSON.parse(fileBytes(path.join(root, PROFILE_INFO)).toString('utf8'));
        if (info.id === entry.name) name = nameFor(info.name);
      } catch {}
      state.profiles.push({ id: entry.name, name });
    }
    if (state.profiles.length >= MAX_PROFILES) throw new Error('恢复目录超出配置清单上限。');
    const destination = path.join(this.baseDir, 'runtime-profiles.invalid-' + randomUUID() + '.json');
    fs.renameSync(this.file, destination);
    try { atomicWrite(this.file, json(state)); } catch (error) {
      fs.renameSync(destination, this.file);
      throw error;
    }
  }
}

module.exports = { DesktopProfileStore, DEFAULT, atomicWrite, fileBytes, plainDirectory, RUNTIME_PROFILES };
