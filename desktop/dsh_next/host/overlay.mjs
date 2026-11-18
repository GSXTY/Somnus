import { readFileSync } from 'node:fs';

const HOST = 'apps/desktop-host/src/index.ts';
const ADAPTER = 'apps/desktop-host/src/somnus-host-adapter.mjs';

function replaceOnce(source, anchor, replacement) {
  const parts = source.split(anchor);
  if (parts.length !== 2) throw new Error(`Pinned DSH NEXT Host anchor changed: ${anchor}`);
  return parts.join(replacement);
}

export function buildHostOverlay(readPinned) {
  let host = readPinned(HOST).toString('utf8');
  const importAnchor = "import { runProfile } from '@deepseek-ai/dsh/profile-boot'";
  host = replaceOnce(host, importAnchor, `${importAnchor}\nimport { prepareSomnusHost } from './somnus-host-adapter.mjs'`);
  host = replaceOnce(host, "  const application = runProfile({\n    environment: loadLayeredEnv('dsh'),",
    `  const somnusOrigin = process.env.DSH_SOMNUS_BRIDGE_ORIGIN
  const somnusToken = process.env.DSH_SOMNUS_BRIDGE_TOKEN
  const legacyProfileDir = process.env.DSH_SOMNUS_LEGACY_PROFILE
  delete process.env.DSH_SOMNUS_BRIDGE_ORIGIN
  delete process.env.DSH_SOMNUS_BRIDGE_TOKEN
  delete process.env.DSH_SOMNUS_LEGACY_PROFILE
  if ((somnusOrigin === undefined) !== (somnusToken === undefined)) throw new Error('Incomplete Somnus Host bootstrap')
  const somnus = somnusOrigin !== undefined && somnusToken !== undefined
    ? await prepareSomnusHost({ origin: somnusOrigin, token: somnusToken, legacyProfileDir }) : undefined
  Object.assign(process.env, somnus?.env)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),`);
  host = replaceOnce(host, '    patchFiles: [],', '    patchFiles: somnus ? [somnus.patchFile] : [],');
  host = replaceOnce(host, '  })\n  let stopping: Promise<void> | undefined',
    `  }).catch(async (error: unknown) => {
    await somnus?.dispose()
    throw error
  })
  let stopping: Promise<void> | undefined`);
  host = replaceOnce(host, '    await running?.shutdown.shutdown(0)',
    `    try { await running?.shutdown.shutdown(0) }
    finally { await somnus?.dispose() }`);
  const typeSource = `export function prepareSomnusHost(options: {
  origin: string;
  token: string;
  legacyProfileDir?: string | undefined;
}): Promise<{ patchFile: string; env: Record<string, string>; dispose: () => Promise<void> }>;
`;
  return new Map([
    [HOST, Buffer.from(host)],
    [ADAPTER, readFileSync(new URL('../../../electron/dsh-next-host-adapter.mjs', import.meta.url))],
    [ADAPTER.replace(/\.mjs$/, '.d.mts'), Buffer.from(typeSource)],
  ]);
}
