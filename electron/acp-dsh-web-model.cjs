const { mkdtemp, rmdir, unlink, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { teamworkPlugin } = require('./acp-dsh-teamwork.cjs');
const { TOKEN_VARIABLE: PROJECT_TOKEN, ENDPOINT_VARIABLE: PROJECT_ENDPOINT } = require('./acp-dsh-project-tools.cjs');

const PROVIDER = 'vvman-company';
// DSH excludes DSH_* variables when inheriting environment for shell tools.
const TOKEN_VARIABLE = 'DSH_SOMNUS_WEB_MODEL_TOKEN';
const BEDROCK_TOKEN_VARIABLE = 'DSH_SOMNUS_BEDROCK_TOKEN';
const BEDROCK = 'amazon-bedrock';
const BEDROCK_API = 'bedrock-converse-stream';
const RELAY_APIS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages']);
const AWS_OPTIONS = new Set([
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE', 'AWS_SDK_LOAD_CONFIG',
  'AWS_ROLE_ARN', 'AWS_ROLE_SESSION_NAME', 'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN', 'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE', 'AWS_BEDROCK_FORCE_HTTP1',
]);
const DATA_TOKEN_VARIABLE = 'DSH_SOMNUS_WEB_DATA_TOKEN';
const DATA_CONNECTORS = {
  database: { id: 'somnus-database', tokenVariable: 'DSH_SOMNUS_DATABASE_MCP_TOKEN' },
  'text-to-sql': { id: 'somnus-text-to-sql', tokenVariable: 'DSH_SOMNUS_TEXT_TO_SQL_MCP_TOKEN' },
};
const DEEPSEEK_FLASH_MODELS = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']);
const DEEPSEEK_PRO_MODELS = new Set(['deepseek-v4-pro']);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/;
const EFFORTS = new Set(['none', 'low', 'medium', 'high', 'max']);
const TEAM_PLUGINS = [
  { id: 'agent-team', name: '@deepseek-ai/dsh-experimental-agent-team',
    config: { maxMembers: 8, maxTasks: 256, maxMessageBytes: 65536, disposalTimeoutMs: 5000 } },
  { id: 'tool-agent-team', name: '@deepseek-ai/dsh-experimental-tool-agent-team',
    config: { freshProvider: 'spawn', forkProvider: 'fork' } },
  { id: 'ui-agent-team', name: '@deepseek-ai/dsh-experimental-client-ui-agent-team' },
];

function nativeEffort(value) {
  return value === 'none' ? 'off' : EFFORTS.has(value) ? value : undefined;
}

function companyModels(lease) {
  const roster = Array.isArray(lease.models) ? lease.models.slice(0, lease.api === 'openai-completions' ? 64 : 10) : [];
  const available = roster.filter(entry => Boolean(entry && MODEL_ID.test(entry.model ?? '')));
  if (!available.some(entry => entry.model === lease.model)) available.unshift(lease);
  return [...new Map(available.map(entry => [entry.model, entry])).values()];
}

function configuredCapabilities(entry, api) {
  const contextWindow = entry.context_window ??
    (DEEPSEEK_FLASH_MODELS.has(entry.display_model ?? entry.model) || DEEPSEEK_PRO_MODELS.has(entry.display_model ?? entry.model) ? 1_000_000 : 64_000);
  const maxTokens = entry.max_output_tokens ?? Math.min(16384, Math.max(1, Math.floor(contextWindow / 4)));
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 1024 || contextWindow > 10_000_000 ||
      !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1_000_000 || maxTokens > contextWindow - Math.min(8192, Math.floor(contextWindow / 2))) {
    throw new Error('模型上下文或输出上限无效。');
  }
  for (const field of ['supports_developer_role', 'supports_long_cache_retention']) {
    if (entry[field] != null && typeof entry[field] !== 'boolean') throw new Error('模型兼容能力无效。');
  }
  const cacheRetention = entry.cache_retention;
  if (cacheRetention != null && !['none', 'short', 'long'].includes(cacheRetention) ||
      cacheRetention === 'long' && entry.supports_long_cache_retention !== true) throw new Error('模型缓存策略无效。');
  const compat = api === BEDROCK_API ? undefined : {
    supportsLongCacheRetention: entry.supports_long_cache_retention ?? false,
    ...(api === 'anthropic-messages' ? {} : { supportsDeveloperRole: entry.supports_developer_role ?? false }),
    ...(api === 'openai-completions' ? { supportsStore: false } : {}),
  };
  return { contextWindow, maxTokens, compat, ...(cacheRetention != null ? { cacheRetention } : {}) };
}

async function companyWebOverlay(lease, maxParallelToolCalls, project, questionPresets, teamToolModule, oarIntegration) {
  const connectors = lease.dataServers ? lease.dataServers.map(server => ({
    ...DATA_CONNECTORS[server.id], serverName: server.id, endpoint: server.endpoint, token: server.token,
  })) : lease.data ? [{ ...lease.data, id: 'somnus-company-data', serverName: 'vv_man', tokenVariable: DATA_TOKEN_VARIABLE }] : [];
  const needsYaml = connectors.length > 0 || questionPresets;
  const { model, endpoint, vision, subagents } = lease;
  const personal = lease.api === 'openai-completions';
  const roster = companyModels(lease);
  const providers = {};
  const relayProfiles = new Map();
  const bedrockEnv = {};
  let bedrockIdentity;
  const models = roster.map(entry => {
    const api = personal ? (entry.api ?? 'openai-completions') : 'openai-responses';
    if (!RELAY_APIS.has(api) && api !== BEDROCK_API) throw new Error('Provider 接口类型无效。');
    const retryPolicy = personal ? (entry.retry_policy ?? undefined) : { mode: 'normal', maxRetries: 0 };
    const isBedrock = api === BEDROCK_API;
    const reportedModel = entry.display_model ?? entry.model;
    const capabilities = configuredCapabilities(entry, api);
    const runtimeModel = isBedrock ? reportedModel : entry.model;
    let provider = PROVIDER;
    if (isBedrock) {
      if (!MODEL_ID.test(runtimeModel)) throw new Error('Bedrock 模型 ID 无效。');
      if (entry.region && !/^[a-z0-9-]{3,35}$/.test(entry.region)) throw new Error('Bedrock 区域无效。');
      const identity = JSON.stringify([entry.region ?? '', entry.base_url ?? '', entry.native_bedrock_token ?? '', retryPolicy, capabilities.cacheRetention]);
      if (bedrockIdentity && identity !== bedrockIdentity) throw new Error('请使用同一个 Bedrock 连接和区域。');
      bedrockIdentity = identity;
      provider = BEDROCK;
      if (entry.native_bedrock_token) {
        // DSH filters DSH_* and sensitive environment variables from subprocesses.
        bedrockEnv[BEDROCK_TOKEN_VARIABLE] = entry.native_bedrock_token;
        bedrockEnv.AWS_BEARER_TOKEN_BEDROCK = entry.native_bedrock_token;
      } else {
        for (const [key, value] of Object.entries(process.env)) {
          if (AWS_OPTIONS.has(key) && value !== undefined) bedrockEnv[key] = value;
        }
      }
      if (process.env.AWS_BEDROCK_FORCE_HTTP1 === '1') bedrockEnv.AWS_BEDROCK_FORCE_HTTP1 = '1';
      if (entry.region) {
        bedrockEnv.AWS_REGION = entry.region;
        bedrockEnv.AWS_DEFAULT_REGION = entry.region;
      }
    } else {
      const profileKey = JSON.stringify([api, retryPolicy, capabilities.compat, capabilities.cacheRetention]);
      if (!relayProfiles.has(profileKey)) {
        const index = relayProfiles.size;
        relayProfiles.set(profileKey, index ? PROVIDER + '-' + index : PROVIDER);
      }
      provider = relayProfiles.get(profileKey);
    }
    const profile = providers[provider] ??= {
      displayName: isBedrock ? 'AWS Bedrock' : personal ? 'Somnus Provider' : 'Somnus 公司默认',
      ...(isBedrock
        ? { ...(entry.native_bedrock_token ? { apiKeyEnv: BEDROCK_TOKEN_VARIABLE } : {}),
          ...(entry.base_url ? { baseURL: entry.base_url } : {}) }
        : { apiKeyEnv: TOKEN_VARIABLE, baseURL: endpoint,
          compat: capabilities.compat }),
      ...(isBedrock ? {} : { api }), ...(retryPolicy ? { retryPolicy } : {}),
      ...(capabilities.cacheRetention ? { cacheRetention: capabilities.cacheRetention } : {}), models: [],
    };
    const efforts = Array.isArray(entry.reasoning_efforts) ? entry.reasoning_efforts.filter(level => EFFORTS.has(level)) : [];
    const reasoningEfforts = Object.fromEntries(efforts.map(level => [nativeEffort(level), level]));
    const nativeModel = { id: runtimeModel,
      contextWindow: capabilities.contextWindow,
      maxTokens: capabilities.maxTokens, input: (entry.vision ?? (entry.model === model && vision)) ? ['text', 'image'] : ['text'],
      ...(efforts.some(level => level !== 'none') ? { reasoningEfforts } : {}),
    };
    if (!profile.models.some(item => item.id === runtimeModel)) profile.models.push(nativeModel);
    return { ...nativeModel, id: entry.model, provider, runtimeModel };
  });
  const initial = models.find(entry => entry.id === model);
  if (!initial) throw new Error('DSH Provider 模型未就绪。');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'somnus-dsh-web-'));
  const file = path.join(dir, needsYaml ? 'company-model.yml' : 'company-model.json');
  const projectFile = path.join(dir, 'somnus-project-tools.mjs');
  const teamFile = path.join(dir, 'somnus-conversation-teamwork.mjs');
  const teamwork = Boolean(teamToolModule && project);
  let oar;
  let disposal;
  function dispose() {
    project?.dispose();
    disposal ??= Promise.allSettled([lease.dispose(), unlink(file), ...(project ? [unlink(projectFile)] : []),
      ...(teamwork ? [unlink(teamFile)] : []), ...(oar?.files ?? []).map(asset => unlink(asset))])
      .then(() => rmdir(dir).catch(() => {}));
    return disposal;
  }
  const overlay = [
    { id: 'llm-pi-ai', config: { providers } },
    { id: 'agent-default-model', config: { provider: initial.provider, model: initial.runtimeModel } },
    ...(subagents ? [{ id: 'subagent', config: subagents }] : []),
    ...(maxParallelToolCalls == null ? [] : [{ id: 'agent-loop', config: { maxParallelToolCalls } }]),
    ...(project ? [{ insert: [{ id: 'somnus-project-tools', name: pathToFileURL(projectFile).href }] }] : []),
    ...(teamwork ? [
      { insert: [TEAM_PLUGINS[0], { id: 'somnus-team-tools', name: pathToFileURL(teamFile).href }, TEAM_PLUGINS[2]] },
    ] : []),
  ];
  try {
    if (project) await writeFile(projectFile, project.plugin, { flag: 'wx', mode: 0o600 });
    if (teamwork) await writeFile(teamFile, teamworkPlugin(pathToFileURL(teamToolModule).href, PROJECT_ENDPOINT, PROJECT_TOKEN),
      { flag: 'wx', mode: 0o600 });
    oar = await oarIntegration?.prepare(dir);
    if (oar) overlay.push({ insert: oar.rows });
    const config = needsYaml ? [
      ...overlay.map(row => '- ' + JSON.stringify(row)),
      ...connectors.flatMap(({ id, serverName, endpoint: url, tokenVariable }) => [
        '- insert:',
        '    - id: ' + id,
        "      name: '@deepseek-ai/dsh-mcp-client'",
        '      config:',
        '        transport: streamable-http',
        '        serverName: ' + serverName,
        '        url: ' + JSON.stringify(url),
        '        headers:',
        '          Authorization: !!js ' + JSON.stringify("'Bearer ' + process.env." + tokenVariable),
      ]),
      questionPresets || '',
    ].join('\n') + '\n' : JSON.stringify(overlay);
    await writeFile(file, config, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await dispose();
    throw error;
  }
  const env = { ...bedrockEnv, [TOKEN_VARIABLE]: lease.token, ...project?.env, ...(oar ? { OAR_CODEX_SANDBOX: 'read-only' } : {}) };
  for (const { tokenVariable, token } of connectors) env[tokenVariable] = token;
  const selectionModels = models.map((row, index) => {
    const effort = nativeEffort(roster[index].default_reasoning_effort);
    return { ...row, ...(effort && Object.hasOwn(row.reasoningEfforts ?? {}, effort) ? { defaultReasoningEffort: effort } : {}) };
  });
  return { file, model, models: selectionModels, env, dispose, projectTools: Boolean(project), teamwork, oar: Boolean(oar) };
}

module.exports = { configuredCapabilities, companyWebOverlay, nativeEffort, TEAM_PLUGINS };
