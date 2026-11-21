/** One-way, host-only import into the SAME settings and credentials services as DSH Desktop. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const name = 'somnus-native-migration';
export const inject = ['settings', 'credentials', 'llm', 'agentDefaultModel'];
const APIS = new Set(['openai-responses', 'openai-completions', 'anthropic-messages']);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/;

export function migrationGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row || !MODEL.test(row.model || '') || !APIS.has(row.api || 'openai-completions')) continue;
    const key = typeof row.api_key === 'string' ? row.api_key.trim() : '';
    const authEnv = typeof row.auth_env === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(row.auth_env) ? row.auth_env : undefined;
    if (!key && !authEnv) continue;
    let address;
    try { address = new URL(row.base_url); } catch { continue; }
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password || address.search || address.hash) continue;
    const api = row.api || 'openai-completions';
    const identity = row.group_id || row.id;
    if (typeof identity !== 'string') continue;
    const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 20);
    const provider = 'somnus-import-' + suffix;
    const ref = key ? 'SOMNUS_IMPORTED_' + suffix.toUpperCase() + '_API_KEY' : authEnv;
    const baseURL = row.base_url.replace(/\/(?:chat\/completions|responses|v1\/messages)\/?$/, '').replace(/\/$/, '');
    let group = groups.get(provider);
    if (!group) {
      group = { provider, ref, key, sourceIds: [], profile: { displayName: row.name || 'Imported Provider', api,
        baseURL, apiKeyEnv: ref, models: [] } };
      groups.set(provider, group);
    }
    if (group.key !== key || group.ref !== ref || group.profile.api !== api || group.profile.baseURL !== baseURL) {
      throw new Error('Saved Provider group is inconsistent; original configuration was preserved');
    }
    const efforts = Object.fromEntries((row.reasoning_efforts || []).filter(value => ['none', 'low', 'medium', 'high', 'max'].includes(value))
      .map(value => [value === 'none' ? 'off' : value, value]));
    if (!group.profile.models.some(model => model.id === row.model)) group.profile.models.push({
      id: row.model, name: row.model, contextWindow: row.context_window || (/^deepseek-(?:flash|v4-)/.test(row.model) ? 1000000 : 64000),
      maxTokens: row.max_output_tokens || 16384, input: row.vision_enabled ? ['text', 'image'] : ['text'],
      ...(Object.keys(efforts).length > 1 ? { reasoningEfforts: efforts } : {}),
    });
    group.sourceIds.push({ id: row.id, model: row.model });
  }
  return [...groups.values()];
}

export async function migrateNativeProviders(ctx, sourceFile = process.env.SOMNUS_NATIVE_IMPORT_FILE) {
  if (!sourceFile) return { state: 'not-needed' };
  const markerFile = sourceFile + '.native-dsh-import-v1.json';
  try { if (JSON.parse(await readFile(markerFile, 'utf8')).version === 1) return { state: 'already-imported' }; } catch {}
  let raw;
  try { raw = await readFile(sourceFile); } catch (error) { if (error.code === 'ENOENT') return { state: 'not-needed' }; throw error; }
  if (raw.length > 512 * 1024) throw new Error('Saved Provider configuration exceeds the import limit');
  const saved = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(saved.providers)) throw new Error('Invalid saved Provider configuration');
  const groups = migrationGroups(saved.providers);
  if (!groups.length) return { state: 'not-needed' };
  const initial = ctx.settings.describe().find(row => row.ns === 'llm-pi-ai');
  if (!initial) throw new Error('Native Provider settings are not available for import');
  const hadNativeProviders = Object.keys(initial.value.providers || {}).length > 0;
  // Preserve an unchanged private recovery copy before the first native write.
  try { await writeFile(sourceFile + '.before-native-import.json', raw, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const imported = [];
  for (const group of groups) {
    const view = ctx.settings.describe().find(row => row.ns === 'llm-pi-ai');
    const existing = view?.value.providers?.[group.provider];
    if (!view) throw new Error('Native Provider settings changed during import');
    if (existing) { imported.push(group); continue; }
    if (group.key) await ctx.credentials.set(group.ref, group.key);
    await ctx.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', group.provider], value: group.profile }], view.revision);
    imported.push(group);
  }
  const current = ctx.agentDefaultModel.currentSelection();
  if (!hadNativeProviders || current.provider === 'vvman-company' || !current.model) {
    const chosen = imported.find(group => group.sourceIds.some(row => row.id === saved.active)) || imported[0];
    const model = chosen.sourceIds.find(row => row.id === saved.active)?.model || chosen.profile.models[0].id;
    await ctx.agentDefaultModel.saveSelection({ provider: chosen.provider, model });
  }
  await writeFile(markerFile, JSON.stringify({ version: 1, source_sha256: createHash('sha256').update(raw).digest('hex'),
    imported: imported.map(group => ({ provider: group.provider, sourceIds: group.sourceIds })) }), { flag: 'wx', mode: 0o600 });
  return { state: 'imported', providers: imported.length, models: imported.reduce((sum, group) => sum + group.profile.models.length, 0) };
}

export function apply(ctx) {
  // Settings writes acquire the Loader's configuration transaction. Waiting for
  // them from this plugin's boot apply would prevent that Loader from settling.
  // Match the native SettingsForms legacy-import lifecycle instead.
  let disposed = false;
  ctx.effect(() => () => { disposed = true; });
  void ctx.root.loader.await().then(async () => {
    if (!disposed) await migrateNativeProviders(ctx);
  }).catch(() => {
    if (!disposed) ctx.logger.warn('Saved Provider import could not finish. Original configuration is preserved; native settings remain available.');
  });
}
