const { mkdtemp, rmdir, unlink, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { teamworkPlugin } = require('./acp-dsh-teamwork.cjs');
const { TOKEN_VARIABLE: PROJECT_TOKEN, ENDPOINT_VARIABLE: PROJECT_ENDPOINT } = require('./acp-dsh-project-tools.cjs');

const PROVIDER = 'vvman-company';
// DSH excludes DSH_* variables when inheriting environment for shell tools.
const TOKEN_VARIABLE = 'DSH_SOMNUS_WEB_MODEL_TOKEN';
const DATA_TOKEN_VARIABLE = 'DSH_SOMNUS_WEB_DATA_TOKEN';
const DATA_CONNECTORS = {
  database: { id: 'somnus-database', tokenVariable: 'DSH_SOMNUS_DATABASE_MCP_TOKEN' },
  'text-to-sql': { id: 'somnus-text-to-sql', tokenVariable: 'DSH_SOMNUS_TEXT_TO_SQL_MCP_TOKEN' },
};
const DEEPSEEK_FLASH_MODELS = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']);
const DEEPSEEK_PRO_MODELS = new Set(['deepseek-v4-pro']);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/;
const EFFORTS = new Set(['none', 'low', 'high', 'max']);
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
  const roster = Array.isArray(lease.models) ? lease.models.slice(0, 10) : [];
  const available = roster.filter(entry => Boolean(entry && MODEL_ID.test(entry.model ?? '')));
  if (!available.some(entry => entry.model === lease.model)) available.unshift(lease);
  return [...new Map(available.map(entry => [entry.model, entry])).values()];
}

async function companyWebOverlay(lease, maxParallelToolCalls, project, questionPresets, teamToolModule, oarIntegration) {
  const connectors = lease.dataServers ? lease.dataServers.map(server => ({
    ...DATA_CONNECTORS[server.id], serverName: server.id, endpoint: server.endpoint, token: server.token,
  })) : lease.data ? [{ ...lease.data, id: 'somnus-company-data', serverName: 'vv_man', tokenVariable: DATA_TOKEN_VARIABLE }] : [];
  const needsYaml = connectors.length > 0 || questionPresets;
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
  const { model, endpoint, vision, subagents } = lease;
  const roster = companyModels(lease);
  const models = roster.map(entry => {
    const efforts = Array.isArray(entry.reasoning_efforts) ? entry.reasoning_efforts.filter(level => EFFORTS.has(level)) : [];
    const reasoningEfforts = Object.fromEntries(efforts.map(level => [nativeEffort(level), level]));
    return { id: entry.model,
      contextWindow: DEEPSEEK_FLASH_MODELS.has(entry.model) || DEEPSEEK_PRO_MODELS.has(entry.model) ? 1_000_000 : 64_000,
      maxTokens: 16384, input: (entry.vision ?? (entry.model === model && vision)) ? ['text', 'image'] : ['text'],
      ...(efforts.some(level => level !== 'none') ? { reasoningEfforts } : {}),
    };
  });
  const overlay = [
    { id: 'llm-pi-ai', config: { providers: { [PROVIDER]: {
      displayName: 'Somnus 公司默认', apiKeyEnv: TOKEN_VARIABLE, api: 'openai-responses',
      compat: { supportsDeveloperRole: false, supportsLongCacheRetention: false },
      baseURL: endpoint, retryPolicy: { mode: 'normal', maxRetries: 0 },
      models,
    } } } },
    { id: 'agent-default-model', config: { provider: PROVIDER, model } },
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
  const env = { [TOKEN_VARIABLE]: lease.token, ...project?.env, ...(oar ? { OAR_CODEX_SANDBOX: 'read-only' } : {}) };
  for (const { tokenVariable, token } of connectors) env[tokenVariable] = token;
  const selectionModels = models.map((row, index) => {
    const effort = nativeEffort(roster[index].default_reasoning_effort);
    return { ...row, ...(effort && Object.hasOwn(row.reasoningEfforts ?? {}, effort) ? { defaultReasoningEffort: effort } : {}) };
  });
  return { file, model, models: selectionModels, env, dispose, projectTools: Boolean(project), teamwork, oar: Boolean(oar) };
}

module.exports = { companyWebOverlay, nativeEffort, TEAM_PLUGINS };
