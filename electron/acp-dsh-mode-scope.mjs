// A preset-layer restriction names inherited global registrations only. The
// preset's own native tools become ancestors of an Agent later, so never deny
// their names when removing global add-ons.
export const inject = ['tools'];
export async function apply(ctx, config) {
  const { scopeOf } = await import(config.scopeModule);
  const scope = scopeOf(ctx);
  if (!scope) throw new Error('Minimal tool isolation requires an Agent scope.');
  const native = new Set(['pwsh', 'bash', 'read_image']);
  const masked = new Set();
  const refresh = () => {
    const known = ctx.tools.view(scope).restrictableNames;
    const deny = [...known].filter(name => !native.has(name) && name !== 'run_code' && !masked.has(name));
    if (!deny.length) return;
    for (const name of deny) masked.add(name);
    ctx.tools.restrict({ deny });
  };
  refresh();
  ctx.on('tools/change', refresh, { global: true });
}
