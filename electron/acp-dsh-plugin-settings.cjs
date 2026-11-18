const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const FIELD = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const SENSITIVE = /secret|token|password|credentials?|apikey|accesskey|authorization|privatekey/i;
const OFFICIAL = new Map([
  ['badge-skill', '@deepseek-ai/dsh-experimental-badge-skill-bundle'],
  ['@deepseek-ai/dsh-personalized-recommendations', '@deepseek-ai/dsh-personalized-recommendations'],
]);

function scalar(value) {
  return typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);
}

function safeKey(key) {
  return FIELD.test(key) && !SENSITIVE.test(key.replace(/[-_]/g, '')) && key !== 'constructor' && key !== 'prototype';
}

function jsonShape(value, depth = 0) {
  if (depth > 12) return false;
  if (value === null || scalar(value)) return true;
  if (Array.isArray(value)) return value.length <= 120 && value.every(item => jsonShape(item, depth + 1));
  return Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
    Object.entries(value).length <= 100 &&
    Object.entries(value).every(([key, item]) => safeKey(key) && jsonShape(item, depth + 1)));
}

function safeNestedSchema(refs, id, depth = 0) {
  const node = refs[id];
  if (!node || depth > 12 || node.meta?.role === 'secret' || node.meta?.hidden === true) return false;
  if (['string', 'number', 'boolean', 'const'].includes(node.type)) return true;
  if (node.type === 'object' && node.dict) {
    return Object.entries(node.dict).every(([key, ref]) => safeKey(key) && safeNestedSchema(refs, ref, depth + 1));
  }
  if (node.type === 'array') return safeNestedSchema(refs, node.inner, depth + 1);
  if (['union', 'tuple', 'intersect'].includes(node.type) && Array.isArray(node.list)) {
    return node.list.every(ref => safeNestedSchema(refs, ref, depth + 1));
  }
  return false;
}

function section(row) {
  const envelope = row.schema;
  const root = envelope?.refs?.[envelope.uid];
  if (root?.type !== 'object' || !root.dict || !Array.isArray(row.secrets) ||
      !Number.isSafeInteger(row.revision)) return null;
  const secretKeys = new Set(row.secrets.map(secret => secret.path?.[0]));
  const fields = [];
  for (const [key, ref] of Object.entries(root.dict)) {
    if (!safeKey(key) || secretKeys.has(key)) continue;
    const node = envelope.refs[ref];
    const meta = node?.meta;
    if (meta?.role === 'secret' || meta?.hidden === true) continue;
    let type = node?.type;
    let options;
    if (type === 'union' && Array.isArray(node.list)) {
      options = node.list.map(id => envelope.refs[id]).map(item => item?.type === 'const' ? item.value : undefined);
      if (options.length && options.length <= 100 && options.every(scalar)) type = 'enum';
      else if (safeNestedSchema(envelope.refs, ref)) { type = 'json'; options = undefined; }
      else continue;
    }
    if (['array', 'object', 'tuple', 'intersect'].includes(type) && safeNestedSchema(envelope.refs, ref)) type = 'json';
    if (!['number', 'boolean', 'string', 'enum', 'json'].includes(type)) continue;
    const value = row.value?.[key];
    const field = { key, type, overridden: Object.hasOwn(row.user ?? {}, key) };
    if (scalar(value)) field.value = value;
    if (type === 'json' && jsonShape(value) && JSON.stringify(value).length <= 32_000) field.value = value;
    if (options) field.options = options;
    if (typeof meta?.description === 'string') field.description = meta.description.slice(0, 500);
    for (const limit of ['min', 'max', 'step']) {
      if (Number.isFinite(meta?.[limit])) field[limit] = meta[limit];
    }
    fields.push(field);
    if (fields.length >= 50) break;
  }
  return fields.length ? { id: row.ns, revision: row.revision, fields } : null;
}

function createDshPluginSettings(market) {
  async function read(id, source, validate) {
    if (source === 'official' && typeof id === 'string' && PACKAGE.test(id) && !OFFICIAL.has(id)) {
      return { writable: false, sections: [] };
    }
    const packageName = source === 'official' ? OFFICIAL.get(id) : source === 'community' ? id : undefined;
    if (typeof packageName !== 'string' || packageName.length > 180 || !PACKAGE.test(packageName) ||
        (source === 'community' && packageName.startsWith('@deepseek-ai/'))) throw new Error('无效的 DSH 插件。');
    const profile = await market.webProfile();
    if (!profile?.bundles.includes(packageName)) return { writable: false, sections: [] };
    const server = await market.settings(validate);
    const rpc = (method, args = {}) => market.account.request(server, method, args, AbortSignal.timeout(8000));
    const [inventory, settings] = await Promise.all([rpc('pluginInventory/list'), rpc('settings/describe')]);
    validate();
    const namespaces = new Map();
    for (const entry of inventory?.entries ?? []) {
      if (!entry.enabled || entry.fiberPhase !== 'active' || typeof entry.entryId !== 'string') continue;
      const namespace = entry.entryId.split(':').at(-1);
      namespaces.set(namespace, namespaces.has(namespace) ? null : entry.moduleName);
    }
    const sections = (settings?.namespaces ?? []).filter(row => row.autoGenerate === true && namespaces.get(row.ns) === packageName)
      .slice(0, 20).map(section).filter(Boolean);
    return { writable: settings?.writable === true && sections.length > 0, sections, rpc };
  }

  async function publicRead(id, source, validate) {
    const { writable, sections } = await read(id, source, validate);
    return { writable, sections };
  }

  async function save(id, source, sectionId, revision, edits, validate) {
    if (typeof sectionId !== 'string' || !Number.isSafeInteger(revision) ||
        !Array.isArray(edits) || !edits.length || edits.length > 50) throw new Error('无效的插件设置。');
    const saved = await read(id, source, validate);
    const selected = saved.sections.find(item => item.id === sectionId);
    if (!saved.writable || !selected) throw new Error('这个插件的设置不可编辑。');
    if (revision !== selected.revision) throw new Error('插件设置已更新，请重新打开后修改。');
    const keys = new Set();
    const ops = edits.map(edit => {
      const field = selected.fields.find(item => edit?.key === item.key);
      if (!field || keys.has(field.key)) throw new Error('这个插件设置项不可编辑。');
      keys.add(field.key);
      const path = [field.key];
      if (!Object.hasOwn(edit, 'value')) return { op: 'unset', path };
      const { value } = edit;
      const valid = field.type === 'enum' ? field.options.includes(value)
        : field.type === 'json' ? jsonShape(value) && JSON.stringify(value).length <= 32_000
        : field.type === typeof value && scalar(value) && (typeof value !== 'string' || value.length <= 4000);
      if (!valid) throw new Error('插件设置值无效。');
      return { op: 'set', path, value };
    });
    validate();
    let updated;
    try {
      updated = await saved.rpc('settings/mutate', { ns: sectionId, expectedRevision: revision, ops });
    } catch {
      throw new Error('插件设置未保存，请重新打开并核对输入。');
    }
    return { writable: saved.writable, sections: saved.sections.map(item => item === selected ? section(updated) : item).filter(Boolean) };
  }
  return { read: publicRead, save };
}

module.exports = { createDshPluginSettings };
