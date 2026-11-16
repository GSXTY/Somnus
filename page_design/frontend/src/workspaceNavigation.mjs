const standard = new Set(['dashboard', 'devices', 'users', 'alerts']);
// Views addressed by hash so a reload keeps the user on the same tool.
const routed = new Set(['assistant', 'documents', 'analysis', 'deep-analysis', 'sql', 'plugins', 'models', 'mcp', 'skills', 'plugin-config', 'config', 'settings']);

export function readProjectLaunch(location) {
  return /^#assistant\?project=(ws_[a-f0-9]{12})$/.exec(location.hash)?.[1];
}

export function readWorkspaceView(location) {
  const hash = location.hash.replace(/^#/, '');
  if (/^deep-analysis\?task=[a-f0-9]{32}$/.test(hash)) return 'deep-analysis';
  if (/^assistant\?conversation=[a-f0-9]{32}$/.test(hash) || readProjectLaunch(location)) return 'assistant';
  if (routed.has(hash) || standard.has(hash)) return hash;
  const query = new URLSearchParams(location.search).get('view');
  return routed.has(query) || standard.has(query) ? query : 'dashboard';
}

export const isStandardView = view => standard.has(view);

export function workspacePath(next, current) {
  const url = new URL(current);
  url.hash = next !== 'dashboard' && (routed.has(next) || standard.has(next)) ? next : '';
  url.searchParams.delete('view');
  return url.pathname + url.search + url.hash;
}

/** A workbench-only trail, independent of browser and embedded iframe history. */
export function recordWorkspaceVisit(history, view) {
  if (history.entries[history.index] === view) return history;
  const entries = [...history.entries.slice(0, history.index + 1), view];
  return { entries, index: entries.length - 1 };
}
