import { existsSync } from 'node:fs';
/** Resolve an isolated component fixture without coupling tests to a feature folder. */
export function componentSourceUrl(stem) {
  const matches = ['app', 'chat', 'configuration', 'documents', 'plugins', 'dashboard', 'analysis', 'shared', 'runtime']
    .map(group => new URL(`../src/${group}/${stem}.tsx`, import.meta.url)).filter(existsSync);
  if (matches.length !== 1) throw new Error(`Expected one component source for ${stem}; found ${matches.length}`);
  return matches[0];
}
