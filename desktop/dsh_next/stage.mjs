import { cachePath } from '../storage-paths.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { replaceExact } from './overlay.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const upstream = JSON.parse(readFileSync(new URL('upstream.json', import.meta.url), 'utf8'));
const brand = JSON.parse(readFileSync(new URL('branding.json', import.meta.url), 'utf8'));
const requireElectron = createRequire(join(project, 'electron', 'package.json'));
const requireBuilder = createRequire(requireElectron.resolve('electron-builder'));
const requireBuilderLib = createRequire(requireBuilder.resolve('app-builder-lib'));
const asar = requireBuilderLib('@electron/asar');

function archives(archive) {
  const read = path => asar.extractFile(archive, path.replaceAll('/', sep));
  const get = path => read(path).toString('utf8');
  const p = JSON.parse(get('package.json'));
  if (p.name !== upstream.packageName || p.version !== upstream.packageVersion ||
      p.dependencies?.[upstream.frontendPackage] !== upstream.harnessVersion || p.main !== upstream.main) {
    throw new Error('只支持已锁定的 DSH NEXT 2.0.23-next 安装目录。');
  }
  return get;
}

function makeMain(get) {
  const file = 'lib/main.js';
  let source = get(file);
  const replace = (anchor, value) => { source = replaceExact(source, anchor, value, file); };
  replace('app.setName("DSH NEXT");', `app.setName(${JSON.stringify(brand.appName)});`);
  replace('show: false,\n\t\ttitle: "DSH NEXT",', `show: false,\n\t\ttitle: ${JSON.stringify(brand.appName)},`);
  replace('const environmentHome = process.env["DSH_DESKTOP_NEXT_HOME"] || void 0;',
    'const environmentHome = join(dirname(dirname(dirname(root))), "profile");');
  replace('const locationRoot = dataDirectoryLocationRoot(app.isPackaged, () => app.getPath("appData"), root);',
    'const locationRoot = join(environmentHome, "directory-location");');
  replace('const dataLocation = readDataDirectory(locationRoot, environmentHome);',
    'const dataLocation = { home: environmentHome, source: "environment", fallback: environmentHome };');
  replace('\tupdates.start();', '\t// Isolated Somnus preview does not use the upstream updater.');
  replace('].includes(type)) {\n\t\tif (![\n\t\t\t"darwin",\n\t\t\t"win32",\n\t\t\t"linux"\n\t\t].includes(process.platform) || quitting || runtime.busy) return;',
    '].includes(type)) {\n\t\tif (environmentHome) return;\n\t\tif (![\n\t\t\t"darwin",\n\t\t\t"win32",\n\t\t\t"linux"\n\t\t].includes(process.platform) || quitting || runtime.busy) return;');
  return source;
}

function makeClient(get) {
  const file = 'lib/client.js';
  const anchor = '\t\t\t"slots",\n\t\t\t"layout",\n\t\t\t"locale"\n\t\t];';
  const registered = replaceExact(get(file), anchor, anchor.replace('"locale"', '"locale",\n\t\t\t"theme"'), file);
  const effect = '\t\t\tctx.effect(installUiDiagnostics, "AA and Plugins client lifecycle diagnostics");';
  return replaceExact(registered, effect,
    `\t\t\tctx.effect(() => ctx.theme.overrideTokens("somnus", ${JSON.stringify(brand.themeTokens)}), "Somnus theme tokens");\n${effect}`, file);
}

function makeHost(get) {
  const file = 'lib/host.js';
  let source = get(file);
  const replace = (anchor, value) => { source = replaceExact(source, anchor, value, file); };
  const prepare = '\tconst { environment, resolution: proxy } = withSystemProxy(loadLayeredEnv("dsh-desktop-next"), systemProxy, trustedHosts);';
  replace(prepare, `\tconst somnusOrigin = process.env.DSH_SOMNUS_BRIDGE_ORIGIN;\n\tconst somnusToken = process.env.DSH_SOMNUS_BRIDGE_TOKEN;\n\tdelete process.env.DSH_SOMNUS_BRIDGE_ORIGIN;\n\tdelete process.env.DSH_SOMNUS_BRIDGE_TOKEN;\n\tconst somnusHost = somnusOrigin || somnusToken ? await (await import("./somnus-host-adapter.mjs")).prepareSomnusHost({ origin: somnusOrigin, token: somnusToken, profile: basename(projectDir), profileDir: projectDir, home, runtimeDir }) : void 0;\n${prepare}`);
  replace('\tconst application = runProfile({\n\t\tenvironment,', '\tconst application = runProfile({\n\t\tenvironment: { ...environment, ...somnusHost?.env },');
  replace('readPatches: (profilePatches) => readNextProfilePatches(projectDir, home, [',
    'readPatches: (profilePatches) => [...readNextProfilePatches(projectDir, home, [');
  replace('\t\t\t], profilePatches)\n', '\t\t\t], profilePatches), ...somnusHost?.patch ?? []]\n');
  replace('\t\tawait dragResources?.stop();', '\t\tawait dragResources?.stop();\n\t\tawait somnusHost?.dispose();');
  return source;
}

async function repack(original, target, changes) {
  const { header, headerSize } = asar.getRawHeader(original);
  const streams = [];
  function file(path, entry, contents) {
    const size = contents?.length ?? entry.size;
    const start = 8 + headerSize + Number(entry.offset ?? 0);
    const streamGenerator = contents || size === 0 ? () => Readable.from(contents ? [contents] : []) : entry.unpacked
      ? () => createReadStream(join(original + '.unpacked', path))
      : () => createReadStream(original, { start, end: start + size - 1 });
    return { path, type: 'file', unpacked: Boolean(entry.unpacked), streamGenerator,
      stat: { size, mode: entry.executable ? 0o755 : 0o644 } };
  }
  function walk(directory, parent = '') {
    for (const [name, entry] of Object.entries(directory.files)) {
      const path = parent ? `${parent}/${name}` : name;
      if (entry.link) throw new Error(`安装档案含额外链接：${path}。`);
      if (entry.files) {
        streams.push({ path, type: 'directory', unpacked: Boolean(entry.unpacked) });
        walk(entry, path);
      } else {
        streams.push(file(path, entry, changes.get(path)));
        changes.delete(path);
      }
    }
  }
  walk(header);
  for (const [path, contents] of changes) streams.push(file(path, {}, contents));
  await asar.createPackageFromStreams(target, streams);
}

async function stage(installation, adapter) {
  const source = realpathSync(installation);
  const original = join(source, 'resources', 'app.asar');
  const get = archives(original);
  const metadata = JSON.parse(get('package.json'));
  metadata.dsh.client.inject.push('@deepseek-ai/dsh-client-ui-theme');
  const changes = new Map([
    ['package.json', Buffer.from(JSON.stringify(metadata, null, 2))],
    ['lib/main.js', Buffer.from(makeMain(get))],
    ['lib/client.js', Buffer.from(makeClient(get))],
    ['build/app-icon.ico', readFileSync(join(project, brand.assets.windowsIcon))],
    ['build/app-icon.png', readFileSync(join(project, brand.assets.appMark))],
  ]);
  if (adapter) {
    changes.set('lib/host.js', Buffer.from(makeHost(get)));
    changes.set('lib/somnus-host-adapter.mjs', readFileSync(resolve(adapter)));
  }

  const scratch = cachePath(project, 'tmp');
  mkdirSync(scratch, { recursive: true });
  const preview = mkdtempSync(join(scratch, 'somnus-next-preview-'));
  const app = join(preview, 'app');
  const resources = join(app, 'resources');
  mkdirSync(resources, { recursive: true });
  for (const name of readdirSync(source)) {
    if (name === 'resources' || /^uninstall/i.test(name)) continue;
    cpSync(join(source, name), join(app, name === 'DSH NEXT.exe' ? 'Somnus.exe' : name), { recursive: true });
  }
  cpSync(join(source, 'resources', 'runtime'), join(resources, 'runtime'), { recursive: true });
  const { copyHostFiles } = requireElectron('./runtime/resources.cjs');
  await copyHostFiles(join(project, 'electron'), join(resources, 'somnus'));
  const target = join(resources, 'app.asar');
  await repack(original, target, changes);
  const verify = archives(target);
  if (!verify('lib/main.js').includes('app.setName("Somnus");')) throw new Error('预览档案缺少 Somnus 品牌。');
  writeFileSync(join(preview, 'stage.json'), JSON.stringify({ type: 'installed-runtime-preview', version: upstream.packageVersion,
    boot: join(app, 'Somnus.exe'), profile: join(preview, 'profile'), hostAdapter: Boolean(adapter) }, null, 2));
  console.log(preview);
}

function run(preview) {
  const directory = realpathSync(preview);
  const meta = JSON.parse(readFileSync(join(directory, 'stage.json'), 'utf8'));
  const executable = join(directory, 'app', 'Somnus.exe');
  if (meta.type !== 'installed-runtime-preview' || meta.version !== upstream.packageVersion || !existsSync(executable)) {
    throw new Error('预览目录不完整。');
  }
  const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1' };
  const result = spawnSync(executable, [], { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

const [command, directory, adapter, ...rest] = process.argv.slice(2);
try {
  if (!directory || rest.length || process.platform !== 'win32') throw new Error('仅支持 Windows 临时预览。');
  if (command === 'stage') await stage(directory, adapter);
  else if (command === 'run' && !adapter) run(directory);
  else throw new Error('用法：node desktop/dsh_next/stage.mjs stage <DSH NEXT 安装目录> [Host 适配器] 或 run <预览目录>');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
