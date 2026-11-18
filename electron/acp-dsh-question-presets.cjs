const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const dumpProfile = promisify(execFile);

async function timedQuestionPresets(launch, env, cwd) {
  const [entry] = launch.args;
  const { stdout } = await dumpProfile(launch.executable, [entry, '--profile', 'web', '--dump-config'], {
    cwd, env, windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024,
  });
  const rows = stdout.split(/(?=^- )/m);
  const overrides = [];
  for (const row of rows) {
    if (!/\n  name: ['"]?@deepseek-ai\/dsh-agent-preset['"]?\r?\n/.test(row)) continue;
    const tool = /(^      - id: tool-ask-user\r?\n        name: ['"]?@deepseek-ai\/dsh-tool-ask-user['"]?)(\r?\n        config:\r?\n(?:[ ]{10}[^\r\n]*\r?\n)*)?/m;
    const match = tool.exec(row);
    if (!match || /\bmode: ['"]?timed\b/.test(match[2] || '')) continue;
    overrides.push(row.replace(tool, (_match, name, config) => {
      const existing = config?.replace(/^ {10}(?:mode|timeout):[^\r\n]*\r?\n/gm, '') || '\n        config:\n';
      return name + existing + '          mode: timed\n          timeout: -1\n';
    }));
  }
  return overrides.join('\n');
}

module.exports = { timedQuestionPresets };
