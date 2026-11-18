const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { defaultDesktopConnection, desktopExecutable } = require('./acp-desktop-mcp-default.cjs');

const CONNECTOR = '@deepseek-ai/dsh-mcp-client';
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/i;

function listConnections(entries, inventory, executable) {
  const connections = [];
  const walk = (rows, parents = [], inheritedDisabled = false) => {
    if (!Array.isArray(rows) || parents.length > 12) return;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !SAFE_ID.test(row.id ?? '')) continue;
      const disabled = inheritedDisabled || row.disabled === true;
      const address = [...parents, row.id];
      const config = row.config;
      if (row.group === true) walk(config, address, disabled);
      if (row.name === '@deepseek-ai/dsh-agent-preset') walk(config?.plugins, address, disabled);
      if (row.name !== CONNECTOR || !SAFE_ID.test(config?.serverName ?? '') ||
          !['stdio', 'streamable-http'].includes(config.transport) || connections.length >= 120) continue;
      const active = inventory?.filter(entry => entry.moduleName === CONNECTOR &&
        entry.entryId?.split(':').at(-1) === row.id) ?? [];
      const runtime = active.length === 1 ? active[0] : undefined;
      connections.push({
        id: address.join('/'), name: config.serverName, transport: config.transport,
        ...(defaultDesktopConnection(config, executable) ? { builtin: true, runtime_managed: true } : {}),
        enabled: !disabled && runtime?.enabled !== false,
        status: disabled || runtime?.enabled === false ? 'disabled'
          : runtime?.fiberPhase === 'active' ? 'active'
          : runtime?.fiberPhase === 'failed' ? 'error' : 'configured',
      });
    }
  };
  walk(entries);
  return connections;
}

async function readDshMcpInventory(market, validate) {
  const [web, boot, anchor] = await Promise.all([
    market.webProfile(),
    market.runtimeFile('@deepseek-ai/dsh-app-boot', 'lib/index.js'),
    market.runtimeFile('@deepseek-ai/dsh', 'package.json'),
  ]);
  if (!web || !boot || !anchor) return { connections: [] };
  validate();
  let entries;
  try {
    const loader = await import(pathToFileURL(boot).href);
    const profileDir = path.dirname(web.file);
    const layers = [];
    // Use DSH's read-only resolution and composition helpers. The CLI dump
    // prepares the profile and can rewrite its root file even for a read.
    const exemptions = loader.readProfileVersionExemptions(profileDir);
    for (const bundle of web.bundles) {
      try {
        const folder = loader.resolveBundleDir('dsh', bundle, anchor, profileDir);
        const manifest = loader.readProfileManifest('dsh', folder);
        loader.assertBundlePlatform(manifest.dsh.bundle.platforms, process.platform);
        const issue = loader.evaluatePluginCompatibility(manifest, exemptions);
        if (issue && !issue.exempted) continue;
        for (const file of loader.bundlePatchPaths(folder, manifest.dsh.bundle)) {
          layers.push(loader.loadOverlayPatches('dsh', file));
        }
      } catch { /* invalid bundles are skipped by the native loader too */ }
    }
    layers.push(loader.loadOptionalPatches('dsh', path.join(profileDir, 'cordis.patch.yml')) ?? []);
    layers.push(loader.loadOptionalPatches('dsh', path.join(market.home, 'cordis.patch.yml')) ?? []);
    entries = loader.composeEntries(layers);
  } catch {
    throw new Error('无法解析托管 DSH Web 的 MCP 配置。');
  }
  if (!Array.isArray(entries)) throw new Error('DSH Web 配置清单不完整。');
  const server = market.settingsServer;
  const inventory = server?.child ? await market.account.request(server, 'pluginInventory/list').catch(() => null) : null;
  validate();
  return { connections: listConnections(entries, inventory?.entries,
    await desktopExecutable(market.profileDir, market.resourcesPath)) };
}

module.exports = { listConnections, readDshMcpInventory };
