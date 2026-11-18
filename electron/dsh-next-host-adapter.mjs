import { lstat, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TOKEN = /^[a-f0-9]{64}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/;
const CONVERSATION = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const DATA_VARIABLES = new Map([
  ['database', 'DSH_SOMNUS_NEXT_DATABASE_TOKEN'],
  ['text-to-sql', 'DSH_SOMNUS_NEXT_TEXT_TO_SQL_TOKEN'],
]);
const DATA_ENTRY_IDS = new Set([...DATA_VARIABLES.keys()].map(name => 'somnus-' + name));
const MCP_CONNECTOR = '@deepseek-ai/dsh-mcp-client';
const MCP_MANAGER = '@deepseek-ai/dsh-mcp-manager';
const PROVIDER = 'vvman-company';
const PROVIDER_TOKEN = 'DSH_SOMNUS_NEXT_MODEL_TOKEN';
const LIMITS = new Set(['none', 'low', 'high', 'max']);

function mcpName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replaceAll('_', '-') : '';
}

export function protectDataPatches(rows) {
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [row];
    if (DATA_ENTRY_IDS.has(mcpName(row.id)) ||
        ((row.name === MCP_CONNECTOR || row.name === undefined) &&
          DATA_VARIABLES.has(mcpName(row.config?.serverName)))) return [];
    const copy = { ...row };
    if (Array.isArray(row.insert)) {
      copy.insert = protectDataPatches(row.insert);
      if (copy.insert.length === 0 && row.insert.length > 0) return [];
    }
    if (Array.isArray(row.config)) {
      copy.config = protectDataPatches(row.config);
    } else if (row.config && typeof row.config === 'object') {
      if (Array.isArray(row.config.plugins)) copy.config = { ...row.config, plugins: protectDataPatches(row.config.plugins) };
      if ((row.name === MCP_MANAGER || row.id === 'mcp-manager') && row.config.servers &&
          typeof row.config.servers === 'object' && !Array.isArray(row.config.servers)) {
        const servers = Object.fromEntries(Object.entries(row.config.servers)
          .filter(([name]) => !DATA_VARIABLES.has(mcpName(name))));
        copy.config = { ...copy.config, servers };
      }
    }
    return [copy];
  });
}

function boundedInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

async function readLegacyJson(directory, name, maxBytes) {
  if (!directory) return null;
  try {
    const file = join(directory, name);
    const info = await lstat(file);
    if (!info.isFile() || info.size > maxBytes) return null;
    const value = await readFile(file);
    return value.length <= maxBytes ? JSON.parse(value.toString('utf8')) : null;
  } catch {
    return null;
  }
}

const legacyTeamPlugin = `
export const inject = ['agentTeams'];

export function apply(ctx, { enabledConversations }) {
  const enabled = new Set(enabledConversations);
  ctx.on('agent/created', async ({ agent, source, signal }) => {
    if (source !== 'startup' || agent.session.header.origin === 'subagent') return;
    const session = agent.session;
    const match = /^somnus-(.+)-[a-f0-9]{12}$/.exec(session.id);
    if (!match || !enabled.has(match[1])) return;
    if (session.snapshotEvents(session.inheritedEventCount).some(event => event.type === 'team/mode')) return;
    await ctx.agentTeams.setEnabled(agent, true, signal);
  });
}
`;

function providerRows(lease, endpoint, env) {
  if (lease == null) return [];
  if (typeof lease.model !== 'string' || !MODEL.test(lease.model) || !TOKEN.test(lease.token ?? '') ||
      !Array.isArray(lease.models) || lease.models.length > 10 ||
      !lease.models.every(entry => typeof entry?.model === 'string' && MODEL.test(entry.model))) {
    throw new Error('Somnus returned an invalid company model capability');
  }
  const models = new Map();
  for (const entry of [{ model: lease.model, vision: lease.vision }, ...lease.models]) {
    const reasoningEfforts = Object.fromEntries((Array.isArray(entry.reasoning_efforts) ? entry.reasoning_efforts : [])
      .filter(effort => LIMITS.has(effort)).map(effort => [effort === 'none' ? 'off' : effort, effort]));
    models.set(entry.model, {
      id: entry.model, contextWindow: /^(?:deepseek-flash|deepseek-v4-(?:flash(?:-vision-exp)?|pro))$/.test(entry.model) ? 1_000_000 : 64_000,
      maxTokens: 16_384, input: entry.vision ? ['text', 'image'] : ['text'],
      ...(Object.keys(reasoningEfforts).length > 1 ? { reasoningEfforts } : {}),
    });
  }
  env[PROVIDER_TOKEN] = lease.token;
  return [{ insert: [{ id: 'somnus-company-model', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { [PROVIDER]: {
    displayName: 'Somnus 公司模型', api: 'openai-responses', apiKeyEnv: PROVIDER_TOKEN,
    compat: { supportsDeveloperRole: false, supportsLongCacheRetention: false },
    baseURL: endpoint + '/provider', retryPolicy: { mode: 'normal', maxRetries: 0 }, models: [...models.values()],
  } } } }] }, { id: 'agent-default-model', config: { provider: PROVIDER, model: lease.model } }];
}

export async function prepareSomnusHost({ origin, token, legacyProfileDir, fetcher = fetch, tempRoot = tmpdir() }) {
  const address = new URL(origin);
  if (address.hostname !== '127.0.0.1' || address.protocol !== 'http:' || !address.port || address.username ||
      address.password || address.pathname !== '/' || address.search || address.hash || !TOKEN.test(token ?? '')) {
    throw new Error('Invalid Somnus local Host bootstrap');
  }
  const base = address.origin + '/api/assistant/dsh-next-runtime';
  const request = (url, method) => fetcher(url, { method, redirect: 'error', signal: AbortSignal.timeout(6000),
    headers: { 'X-Data-Agent-Native': token } });
  const response = await request(base, 'POST');
  if (!response.ok) throw new Error(`Somnus Host capability is unavailable (${response.status})`);
  const lease = await response.json();
  if (typeof lease?.id !== 'string' || !/^[a-f0-9]{32}$/.test(lease.id)) {
    throw new Error('Somnus returned an invalid Host capability');
  }
  const endpoint = base + '/' + lease.id;
  const env = {};
  let directory, patchFile, teamFile, disposal;
  const dispose = () => disposal ??= (async () => {
    for (const [key, value] of Object.entries(env)) {
      if (process.env[key] === value) delete process.env[key];
      delete env[key];
    }
    await Promise.allSettled([request(endpoint, 'DELETE'), ...[patchFile, teamFile].filter(Boolean).map(file => unlink(file))]);
    if (directory) await rmdir(directory).catch(() => {});
  })();
  try {
    const credentials = new Set(lease.provider ? [lease.provider.token] : []);
    const ids = new Set();
    if (!Array.isArray(lease.data_servers) || lease.data_servers.length !== DATA_VARIABLES.size ||
        !boundedInteger(lease.subagents?.maxDepth, 0, 3) || !boundedInteger(lease.subagents?.maxActiveSubagents, 1, 8)) {
      throw new Error('Somnus returned an invalid Host capability');
    }
    const dataRows = [];
    for (const server of lease.data_servers) {
      const key = DATA_VARIABLES.get(server?.id);
      if (!key || ids.has(server.id) || typeof server.token !== 'string' || !TOKEN.test(server.token) || credentials.has(server.token)) {
        throw new Error('Somnus returned conflicting data MCP capabilities');
      }
      ids.add(server.id);
      credentials.add(server.token);
      env[key] = server.token;
      dataRows.push(...[
        '- insert:',
        '    - id: somnus-' + server.id,
        '      name: ' + JSON.stringify(MCP_CONNECTOR),
        '      config:',
        '        transport: streamable-http',
        '        serverName: ' + server.id,
        '        url: ' + JSON.stringify(endpoint + '/mcp/' + server.id),
        '        headers:',
        '          Authorization: !!js ' + JSON.stringify("'Bearer ' + process.env." + key),
      ]);
    }
    const rows = [...providerRows(lease.provider, endpoint, env), { id: 'subagent', config: lease.subagents }];
    const [execution, teamwork] = await Promise.all([
      readLegacyJson(legacyProfileDir, 'agent-execution-settings.json', 4096),
      readLegacyJson(legacyProfileDir, 'conversation-teamwork.json', 512 * 1024),
    ]);
    if (boundedInteger(execution?.loop?.maxConcurrent, 1, 8)) {
      rows.push({ id: 'agent-loop', config: { maxParallelToolCalls: execution.loop.maxConcurrent } });
    }
    const enabledConversations = Array.isArray(teamwork) ?
      [...new Set(teamwork.filter(value => typeof value === 'string' && CONVERSATION.test(value)))] : [];
    directory = await mkdtemp(join(tempRoot, 'somnus-next-host-'));
    patchFile = join(directory, 'somnus.cordis.patch.yml');
    if (enabledConversations.length > 0) {
      teamFile = join(directory, 'somnus-team-state.mjs');
      await writeFile(teamFile, legacyTeamPlugin, { mode: 0o600, flag: 'wx' });
      rows.push({ insert: [{ id: 'somnus-team-state', name: pathToFileURL(teamFile).href,
        config: { enabledConversations } }] });
    }
    await writeFile(patchFile, [...rows.map(row => '- ' + JSON.stringify(row)), ...dataRows].join('\n') + '\n',
      { mode: 0o600, flag: 'wx' });
    return { patchFile, env, dispose, protectDataPatches };
  } catch (error) {
    await dispose();
    throw error;
  }
}
