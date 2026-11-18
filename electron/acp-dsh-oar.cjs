const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { lstat, readFile, realpath, unlink, writeFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const { atomicWrite, fileBytes, plainDirectory } = require('./desktop-profiles.cjs');
const { processEnvironment } = require('./acp-stdio.cjs');

const PINNED = {
  provider: 'c148f5234ca40134aee75936b4cc5ffc0cf8cc7e871fc844ac11c072068cc6ed',
  tool: '084b1c763dbe2c562bee6da3beb1da730ca65e6bec4fc1729cd782350f43bf8f',
};
const PI_IMPORT = 'import "@earendil-works/pi-coding-agent";';
const NATIVE_EXECUTABLE = 'const pinned = process.env[envVar];';
const NATIVE_SESSION = '\t\t\tlaunchArgs: spec.launchArgs\n';
const NATIVE_CWD = '\t\t\t\t\t...args.cwd === void 0 ? {} : { cwd: args.cwd },';
const CWD_INPUT = '\t\t\tcwd: {\n\t\t\t\ttype: "string",\n\t\t\t\tdescription: "Initial child working directory. Relative paths use your current directory; omission inherits it."\n\t\t\t}';

async function fileIsPlain(file) {
  const info = await lstat(file).catch(() => null);
  return Boolean(info?.isFile() && !info.isSymbolicLink());
}

async function trustedSources(vendorDirectory, runtimeDirectory) {
  const moduleRoot = await realpath(path.join(runtimeDirectory, 'node_modules'));
  const requireRuntime = createRequire(path.join(runtimeDirectory, 'package.json'));
  const modules = {};
  for (const [name, expected] of Object.entries(PINNED)) {
    const asset = path.join(vendorDirectory, name + '.mjs');
    if (!await fileIsPlain(asset)) throw new Error('OAR 安装组件缺失。');
    const bytes = await readFile(asset);
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('OAR 安装组件无法验证。');
    let source = bytes.toString('utf8');
    if (name === 'provider') {
      if (!source.includes(PI_IMPORT) || !source.includes(NATIVE_SESSION) || !source.includes(NATIVE_EXECUTABLE)) {
        throw new Error('OAR 提供方版本不匹配。');
      }
      // The published bundle includes Pi code. Somnus registers only Codex and Claude,
      // so their path needs no Pi SDK or Pi credentials in the managed DSH host.
      source = source.replace(PI_IMPORT + '\n', '')
        .replace(NATIVE_SESSION, NATIVE_SESSION.trimEnd() + ',\n\t\t\tmcpServers: []\n')
        .replace(NATIVE_EXECUTABLE, 'const pinned = env[envVar];');
    } else {
      if (!source.includes(NATIVE_CWD) || !source.includes(CWD_INPUT)) throw new Error('OAR 工具版本不匹配。');
      // Keep the parent conversation's already-authorized workspace as the
      // child cwd. OAR accepts no model-supplied absolute directory in Somnus.
      source = source.replace(NATIVE_CWD + '\n', '').replace(',\n' + CWD_INPUT, '');
    }
    source = source.replace(/^(import [^\n]*? from ")([^"\n]+)(";)/gm, (line, before, spec, after) => {
      if (spec.startsWith('node:')) return line;
      const location = requireRuntime.resolve(spec);
      const relative = path.relative(moduleRoot, location);
      if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
        throw new Error('OAR 依赖不在当前 Somnus 托管运行时内。');
      }
      return before + pathToFileURL(location).href + after;
    });
    modules[name] = source;
  }
  return modules;
}

async function claudeSupportsIsolation(executable, profileDir) {
  const run = promisify(execFile);
  const settings = { env: { ...processEnvironment(), CLAUDE_CONFIG_DIR: path.join(profileDir, 'claude-home') },
    windowsHide: true, timeout: 4_000, maxBuffer: 256 * 1024 };
  try {
    const [version, help] = await Promise.all([run(executable, ['--version'], settings), run(executable, ['--help'], settings)]);
    const parts = /(?:^|\s)(\d+)\.(\d+)\.(\d+)\b/.exec(version.stdout)?.slice(1).map(Number);
    if (!parts) return false;
    const [major, minor, patch] = parts;
    const supported = major > 2 || major === 2 && (minor > 1 || minor === 1 && patch >= 259);
    return supported && ['--strict-mcp-config', '--setting-sources', '--permission-prompts', '--settings']
      .every(flag => help.stdout.includes(flag));
  } catch { return false; }
}

async function runtimeExecutables(resourcesPath, profileDir, platform = process.platform, architecture = process.arch) {
  if (platform !== 'win32' || !['x64', 'arm64'].includes(architecture)) return {};
  const codexArch = architecture === 'arm64' ? 'aarch64' : 'x86_64';
  const codex = path.join(resourcesPath, 'agents', 'codex', 'node_modules', '@openai', `codex-win32-${architecture}`,
    'vendor', `${codexArch}-pc-windows-msvc`, 'bin', 'codex.exe');
  const result = {};
  if (await fileIsPlain(codex)) result.codex = codex;
  const claude = [path.join(resourcesPath, 'agents', 'claude', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude.exe')];
  for (const file of claude) {
    if (!await fileIsPlain(file) || !await claudeSupportsIsolation(file, profileDir)) continue;
    result.claude = file;
    break;
  }
  return result;
}

function createOarIntegration(market, vendorDirectory = path.join(market.resourcesPath, 'somnus', 'dsh-oar')) {
  const configFile = path.join(market.profileDir, 'agent-oar.json');
  let loaded;
  const read = () => {
    try { return JSON.parse(fileBytes(configFile, 1024).toString('utf8')).enabled === true; }
    catch { return false; }
  };
  async function discover() {
    const runtime = await runtimeExecutables(market.resourcesPath, market.profileDir);
    if (!Object.keys(runtime).length) return { reason: '没有找到可用的 Codex 或 Claude Code 运行程序。' };
    if (!await market.launch()) return { reason: 'Somnus 托管 DSH 运行时尚未就绪。' };
    try {
      loaded ??= await trustedSources(vendorDirectory, market.runtimeDir);
      return { runtime, modules: loaded };
    } catch (error) {
      return { reason: error instanceof Error ? error.message : 'OAR 运行组件无法加载。' };
    }
  }
  async function status() {
    const enabled = read();
    const { runtime, reason } = await discover();
    return { available: Boolean(runtime), enabled, runtimes: Object.keys(runtime ?? {}), ...(reason ? { reason } : {}) };
  }
  return {
    status,
    async setEnabled(enabled, validateSender) {
      if (typeof enabled !== 'boolean') throw new Error('无效的 OAR 设置。');
      const current = await status();
      if (enabled && !current.available) throw new Error(current.reason ?? 'OAR 当前不可用。');
      validateSender();
      if (current.enabled !== enabled) {
        await market.community.withWebMutation(true, async () => {
          validateSender();
          plainDirectory(market.profileDir);
          atomicWrite(configFile, JSON.stringify({ enabled }) + '\n');
        });
      }
      return { ...current, enabled };
    },
    async prepare(directory) {
      if (!read()) return null;
      const { runtime, modules } = await discover();
      if (!runtime || !modules) return null;
      return prepareOarModules(directory, market.profileDir, modules, runtime);
    },
  };
}

async function prepareOarModules(directory, profileDir, modules, runtime) {
  const providerFile = path.join(directory, 'somnus-oar-provider.mjs');
  const toolFile = path.join(directory, 'somnus-oar-tool.mjs');
  const providers = {};
  const rows = [];
  for (const [name, executable] of Object.entries(runtime)) {
    const providerName = 'oar-' + name;
    const config = name === 'codex' ? {
      env: { OAR_CODEX_BIN: executable, CODEX_HOME: path.join(profileDir, 'codex-home'), OPENAI_BASE_URL: null },
      launchArgs: ['-c', 'sandbox_mode="read-only"'],
    } : {
      env: { OAR_CLAUDE_BIN: executable, CLAUDE_CONFIG_DIR: path.join(profileDir, 'claude-home'), ANTHROPIC_BASE_URL: null },
      launchArgs: ['--permission-mode', 'plan', '--permission-prompts', 'none', '--strict-mcp-config',
        '--setting-sources', 'user', '--settings', '{"disableAllHooks":true}'],
    };
    providers[name] = providerName;
    rows.push({ id: providerName, name: pathToFileURL(providerFile).href,
      config: { runtime: name, providerName, timeoutMs: 180_000, ...config } });
  }
  rows.push({ id: 'tool-subagent-oar', name: pathToFileURL(toolFile).href, config: { providers } });
  const files = [providerFile, toolFile];
  const results = await Promise.allSettled([writeFile(providerFile, modules.provider, { flag: 'wx', mode: 0o600 }),
    writeFile(toolFile, modules.tool, { flag: 'wx', mode: 0o600 })]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    await Promise.allSettled(results.flatMap((result, index) => result.status === 'fulfilled' ? [unlink(files[index])] : []));
    throw failure.reason;
  }
  return { files, rows };
}

module.exports = { createOarIntegration, prepareOarModules, runtimeExecutables, trustedSources };
