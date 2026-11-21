const { createHash, randomUUID } = require('node:crypto');
const { mkdir, realpath, lstat, readdir, readFile, writeFile, rename, unlink } = require('node:fs/promises');
const path = require('node:path');
const MAX_BYTES = 2 * 1024 * 1024, MAX_RESULTS = 32, TTL = 7 * 86400000;
class ResultOutbox {
  constructor(home, storage) { this.home = home; this.storage = storage; this.memory = new Map(); }
  durable() { try { return Boolean(this.home && this.storage?.isEncryptionAvailable()); } catch { return false; } }
  key(route, ownerId) { return createHash('sha256').update(route.conversationId + '\0' + route.taskId + '\0' + ownerId).digest('hex'); }
  async folder() {
    const root = await realpath(this.home), folder = path.join(root, 'runtime-results');
    await mkdir(folder, { recursive: true });
    if (await realpath(folder) !== folder) throw new Error('任务结果恢复目录无效。');
    return folder;
  }
  async save(route, body, kind = 'finish') {
    const key = this.key(route, body.owner_id), row = { key, kind, route, body, createdAt: Date.now() };
    if (this.memory.size >= MAX_RESULTS && !this.memory.has(key)) throw new Error('待同步任务结果已达上限。请先恢复本机服务。');
    const text = JSON.stringify(row);
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('任务结果过大，无法加入恢复缓存。');
    this.memory.set(key, row);
    if (this.durable() && (body.finish_receipt || kind === 'abandon')) {
      const folder = await this.folder();
      const names = (await readdir(folder)).filter(name => /^[a-f0-9]{64}\.bin$/.test(name));
      if (names.length >= MAX_RESULTS && !names.includes(key + '.bin')) throw new Error('加密结果恢复缓存已满。');
      const temporary = path.join(folder, key + '.' + randomUUID() + '.tmp');
      await writeFile(temporary, this.storage.encryptString(text), { flag: 'wx', mode: 0o600 });
      try { await rename(temporary, path.join(folder, key + '.bin')); }
      finally { await unlink(temporary).catch(() => {}); }
    }
    return row;
  }
  async list() {
    if (this.durable()) {
      const folder = await this.folder();
      for (const name of (await readdir(folder)).filter(name => /^[a-f0-9]{64}\.bin$/.test(name)).slice(0, MAX_RESULTS)) {
        try {
          const file = path.join(folder, name), info = await lstat(file);
          if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES * 2) continue;
          const text = this.storage.decryptString(await readFile(file));
          if (Buffer.byteLength(text) > MAX_BYTES) continue;
          const row = JSON.parse(text);
          if (!row || row.key + '.bin' !== name || this.key(row.route, row.body?.owner_id) !== row.key ||
              !(row.kind === 'abandon' || ['complete', 'error', 'cancelled'].includes(row.body?.status) && typeof row.body?.finish_receipt === 'string') ||
              !Number.isFinite(row.createdAt)) continue;
          if (Date.now() - row.createdAt > TTL) { await unlink(file); this.memory.delete(row.key); continue; }
          this.memory.set(row.key, row);
        } catch { /* Invalid encrypted entries do not become executable requests. */ }
      }
    }
    return [...this.memory.values()].filter(row => Date.now() - row.createdAt <= TTL);
  }
  async remove(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('无效的结果缓存标识。');
    this.memory.delete(key);
    if (this.durable()) await unlink(path.join(await this.folder(), key + '.bin')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
module.exports = { ResultOutbox };
