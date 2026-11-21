/** Development artifacts only; the installed application keeps its existing profile. */
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
export function storageRoot(projectRoot, configured = process.env.SOMNUS_DEV_STORAGE) {
  const source = resolve(projectRoot);
  const destination = configured ? resolve(configured) : resolve(dirname(source), basename(source) + '-Storage');
  const inside = relative(source, destination);
  if (inside === '' || (!inside.startsWith('..' + sep) && inside !== '..' && !isAbsolute(inside))) {
    throw new Error('SOMNUS_DEV_STORAGE must be outside the source tree');
  }
  return destination;
}
export const artifactPath = (root, ...parts) => resolve(storageRoot(root), 'artifacts', ...parts);
export const cachePath = (root, ...parts) => resolve(storageRoot(root), 'cache', ...parts);
export const backupsPath = (root, ...parts) => resolve(storageRoot(root), 'backups', 'local', ...parts);

export const cachePathFromUrl = (rootUrl, ...parts) => cachePath(fileURLToPath(rootUrl), ...parts);

