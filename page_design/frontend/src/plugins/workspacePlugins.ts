import { nativeFetch } from '../shared/nativeFetch.mjs';
import { useEffect, useState } from 'react';
import { builtInTools } from '../app/navigation.mjs';

export type WorkspaceTool = {
  key: string;
  label: string;
  hint: string;
  sidebar: boolean;
  href?: string;
};

const coreTools: WorkspaceTool[] = builtInTools
  .filter(tool => tool.key !== 'analysis')
  .map(tool => ({ ...tool, sidebar: true }));

type WorkspaceManifest = {
  analysisPath?: string;
  tools: WorkspaceTool[];
};

export function useWorkspacePlugins() {
  const [manifest, setManifest] = useState<WorkspaceManifest>({ tools: coreTools });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await nativeFetch('/api/plugins', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Plugin registry unavailable');
        const data = await response.json();
        if (!Array.isArray(data.plugins)) throw new Error('Invalid plugin registry');
        const tools = new Map<string, WorkspaceTool>();
        let analysisPath: string | undefined;
        for (const plugin of data.plugins) {
          if (!plugin || typeof plugin.key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(plugin.key)
              || !Array.isArray(plugin.workspace_entries)) continue;
          for (const entry of plugin.workspace_entries) {
            if (!entry || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.id)
                || typeof entry.title !== 'string' || !entry.title.trim()
                || !['sidebar', 'tools'].includes(entry.slot)) continue;
            const sidebar = entry.slot === 'sidebar';
            if (plugin.key === 'respiratory' && entry.id === 'analysis' && entry.mode === 'embedded'
                && entry.path === '/events' && entry.access === 'selected-record') {
              analysisPath = entry.path;
              tools.set('analysis', { key: 'analysis', label: entry.title, sidebar, hint: '打开或选择记录后分析 CSV 波形和复核事件' });
            } else if (entry.mode === 'standalone' && entry.path === `/module/${plugin.key}/`
                && entry.access === 'plugin-managed') {
              const key = `${plugin.key}:${entry.id}`;
              tools.set(key, { key, label: entry.title, sidebar, hint: plugin.name || plugin.key, href: entry.path });
            }
          }
        }
        if (controller.signal.aborted) return;
        setManifest({ analysisPath, tools: [...tools.values(), ...coreTools] });
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  return { ...manifest, status, retry: () => { setStatus('loading'); setAttempt(value => value + 1); } };
}
