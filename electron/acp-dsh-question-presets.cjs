const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createRequire } = require('node:module');
const { configuredCapabilities } = require('./acp-dsh-web-model.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const dumpProfile = promisify(execFile);

function compactionBudget(models = []) {
  const budgets = models.map(model => configuredCapabilities(model, model.api ?? 'openai-completions'));
  const messageBudget = budgets.length ? Math.min(...budgets.map(model => model.contextWindow - model.maxTokens)) : 49152;
  const headroom = Math.max(1, Math.min(8192, Math.floor(messageBudget / 4)));
  const summaryTokens = Math.min(headroom, ...(budgets.length ? budgets.map(model => model.maxTokens) : [8192]));
  return { headroom, summaryTokens };
}

async function timedQuestionPresets(launch, env, cwd, { managedProviders = false, models = [] } = {}) {
  const [entry] = launch.args;
  const { stdout } = await dumpProfile(launch.executable, [entry, '--profile', 'web', '--dump-config'], {
    cwd, env, windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024,
  });
  const yaml = managedProviders ? createRequire(entry)('yaml') : null;
  const scopeModule = managedProviders ? pathToFileURL(createRequire(entry).resolve('@deepseek-ai/dsh-scope')).href : null;
  const { headroom, summaryTokens } = compactionBudget(models);
  const rows = stdout.split(/(?=^- )/m);
  const overrides = [];
  for (const original of rows) {
    let row = original;
    if (!/\n  name: ['"]?@deepseek-ai\/dsh-agent-preset['"]?\r?\n/.test(row)) continue;
    const tool = /(^      - id: tool-ask-user\r?\n        name: ['"]?@deepseek-ai\/dsh-tool-ask-user['"]?)(\r?\n        config:\r?\n(?:[ ]{10}[^\r\n]*\r?\n)*)?/m;
    const match = tool.exec(row);
    if (match && !/\bmode: ['"]?timed\b/.test(match[2] || '')) {
      row = row.replace(tool, (_match, name, config) => {
        const existing = config?.replace(/^ {10}(?:mode|timeout):[^\r\n]*\r?\n/gm, '') || '\n        config:\n';
        return name + existing + '          mode: timed\n          timeout: -1\n';
      });
    }
    if (managedProviders) {
      const parsed = yaml.parseDocument(row, { logLevel: 'silent' });
      if (parsed.errors.length) throw new Error('DSH 压缩预设无法解析。');
      for (const entry of parsed.contents?.items ?? []) {
        if (!yaml.isMap(entry)) continue;
        const preset = entry.get('config', true);
        if (!yaml.isMap(preset) || preset.get('id') !== 'minimal') continue;
        const plugins = preset.get('plugins', true);
        if (yaml.isSeq(plugins)) for (const plugin of plugins.items) {
          if (!yaml.isMap(plugin) || plugin.get('name') !== '@deepseek-ai/dsh-persona') continue;
          const persona = plugin.get('config', true);
          if (yaml.isMap(persona)) persona.set('prefix', 'You are Somnus, the assistant in the Somnus desktop app. Use Somnus as your identity regardless of the configured model. You are running Minimal mode with only its declared tools.');
        }
        if (yaml.isSeq(plugins) && !plugins.items.some(item => yaml.isMap(item) && item.get('id') === 'somnus-minimal-tool-scope')) {
          plugins.add(parsed.createNode({ id: 'somnus-minimal-tool-scope',
            name: pathToFileURL(path.join(__dirname, 'acp-dsh-mode-scope.mjs')).href,
            config: { scopeModule } }));
        }
      }
      yaml.visit(parsed, { Map(_key, node) {
        if (node.get('name') !== '@deepseek-ai/dsh-compaction-basic') return;
        let config = node.get('config', true);
        if (!yaml.isMap(config)) { config = parsed.createNode({}); node.set('config', config); }
        config.set('headroomTokens', Math.min(config.get('headroomTokens') ?? headroom, headroom));
        config.set('maxTokens', Math.min(config.get('maxTokens') ?? summaryTokens, summaryTokens));
        const policies = config.get('modelPolicies', true);
        if (yaml.isSeq(policies)) for (const policy of policies.items) {
          if (!yaml.isMap(policy)) continue;
          policy.set('headroomTokens', Math.min(policy.get('headroomTokens') ?? headroom, headroom));
          policy.set('maxTokens', Math.min(policy.get('maxTokens') ?? summaryTokens, summaryTokens));
        }
      } });
      // Preserve DSH's !!js expression tags; converting this document to plain objects would disable platform guards.
      row = parsed.toString();
    }
    if (row !== original) overrides.push(row);
  }
  return overrides.join('\n');
}

module.exports = { timedQuestionPresets, compactionBudget };
