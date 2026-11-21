const MODE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const { mkdir, realpath, lstat, writeFile, rename, unlink } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const KNOWN = {
  standard: ['Standard mode', '通用工具、文件、搜索与任务协作。'],
  ptc: ['PTC mode', '程序化批量调用工具，保留逐项权限和审批。'],
  minimal: ['Minimal mode', '精简原生终端和图片工具；数据查询与扩展工具请使用 Standard 或 PTC。'],
  cordis: ['Creator mode', '开发插件与组合工作模式；写入仍遵守当前文件权限。'],
};
function modeId(value) { return typeof value === 'string' && MODE.test(value); }
function catalog(value) {
  if (!Array.isArray(value?.presets)) throw new Error('DSH 未返回工作模式清单。');
  const seen = new Set();
  return value.presets.slice(0, 80).flatMap(row => {
    if (!modeId(row?.id) || seen.has(row.id)) return [];
    seen.add(row.id);
    const known = KNOWN[row.id];
    return [{ id: row.id, name: known?.[0] || (typeof row.name === 'string' ? row.name.slice(0, 120) : row.id),
      description: known?.[1] || (typeof row.description === 'string' ? row.description.slice(0, 300) : '此运行时提供的工作模式。'),
      isDefault: row.isDefault === true, available: !row.broken,
      ...(row.broken ? { reason: '此工作模式未能加载，请检查运行时或插件配置。' } : {}) }];
  });
}
function projectionMode(projection) {
  const value = projection?.values?.agentPreset;
  return modeId(value) ? value : null;
}
function runtimeStarted(projection) {
  const timing = projection?.values?.subagentTiming;
  return timing?.active === true || timing?.lastTurnCompleted !== undefined;
}
async function transactionFile(home, conversationId) {
  if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(conversationId)) throw new Error('无效的会话。');
  const root = await realpath(home);
  const folder = path.join(root, 'somnus-mode-transactions');
  await mkdir(folder, { recursive: true });
  if (await realpath(folder) !== folder) throw new Error('工作模式恢复目录无效。');
  return path.join(folder, conversationId + '.json');
}
async function pendingMode(home, conversationId) {
  const file = await transactionFile(home, conversationId);
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function beginMode(home, conversationId, selected, previous) {
  const file = await transactionFile(home, conversationId);
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify({ selected, previous, createdAt: Date.now() }), { flag: 'wx', mode: 0o600 });
  try { await rename(temporary, file); } finally { await unlink(temporary).catch(() => {}); }
}
async function finishMode(home, conversationId) {
  await unlink(await transactionFile(home, conversationId)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
module.exports = { modeId, catalog, projectionMode, runtimeStarted, pendingMode, beginMode, finishMode };
