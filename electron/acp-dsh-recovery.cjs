const { randomUUID } = require('node:crypto');
const { mkdir, open, readdir, realpath, rename, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');

const ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const MAX_BYTES = 256 * 1024;
const MAX_DRAFT_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_QUESTIONS = 100;

async function folder(home, names, create) {
  let root = await realpath(home);
  for (const name of names) {
    root = path.join(root, name);
    if (create) await mkdir(root, { recursive: true });
    if ((await realpath(root)).toLowerCase() !== root.toLowerCase()) throw new Error('本地保存目录无效。');
  }
  return root;
}

async function read(file, limit = MAX_BYTES) {
  if ((await realpath(file)).toLowerCase() !== file.toLowerCase()) return null;
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size > limit) return null;
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer);
    return bytesRead === size ? buffer : null;
  } finally {
    await handle.close();
  }
}

async function write(file, data, limit = MAX_BYTES) {
  if (Buffer.byteLength(data) > limit) throw new Error('本地草稿超出大小限制。');
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function validQuestion(record, cid, rid) {
  return record?.conversationId === cid && record.requestId === rid && ID.test(record.turnId ?? '') &&
    new RegExp('^somnus-' + cid + '-[a-f0-9]{12}$').test(record.sessionId ?? '') &&
    typeof record.callId === 'string' && record.callId.length > 0 && record.callId.length <= 256;
}

async function rememberQuestion(home, record) {
  if (!ID.test(record.conversationId) || !ID.test(record.requestId) ||
      !validQuestion(record, record.conversationId, record.requestId)) return;
  const root = await folder(home, ['somnus-questions', record.conversationId], true);
  await write(path.join(root, record.requestId + '.json'), JSON.stringify(record));
}

async function forgetQuestion(home, cid, rid) {
  if (!ID.test(cid) || !ID.test(rid)) return;
  try {
    const root = await folder(home, ['somnus-questions', cid], false);
    await unlink(path.join(root, rid + '.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function savedQuestions(home, cid) {
  if (!ID.test(cid)) return [];
  try {
    const root = await folder(home, ['somnus-questions', cid], false);
    const files = (await readdir(root)).filter(name => name.endsWith('.json') && ID.test(name.slice(0, -5)));
    const output = [];
    for (const file of files.slice(-MAX_QUESTIONS)) {
      try {
        const buffer = await read(path.join(root, file));
        const entry = buffer && JSON.parse(buffer.toString('utf8'));
        if (validQuestion(entry, cid, file.slice(0, -5))) output.push(entry);
      } catch { /* Ignore an incomplete or unreadable record. */ }
    }
    return output;
  } catch {
    return [];
  }
}

function boundedText(value, limit) {
  return typeof value === 'string' && value.length <= limit && !value.includes('\0');
}

function draftImages(images) {
  if (!Array.isArray(images) || images.length > 4) throw new Error('图片草稿数量超过限制。');
  let total = 0;
  return images.map(({ name, data_url, width, height } = {}) => {
    if (!boundedText(name, 255) || !boundedText(data_url, MAX_IMAGE_BYTES * 4 / 3 + 128) ||
        ![width, height].every(i => Number.isSafeInteger(i) && i > 0 && i <= 8192) ||
        width * height > 16_000_000) throw new Error('图片草稿不符合尺寸或大小限制。');
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data_url);
    if (!match || match[2].length % 4 !== 0) throw new Error('草稿仅支持本地 PNG、JPEG 或 WebP 图片。');
    const [, mime, encoded] = match;
    const prefix = Buffer.from(encoded.slice(0, 16), 'base64');
    const signature = mime === 'image/png' ? prefix.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      : mime === 'image/jpeg' ? prefix.subarray(0, 3).toString('hex') === 'ffd8ff'
        : prefix.toString('ascii', 0, 4) === 'RIFF' && prefix.toString('ascii', 8, 12) === 'WEBP';
    const size = Buffer.byteLength(encoded, 'base64');
    total += size;
    if (!signature || size > MAX_IMAGE_BYTES || total > 2 * MAX_IMAGE_BYTES) throw new Error('图片草稿超出大小限制或格式无效。');
    return { name, data_url, mime, width, height, size };
  });
}

function draftReference(value, table) {
  if (!value || typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id) || !boundedText(value.name, 255)) {
    throw new Error('附件草稿引用无效。');
  }
  const { id, name } = value;
  const count = table ? value.row_count : value.chars;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('附件草稿内容无效。');
  if (table) {
    if (!Array.isArray(value.columns) || value.columns.length > 512 || !value.columns.every(column => boundedText(column, 500))) {
      throw new Error('表格草稿字段超出限制。');
    }
    return { id, name, row_count: count, columns: value.columns, ...(value.acpOnly === true ? { acpOnly: true } : {}) };
  }
  if (!boundedText(value.kind, 40) || (value.note != null && !boundedText(value.note, 1000))) throw new Error('文档草稿类型无效。');
  return { id, name, kind: value.kind, chars: count, ...(typeof value.note === 'string' ? { note: value.note } : {}) };
}

function composerReferences(values, textLength) {
  if (!Array.isArray(values) || values.length > 12) throw new Error('引用数量无效。');
  let total = 0;
  const ids = new Set();
  return values.map(({ id, kind, label, offset, text, fileId } = {}) => {
    if (!boundedText(id, 128) || !id || ids.has(id) || !['conversation', 'quote', 'file'].includes(kind) ||
        !boundedText(label, 255) || !Number.isSafeInteger(offset) || offset < 0 || offset > textLength ||
        (text != null && !boundedText(text, 12_000)) || (fileId != null && (typeof fileId !== 'string' || !/^[a-f0-9]{32}$/.test(fileId)))) {
      throw new Error('引用格式无效。');
    }
    ids.add(id);
    total += (text?.length || 0) + label.length;
    if (total > 24_000) throw new Error('引用内容超出长度限制。');
    return { id, kind, label, offset, ...(typeof text === 'string' ? { text } : {}), ...(fileId ? { fileId } : {}) };
  });
}

function draftShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本地草稿格式无效。');
  const { text, questionId, answers, attachments, docFile, dataFile, composerBlocks } = value;
  if (text != null && (typeof text !== 'string' || text.length > 12_000)) throw new Error('草稿文字过长。');
  if (questionId != null && (typeof questionId !== 'string' || !ID.test(questionId))) throw new Error('问题编号无效。');
  if (answers != null && (!questionId || !Array.isArray(answers) || answers.length > 12 || answers.some(row =>
    typeof row?.id !== 'string' || row.id.length > 128 || !Array.isArray(row.selected) || row.selected.length > 30 ||
    row.selected.some(item => typeof item !== 'string' || item.length > 500) ||
    (row.custom != null && (typeof row.custom !== 'string' || row.custom.length > 8000))))) throw new Error('回答草稿无效。');
  return { ...(typeof text === 'string' ? { text } : {}), ...(questionId ? { questionId } : {}),
    ...(composerBlocks != null ? { composerBlocks: composerReferences(composerBlocks, text?.length || 0) } : {}),
    ...(answers ? { answers: answers.map(({ id, selected, custom }) => ({ id, selected, custom })) } : {}),
    ...(attachments ? { attachments: draftImages(attachments) } : {}),
    ...(docFile ? { docFile: draftReference(docFile, false) } : {}),
    ...(dataFile ? { dataFile: draftReference(dataFile, true) } : {}) };
}

function draftKey(id) {
  if (typeof id !== 'string') return null;
  if (ID.test(id)) return id;
  const workspace = /^workspace:(default|ws_[a-zA-Z0-9_-]{1,60})$/.exec(id);
  return workspace ? 'workspace-' + workspace[1] : null;
}

function encryptedStore(home, storage, directory, keyFor, shape) {
  const writes = new Map();
  async function save(cid, value) {
    const root = await folder(home, [directory], true);
    const file = path.join(root, cid + '.bin');
    if (value !== null) return write(file, storage.encryptString(JSON.stringify(shape(value))), MAX_DRAFT_BYTES);
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return {
    async read(cid) {
      cid = keyFor(cid);
      if (!cid || !storage.isEncryptionAvailable()) return null;
      try {
        await writes.get(cid)?.catch(() => {});
        const root = await folder(home, [directory], false);
        const bytes = await read(path.join(root, cid + '.bin'), MAX_DRAFT_BYTES);
        return bytes && shape(JSON.parse(storage.decryptString(bytes)));
      } catch {
        return null;
      }
    },
    async save(cid, value) {
      cid = keyFor(cid);
      if (!cid) throw new Error('草稿所属会话无效。');
      if (!storage.isEncryptionAvailable()) throw new Error('本机加密存储不可用，无法保存草稿。');
      const task = (writes.get(cid) ?? Promise.resolve()).catch(() => {}).then(() => save(cid, value));
      writes.set(cid, task);
      try {
        await task;
      } finally {
        if (writes.get(cid) === task) writes.delete(cid);
      }
    },
  };
}

function draftStore(home, storage) {
  return encryptedStore(home, storage, 'somnus-drafts', draftKey, draftShape);
}

function queueOptions(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('排队消息连接信息无效。');
  const result = {};
  for (const key of fields) {
    if (value[key] == null) continue;
    if (!boundedText(value[key], 200) || /[\x00-\x1f\x7f]/.test(value[key])) throw new Error('排队消息连接信息无效。');
    result[key] = value[key];
  }
  return result;
}

function queueIds(value) {
  if (!Array.isArray(value) || value.length > 30 ||
      value.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) throw new Error('排队消息的扩展标识无效。');
  return [...new Set(value)];
}

function queueShape(values) {
  if (!Array.isArray(values) || values.length > 16) throw new Error('每个会话最多保存 16 条排队消息。');
  const ids = new Set();
  return values.map(item => {
    if (typeof item?.id !== 'string' || !/^[a-f0-9]{32}$/.test(item.id) || ids.has(item.id) ||
        !['read_only', 'workspace_write', 'full'].includes(item.permission)) throw new Error('排队消息格式无效。');
    ids.add(item.id);
    const draft = draftShape(item.draft);
    delete draft.answers;
    delete draft.questionId;
    for (const key of ['skillIds', 'pluginIds']) {
      if (item.draft[key] != null) draft[key] = queueIds(item.draft[key]);
    }
    const route = queueOptions(item.route, ['modelId', 'effort', 'reasoningEffort']);
    route.nativeDsh = item.route.nativeDsh === true;
    if (item.route.agent != null) {
      route.agent = queueOptions(item.route.agent, ['agentId', 'agentName', 'modelId', 'modelName']);
      if (!ID.test(route.agent.agentId ?? '') || !route.agent.agentName) throw new Error('排队消息的 Agent 无效。');
    }
    if (item.route.companyOptions != null) {
      route.companyOptions = queueOptions(item.route.companyOptions, ['model', 'effort']);
      if (!route.companyOptions.model) throw new Error('排队消息的公司模型无效。');
    }
    return { id: item.id, draft, route, permission: item.permission };
  });
}

function steerReceipt(value) {
  if (!value || !ID.test(value.turnId ?? '') || !/^[a-f0-9]{32}$/.test(value.steerId ?? '') ||
      !Array.isArray(value.queueIds) || value.queueIds.length < 1 || value.queueIds.length > 8 ||
      queueIds(value.queueIds).length !== value.queueIds.length) throw new Error('无效的队列引导记录。');
  return { turnId: value.turnId, steerId: value.steerId, queueIds: value.queueIds };
}

function queueState(value) {
  if (Array.isArray(value)) return { items: queueShape(value), receipts: [] };
  if (!Array.isArray(value?.receipts) || value.receipts.length > 16) throw new Error('无效的队列状态。');
  return { items: queueShape(value.items), receipts: value.receipts.map(steerReceipt),
    ...(value.pending ? { pending: steerReceipt(value.pending) } : {}) };
}

function queueStore(home, storage) {
  const key = id => typeof id === 'string' && ID.test(id) ? id : null;
  const file = encryptedStore(home, storage, 'somnus-queues', key, queueState);
  const pending = new Map();
  function operate(id, operation) {
    if (!key(id)) throw new Error('会话标识无效。');
    const task = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const state = await file.read(id) ?? { items: [], receipts: [] };
      return operation(state, value => file.save(id,
        value.items.length || value.receipts.length || value.pending ? value : null));
    });
    pending.set(id, task);
    return task.finally(() => { if (pending.get(id) === task) pending.delete(id); });
  }
  return {
    operate,
    read: id => key(id) ? operate(id, state => state.items.length ? state.items : null) : Promise.resolve(null),
    save: (id, items) => operate(id, (state, save) => save({ ...state, items: items ?? [] })),
  };
}

module.exports = { ID, rememberQuestion, forgetQuestion, savedQuestions, draftStore, queueStore };
