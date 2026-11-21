/** Only explicitly configured Providers participate in native model selection. */
export const name = 'somnus-provider-policy';
export const inject = ['llm', 'agentDefaultModel'];
const BUILTIN = new Set(['deepseek-official', 'deepseek-account', 'vvman-company']);
const external = id => id === 'somnus-codex' || id === 'somnus-codebuddy' || id.startsWith('somnus-acp-');
export async function repairNativeDefault(ctx) {
  const current = ctx.agentDefaultModel.currentSelection();
  if (current.provider && current.model && !BUILTIN.has(current.provider)) return;
  let selected = { provider: '', model: '' };
  for (const provider of ctx.llm.listProviders()) {
    if (BUILTIN.has(provider.id) || external(provider.id)) continue;
    let models;
    try { models = await ctx.llm.listModels(provider.id); } catch { continue; }
    if (models.length) { selected = { provider: provider.id, model: models[0].id }; break; }
  }
  const latest = ctx.agentDefaultModel.currentSelection();
  if (latest.provider !== current.provider || latest.model !== current.model) return;
  if (current.provider !== selected.provider || current.model !== selected.model) {
    await ctx.agentDefaultModel.saveSelection(selected);
  }
}
export function apply(ctx) {
  let ready = false, disposed = false, running, pending = false;
  const refresh = () => {
    if (!ready || disposed) return;
    if (running) { pending = true; return; }
    running = repairNativeDefault(ctx).catch(() => ctx.logger.warn('Native Provider selection could not be refreshed.'))
      .finally(() => { running = undefined; if (pending) { pending = false; refresh(); } });
  };
  ctx.on('llm/adapters-updated', refresh); ctx.on('llm/models-updated', refresh);
  ctx.effect(() => () => { disposed = true; });
  // Settings writes are forbidden during this plugin's own Loader apply.
  void ctx.root.loader.await().then(() => { ready = true; refresh(); }).catch(() => {});
}
