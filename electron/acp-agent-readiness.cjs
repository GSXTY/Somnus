const { createHash, randomUUID } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const STATES = new Set(['ready', 'required', 'unverified', 'error']);
const MAX_BYTES = 1024 * 1024;
function launchRevision(profile) {
  return createHash('sha256').update(JSON.stringify([profile.executable, profile.args])).digest('hex');
}
function cleanModels(models) {
  return (Array.isArray(models) ? models : []).slice(0, 200).flatMap(model => {
    const id = model?.id ?? model?.modelId;
    return typeof id === 'string' && id && id.length <= 512 ? [{ id,
      name: typeof model.name === 'string' ? model.name.slice(0, 160) : id }] : [];
  });
}
function readinessStore(registry) {
  const file = join(dirname(registry), 'external-acp-readiness.json');
  function read() {
    try {
      const raw = readFileSync(file);
      if (raw.length > MAX_BYTES) return {};
      const parsed = JSON.parse(raw);
      return parsed?.version === 1 && parsed.agents && typeof parsed.agents === 'object' && !Array.isArray(parsed.agents) ? parsed.agents : {};
    } catch { return {}; }
  }
  function write(agents) {
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(temporary, JSON.stringify({ version: 1, agents }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file);
    } finally { try { unlinkSync(temporary); } catch {} }
  }
  return { file,
    get(profile) {
      const state = read()[profile.id];
      return state && state.revision === launchRevision(profile) && STATES.has(state.state) ? state : undefined;
    },
    list(profiles) {
      const records = read();
      return profiles.map(profile => {
        const row = records[profile.id];
        const valid = row?.revision === launchRevision(profile) && STATES.has(row.state);
        return { id: profile.id, state: valid ? row.state : 'unverified',
          checkedAt: valid ? row.checkedAt : null, models: valid && row.state === 'ready' ? cleanModels(row.models) : [] };
      });
    },
    set(profile, state, models = []) {
      if (!STATES.has(state)) throw new Error('Invalid ACP readiness');
      const agents = read();
      agents[profile.id] = { revision: launchRevision(profile), state, checkedAt: Date.now(),
        models: state === 'ready' ? cleanModels(models) : [] };
      write(agents);
    },
    remove(id) { const agents = read(); if (Object.hasOwn(agents, id)) { delete agents[id]; write(agents); } },
  };
}
module.exports = { readinessStore, launchRevision };
