import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceExact } from './overlay.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const sourceMarker = 'somnus-source-overlay.json';
const entry = 'somnus-source/main.mjs';
const helperFiles = ['standalone-main.mjs', 'product-profile.mjs', 'acp-host.mjs'];

function inside(base, target) {
  const path = relative(base, target);
  return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

async function copySourceTerminalDependencies(asar, archive, destination) {
  const queue = [{ name: 'node-pty', optional: false }];
  const copied = new Set();
  while (queue.length) {
    const { name, optional } = queue.shift();
    if (copied.has(name)) continue;
    if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name) || name.startsWith('.') || name.includes('/.')) {
      throw new Error('Invalid source dependency name: ' + name);
    }
    const prefix = `dsh/node_modules/${name}`;
    let packageInfo;
    try { packageInfo = asar.statFile(archive, normalize(prefix)); }
    catch (error) {
      if (optional && /not found|does not exist|ENOENT/i.test(error.message)) continue;
      throw new Error('The fresh source runtime is missing a terminal dependency: ' + name, { cause: error });
    }
    if (!packageInfo.files) throw new Error('Source terminal dependency is not a directory: ' + name);
    const target = join(destination, 'node_modules', name);
    async function copy(directory, current = '') {
      for (const [file, info] of Object.entries(directory.files)) {
        const relativeFile = current + file;
        if (info.files) await copy(info, relativeFile + '/');
        else {
          const path = join(target, relativeFile);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, asar.extractFile(archive, normalize(prefix + '/' + relativeFile)));
        }
      }
    }
    await copy(packageInfo);
    const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    copied.add(name);
    const optionalDependencies = manifest.optionalDependencies ?? {};
    for (const dependency of Object.keys({ ...manifest.dependencies, ...optionalDependencies })) {
      queue.push({ name: dependency, optional: Object.hasOwn(optionalDependencies, dependency) });
    }
  }
  return [...copied];
}

/** The desktop entry imports upstream implementation modules, not the upstream product launcher. */
export function somnusSourceEntry() {
  return `// Somnus desktop entry, bundled together with the upstream desktop implementation.
import { DesktopHostProcess } from '../lib/types/host-process.js';
import { DesktopBackendController } from '../lib/types/backend-controller.js';
import { DesktopProjectManager } from '../lib/types/project-manager.js';
import { resolveDesktopPaths } from '../lib/types/paths.js';
import { desktopClientVersion } from '../lib/types/client-metadata.js';
import { readDeviceInfo } from '../lib/types/device-info.js';
import { resolveDesktopLocale } from '../lib/types/locale.js';
import { startSomnus } from './standalone-main.mjs';
export const SOMNUS_SOURCE_ENTRY = 'somnus-source/main.mjs';
startSomnus({ DesktopHostProcess, DesktopBackendController, DesktopProjectManager,
  resolveDesktopPaths, desktopClientVersion, readDeviceInfo, resolveDesktopLocale });
`;
}

function resourceAwareHost(source, file) {
  if (!source.includes('process.resourcesPath')) return source;
  const converted = source.replaceAll('process.resourcesPath', 'somnusSourceResources()');
  const helper = `
// An unpackaged source launch uses its own prepared resources, never Electron's shared directory.
function somnusSourceResources() {
  if (app.isPackaged) return process.resourcesPath;
  const directory = process.env.SOMNUSNEXT_RESOURCES;
  if (!directory || !isAbsolute(directory)) throw new Error('SOMNUSNEXT_RESOURCES must be an absolute prepared source resources directory');
  return directory;
}
`;
  const imported = converted.includes("import { isAbsolute,") ? converted
    : replaceExact(converted, "import { join } from 'node:path';", "import { isAbsolute, join } from 'node:path';", file);
  return imported + helper;
}

/** Apply Somnus-owned entry sources to an isolated copy of the pinned upstream repository. */
export async function prepareSomnusSourceOverlay(workspaceRoot, { somnusRoot = project, allowLocalWorkspace = false } = {}) {
  const workspace = await realpath(workspaceRoot);
  const owner = await realpath(somnusRoot);
  const pinned = resolve(owner, 'vendor/dsh-next');
  const release = JSON.parse(await readFile(join(owner, 'desktop/dsh_next/next-release.json'), 'utf8'));
  let ownedLocalWorkspace = false;
  const localCache = resolve(owner, '.source-build-cache');
  if (allowLocalWorkspace && workspace !== localCache && inside(localCache, workspace)) {
    const marker = JSON.parse(await readFile(join(workspace, '.somnus-build-workspace.json'), 'utf8'));
    ownedLocalWorkspace = marker.schema === 1 && marker.projectRoot === owner && marker.upstreamCommit === release.commit;
  }
  if (workspace === pinned || inside(owner, workspace) && !ownedLocalWorkspace) {
    throw new Error('Somnus source transforms require an isolated build workspace, not the pinned checkout.');
  }
  const desktop = join(workspace, 'apps/desktop');
  const configFile = join(desktop, 'tsdown.config.ts');
  const configuration = await readFile(configFile, 'utf8');
  const sourceDirectory = join(desktop, 'somnus-source');
  const exists = await lstat(sourceDirectory).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  if (exists) {
    if ((await lstat(sourceDirectory)).isSymbolicLink()) throw new Error('Generated Somnus sources must not be a symbolic link.');
    const previous = JSON.parse(await readFile(join(workspace, sourceMarker), 'utf8'));
    const expected = ['main.mjs', ...helperFiles, 'somnus-desktop.mjs'].sort();
    const actual = await readdir(sourceDirectory, { withFileTypes: true });
    if (previous.schema !== 1 || previous.repository !== release.repository || previous.commit !== release.commit ||
        previous.entry !== entry || actual.some(file => !file.isFile()) ||
        JSON.stringify(actual.map(file => file.name).sort()) !== JSON.stringify(expected)) {
      throw new Error('The existing Somnus source directory is not an owned generated overlay.');
    }
    for (const file of expected) {
      const hash = createHash('sha256').update(await readFile(join(sourceDirectory, file))).digest('hex');
      if (previous.files[`somnus-source/${file}`] !== hash) {
        throw new Error('Generated Somnus source was edited; preserve those changes before rebuilding: ' + file);
      }
    }
  }
  const sourceEntryConfiguration = "entry: { main: 'somnus-source/main.mjs' },";
  const nextConfiguration = exists && configuration.includes(sourceEntryConfiguration)
    ? replaceExact(configuration, sourceEntryConfiguration, sourceEntryConfiguration, configFile)
    : replaceExact(configuration, "entry: ['lib/types/main.js'],", sourceEntryConfiguration, configFile);
  await mkdir(sourceDirectory, { recursive: true });
  const files = new Map([[entry, somnusSourceEntry()]]);
  for (const file of helperFiles) {
    let text = await readFile(join(owner, 'desktop/dsh_next/host', file), 'utf8');
    if (file === 'standalone-main.mjs') text = resourceAwareHost(text, file);
    files.set(`somnus-source/${file}`, text);
  }
  const helper = await readFile(join(owner, 'desktop/dsh_next/host/somnus-desktop.ts'), 'utf8');
  files.set('somnus-source/somnus-desktop.mjs', resourceAwareHost(stripTypeScriptTypes(helper), 'somnus-desktop.ts'));
  for (const [file, text] of files) await writeFile(join(desktop, file), text);
  await writeFile(configFile, nextConfiguration);
  const manifest = {
    schema: 1, repository: release.repository, commit: release.commit, entry,
    files: Object.fromEntries([...files].map(([name, text]) => [name, createHash('sha256').update(text).digest('hex')])),
  };
  await writeFile(join(workspace, sourceMarker), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/** Locate the compiler-generated profile boot chunk without depending on a release artifact hash. */
export function sourceProfileBootFile(files) {
  const matches = files.map(file => file.replaceAll('\\', '/').replace(/^\//, ''))
    .filter(file => /^dsh\/node_modules\/@deepseek-ai\/dsh\/lib\/profile-boot-[A-Za-z0-9_-]+\.js$/.test(file));
  if (matches.length !== 1) throw new Error(`Expected one source-built profile boot chunk; found ${matches.length}.`);
  return matches[0];
}

/** Reject a vanilla Desktop entry or an old release archive passed as source build output. */
export function verifySomnusSourceEntry(contents) {
  if (!contents.includes('SOMNUS_SOURCE_ENTRY') || !contents.includes('somnus-source/main.mjs') || !/startSomnus\s*\(/.test(contents)) {
    throw new Error('The application was not compiled with the Somnus source entry.');
  }
}

/** Finalize only the application directory produced by this source build; no installed Somnus files are read. */
export async function applySomnusBuiltOverlay(unpackedAppDir, { sourceRoot, somnusRoot = project } = {}) {
  if (!sourceRoot) throw new Error('The source workspace is required to identify this build.');
  const owner = await realpath(somnusRoot);
  const workspace = await realpath(sourceRoot);
  const output = await realpath(unpackedAppDir);
  const installed = resolve(owner, 'app');
  if (inside(installed, output)) {
    throw new Error('Source build verification must not replace the current app directory.');
  }
  if (!inside(workspace, output) || workspace === output) throw new Error('The app output must belong to this isolated source workspace.');
  const marker = JSON.parse(await readFile(join(workspace, sourceMarker), 'utf8'));
  const release = JSON.parse(await readFile(join(owner, 'desktop/dsh_next/next-release.json'), 'utf8'));
  if (marker.schema !== 1 || marker.repository !== release.repository || marker.commit !== release.commit || marker.entry !== entry) {
    throw new Error('The source workspace does not carry the expected Somnus entry.');
  }
  for (const [file, expected] of Object.entries(marker.files)) {
    const actual = createHash('sha256').update(await readFile(join(workspace, 'apps/desktop', file))).digest('hex');
    if (actual !== expected) throw new Error('A generated Somnus entry changed after preparation: ' + file);
  }
  const require = createRequire(join(owner, 'electron/package.json'));
  const builder = createRequire(require.resolve('electron-builder'));
  const asar = builder('@electron/asar');
  const archive = join(output, 'resources/app.asar');
  const files = asar.listPackage(archive);
  const profileBootFile = sourceProfileBootFile(files);
  const read = file => asar.extractFile(archive, normalize(file));
  verifySomnusSourceEntry(read('lib/main.js').toString('utf8'));
  const { createSomnusChanges, rewriteSomnusArchive, brandSomnusExecutable } = await import('./stage-next.mjs');
  const sourceBuild = { ...marker, generatedBy: 'Somnus source build' };
  const changes = await createSomnusChanges(read, { sourceBuild, profileBootFile });
  const temporaryArchive = archive + '.somnus-source';
  await rewriteSomnusArchive(archive, temporaryArchive, changes);
  for (const [file, contents] of changes) {
    if (!asar.extractFile(temporaryArchive, normalize(file)).equals(contents)) {
      throw new Error('The source-built Somnus archive failed verification: ' + file);
    }
  }
  await rename(temporaryArchive, archive);
  const resources = join(output, 'resources');
  const support = join(resources, 'somnus');
  const { copyHostFiles } = require('./runtime/resources.cjs');
  await copyHostFiles(join(owner, 'electron'), support);
  const terminalDependencies = await copySourceTerminalDependencies(asar, archive, support);
  await cp(join(owner, 'desktop/dsh_next/oar'), join(support, 'dsh-oar'), { recursive: true });
  for (const name of ['somnus.ico', 'tray.ico']) await cp(join(owner, 'electron/brand/somnus.ico'), join(resources, name));
  await cp(join(owner, 'electron/brand/somnus.png'), join(resources, 'icon.png'));
  const executable = join(output, 'DSH Next.exe');
  if (!(await stat(executable)).isFile()) throw new Error('The source Next executable is missing.');
  await brandSomnusExecutable(executable, join(output, 'Somnus.exe'));
  await mkdir(join(resources, 'shared-documents'), { recursive: true });
  await writeFile(join(resources, 'somnus-source-build.json'), JSON.stringify(sourceBuild, null, 2) + '\n');
  const backend = join(resources, 'backend', process.platform === 'win32' ? 'SomnusBackend.exe' : 'SomnusBackend');
  const applicationReady = await stat(backend).then(info => info.isFile(), error => { if (error.code === 'ENOENT') return false; throw error; });
  return { archive, sourceBuild, changes: changes.size, terminalDependencies, applicationReady,
    ...applicationReady ? {} : { missingResources: ['source-built Python backend'] } };
}
