const path = require('node:path');
const { atomicWrite, fileBytes, plainDirectory } = require('./desktop-profiles.cjs');

const DEFAULT_EXECUTION_SETTINGS = Object.freeze({
  loop: Object.freeze({ maxCalls: 16, maxConcurrent: 4 }),
  shell: Object.freeze({ timeoutSeconds: 120, outputKiB: 64 }),
});

function integer(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error('Agent 执行设置超出允许范围。');
  }
  return value;
}

function executionSettings(value) {
  return {
    loop: {
      maxCalls: integer(value?.loop?.maxCalls, 1, 48),
      maxConcurrent: integer(value?.loop?.maxConcurrent, 1, 8),
    },
    shell: {
      timeoutSeconds: integer(value?.shell?.timeoutSeconds, 1, 150),
      outputKiB: integer(value?.shell?.outputKiB, 1, 64),
    },
  };
}

function createExecutionSettings(profileDir) {
  const file = path.join(profileDir, 'agent-execution-settings.json');
  const teamworkFile = path.join(profileDir, 'conversation-teamwork.json');
  const conversationId = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
  const readTeamwork = () => {
    try {
      const values = JSON.parse(fileBytes(teamworkFile, 512 * 1024).toString('utf8'));
      return new Set(Array.isArray(values) ? values.filter(id => typeof id === 'string' && conversationId.test(id)) : []);
    } catch { return new Set(); }
  };
  const read = () => {
    try { return JSON.parse(fileBytes(file, 4096).toString('utf8')); }
    catch { return {}; }
  };
  const write = value => {
    plainDirectory(profileDir);
    atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
  };
  return {
    get() {
      try {
        return executionSettings(read());
      } catch {
        return DEFAULT_EXECUTION_SETTINGS;
      }
    },
    set(value) {
      const settings = executionSettings(value);
      write(settings);
      return settings;
    },
    teamwork(id) { return typeof id === 'string' && conversationId.test(id) && readTeamwork().has(id); },
    setTeamwork(id, value) {
      if (typeof id !== 'string' || !conversationId.test(id) || typeof value !== 'boolean') {
        throw new Error('无效的会话团队协作设置。');
      }
      const enabled = readTeamwork();
      if (value) enabled.add(id);
      else enabled.delete(id);
      plainDirectory(profileDir);
      atomicWrite(teamworkFile, JSON.stringify([...enabled]) + '\n');
    },
  };
}

module.exports = { createExecutionSettings, DEFAULT_EXECUTION_SETTINGS };
