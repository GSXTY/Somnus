const { lstat, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { AcpError } = require('./acp-stdio.cjs');

const AGENT_ID = 'fbbce833-544a-42a1-8579-cba2a817383e';
const SHIPPED = new Set([
  '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app',
  '@deepseek-ai/dsh-experimental-badge-skill-bundle', '@deepseek-ai/dsh-personalized-recommendations',
]);
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const DEEPSEEK_FLASH_MODELS = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']);

async function companyProfile(cwd, profile, config, endpoint, managedHome, maxParallelToolCalls) {
  if (!profile || !config || typeof config.model !== 'string' ||
      !/^[0-9a-f]{64}$/.test(config.token) || !endpoint?.startsWith('http://127.0.0.1:')) {
    throw new AcpError('公司模型会话授权未就绪。');
  }
  const home = path.join(cwd, 'company-home');
  const dir = path.join(home, 'profiles', 'acp');
  const sourceModules = path.join(path.dirname(profile.file), 'node_modules');
  const managedSkillDirs = managedHome ? [path.join(managedHome, 'skills')] : [];
  await mkdir(dir, { recursive: true });
  const dependencies = {};
  const bundles = [];
  for (const name of profile.bundles) {
    if (SHIPPED.has(name)) {
      bundles.push(name);
      continue;
    }
    if (typeof name !== 'string' || !PACKAGE.test(name)) continue;
    const version = config.plugins?.[name];
    if (typeof version !== 'string' || profile.data.dependencies?.[name] !== version) continue;
    const manifestFile = path.join(sourceModules, name, 'package.json');
    const canonicalModules = await realpath(sourceModules).catch(() => '');
    const canonicalManifest = await realpath(manifestFile).catch(() => '');
    const details = await lstat(manifestFile).catch(() => null);
    if (!canonicalModules || !canonicalManifest.startsWith(canonicalModules + path.sep) ||
        !details?.isFile() || details.isSymbolicLink() || details.size > 128 * 1024) continue;
    const manifest = await readFile(canonicalManifest, 'utf8').then(JSON.parse).catch(() => null);
    if (manifest?.name !== name || manifest.version !== version) continue;
    dependencies[name] = version;
    bundles.push(name);
  }
  if (Object.keys(dependencies).length > 0) await symlink(sourceModules, path.join(dir, 'node_modules'), 'junction');
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-acp', private: true, type: 'module', dependencies, dsh: { profile: { bundles } },
  }));
  // JSON is also valid YAML. Keep the temporary model capability in the launch
  // environment, leaving only routing configuration in the profile.
  await writeFile(path.join(dir, 'cordis.patch.yml'), JSON.stringify([
    { id: 'llm-pi-ai', config: { providers: { 'vvman-company': {
      displayName: 'Somnus 公司默认', apiKeyEnv: 'VVMAN_COMPANY_MODEL_TOKEN', api: 'openai-completions',
      baseURL: endpoint, retryPolicy: { mode: 'normal', maxRetries: 0 },
      models: [{ id: config.model, contextWindow: DEEPSEEK_FLASH_MODELS.has(config.model) ? 1_000_000 : 64_000, maxTokens: 16384,
        input: config.vision ? ['text', 'image'] : ['text'] }],
    } } } },
    { id: 'acp', config: { provider: 'vvman-company', model: config.model } },
    ...(config.subagents ? [{ id: 'subagent', config: config.subagents }] : []),
    ...(maxParallelToolCalls == null ? [] : [{ id: 'agent-loop', config: { maxParallelToolCalls } }]),
    { id: 'skill-filesystem', config: { dshHome: home, customSkillDirs: managedSkillDirs } },
  ]));
  return { home, token: config.token, bundles };
}

async function removeCompanyProfile(cwd) {
  const home = path.join(cwd, 'company-home');
  const modules = path.join(home, 'profiles', 'acp', 'node_modules');
  if ((await lstat(modules).catch(() => null))?.isSymbolicLink()) await unlink(modules);
  if (await lstat(modules).catch(() => null)) return;
  if (path.basename(cwd).startsWith('vvman-acp-') && path.resolve(home) === cwd + path.sep + 'company-home' &&
      (await lstat(home).catch(() => null))?.isDirectory()) {
    await rm(home, { recursive: true, force: true });
  }
}

module.exports = { AGENT_ID, companyProfile, removeCompanyProfile };
