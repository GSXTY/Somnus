import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { cachePath } from '../storage-paths.mjs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { replaceExact } from './overlay.mjs';
import { buildInstalledClientOverlay } from './client/overlay.mjs';
import { buildNativeDeepSeekReasoningOverlay } from './host/native-deepseek-reasoning.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const release = JSON.parse(await readFile(new URL('next-release.json', import.meta.url), 'utf8'));
const branding = JSON.parse(await readFile(new URL('branding.json', import.meta.url), 'utf8'));
const somnusPackage = JSON.parse(await readFile(join(root, 'electron', 'package.json'), 'utf8'));
const requireElectron = createRequire(join(root, 'electron', 'package.json'));
let archiveTools;
function getArchiveTools() {
  if (archiveTools) return archiveTools;
  const requireBuilder = createRequire(requireElectron.resolve('electron-builder'));
  const requireBuilderLib = createRequire(requireBuilder.resolve('app-builder-lib'));
  const requireAsar = createRequire(requireBuilderLib.resolve('@electron/asar'));
  archiveTools = { requireBuilderLib, asar: requireBuilderLib('@electron/asar'),
    Pickle: requireAsar('./pickle').Pickle, getFileIntegrity: requireAsar('./integrity').getFileIntegrity };
  return archiveTools;
}
const hostRoot = 'dsh/node_modules/@deepseek-ai';
const appId = 'com.vvfly.somnusnext';
const packageName = 'somnus-next-desktop';

function patch(file, read, replacements) {
  return Buffer.from(replacements.reduce((source, [anchor, replacement]) =>
    replaceExact(source, anchor, replacement, file), read(file).toString('utf8')));
}

function standaloneMain(read) {
  // The published bundle packages reusable host and profile classes before its product entry.
  const source = read('lib/main.js').toString('utf8');
  const parts = source.split('//#region lib/types/next-distribution.js');
  if (parts.length !== 2) throw new Error('Expected the pinned Desktop Host library and product boundary.');
  return Buffer.from(parts[0] + `
import { startSomnus } from './standalone-main.mjs';
startSomnus({ DesktopHostProcess, DesktopBackendController, DesktopProjectManager,
  resolveDesktopPaths, desktopClientVersion, readDeviceInfo, resolveDesktopLocale });
`);
}

/** Build Somnus transforms for a pinned release or a locally compiled source tree. */
export async function createSomnusChanges(read, { sourceBuild, profileBootFile } = {}) {
  const manifest = JSON.parse(read('package.json'));
  if (sourceBuild) {
    if (manifest.main !== 'lib/main.js' || sourceBuild.commit !== release.commit || sourceBuild.entry !== 'somnus-source/main.mjs' ||
        !profileBootFile || !/^dsh\/node_modules\/@deepseek-ai\/dsh\/lib\/profile-boot-[A-Za-z0-9_-]+\.js$/.test(profileBootFile)) {
      throw new Error('The source build does not carry the pinned Somnus source entry and profile boot module.');
    }
  } else if (manifest.name !== 'dsh-next-desktop' || manifest.main !== 'lib/main.js' ||
      manifest.version !== release.version || manifest.dshBuildCommit !== release.commit ||
      manifest.dshBuildDirty !== false || manifest.dshNext?.repository !== release.repository) {
    throw new Error(`Expected the unmodified ${release.repository} Windows release ${release.version} (${release.commit}).`);
  }
  const helperTs = await readFile(new URL('host/somnus-desktop.ts', import.meta.url), 'utf8');
  const helperJs = stripTypeScriptTypes(helperTs, { mode: 'strip' });
  const desktopHost = `${hostRoot}/dsh-desktop-host/lib/index.js`;
  const profile = sourceBuild ? profileBootFile : `${hostRoot}/dsh/lib/profile-boot-QhDEDXsF.js`;
  const appBoot = `${hostRoot}/dsh-app-boot/lib/index.js`;
  const { dshNext, ...baseManifest } = manifest;
  const changes = new Map([
    ...buildNativeDeepSeekReasoningOverlay(read),
    ['package.json', Buffer.from(JSON.stringify({ ...baseManifest, name: packageName,
      version: somnusPackage.version, description: somnusPackage.description, author: somnusPackage.author,
      productName: branding.appName, dshDesktopAppId: appId,
      somnusDistribution: { upstream: release, ...(sourceBuild ? { sourceBuild } : {}) } }, null, 2))],
    ['lib/somnus-desktop.mjs', Buffer.from(helperJs)],
    ['lib/product-profile.mjs', await readFile(new URL('host/product-profile.mjs', import.meta.url))],
    ['lib/standalone-main.mjs', await readFile(new URL('host/standalone-main.mjs', import.meta.url))],
    ['lib/acp-host.mjs', await readFile(new URL('host/acp-host.mjs', import.meta.url))],
    ...sourceBuild ? [] : [['lib/main.js', standaloneMain(read)]],
    ['lib/somnus-preload.cjs', Buffer.from(read('lib/preload-app.cjs').toString('utf8')
      .replace('location.protocol === `dsh-app:` && location.hostname === "app" && process.isMainFrame ? createProductApi() : { protocolVersion: 1 }',
        '(location.protocol === `dsh-app:` && location.hostname === "app" || location.protocol === "http:" && location.hostname === "127.0.0.1") && process.isMainFrame ? createProductApi() : { protocolVersion: 1 }')
      + '\nif (location.protocol === "http:" && location.hostname === "127.0.0.1" && process.isMainFrame) syncWindowsAppearance();\n'
      + ';(() => {\n' + (await readFile(join(root, 'electron', 'dsh-somnus-preload.cjs'), 'utf8')) + '\n})();\n')],
    ['lib/next-cli-entry.js', Buffer.from('export {};\n')],
    [desktopHost, patch(desktopHost, read, [
      ['\tconst application = runProfile({', `\tconst origin = process.env.DSH_SOMNUS_BRIDGE_ORIGIN;
  const token = process.env.DSH_SOMNUS_BRIDGE_TOKEN;
  const legacyProfileDir = process.env.DSH_SOMNUS_LEGACY_PROFILE;
  const importModelsFile = process.env.DSH_SOMNUS_IMPORT_MODELS;
  delete process.env.DSH_SOMNUS_BRIDGE_ORIGIN;
  delete process.env.DSH_SOMNUS_BRIDGE_TOKEN;
  delete process.env.DSH_SOMNUS_LEGACY_PROFILE;
  delete process.env.DSH_SOMNUS_IMPORT_MODELS;
  if (!origin || !token) throw new Error("Incomplete Somnus Desktop Host bootstrap");
  const { prepareSomnusHost } = await import("./somnus-host-adapter.mjs");
  const somnus = await prepareSomnusHost({ origin, token, legacyProfileDir, importModelsFile });
  Object.assign(process.env, somnus.env);
\tconst application = runProfile({`],
      ['\t\tpatchFiles: [],', '\t\tpatchFiles: [somnus.patchFile],\n\t\tprotectApplicationPatches: somnus.protectDataPatches,'],
      ['\t});\n\tlet stopping;', '\t}).catch(async error => { await somnus.dispose(); throw error; });\n\tlet stopping;'],
      ['\t\tawait running?.shutdown.shutdown(0);', '\t\ttry { await running?.shutdown.shutdown(0); }\n\t\tfinally { await somnus.dispose(); }'],
    ])],
    [`${hostRoot}/dsh-desktop-host/lib/somnus-host-adapter.mjs`, await readFile(join(root, 'electron', 'dsh-next-host-adapter.mjs'))],
    [`${hostRoot}/dsh-desktop-host/lib/somnus-native-migration.mjs`, await readFile(join(root, 'electron', 'somnus-native-migration.mjs'))],
    [`${hostRoot}/dsh-desktop-host/lib/somnus-provider-policy.mjs`, await readFile(join(root, 'electron', 'somnus-provider-policy.mjs'))],
    [profile, patch(profile, read, [
      ['\t\t\toverlays: composed.overlays,', '\t\t\toverlays: composed.overlays,\n\t\t\tprotectApplicationPatches: options.protectApplicationPatches,'],
    ])],
    [appBoot, patch(appBoot, read, [
      ['\t\t...loadOptionalPatches(binName, join(context.home, "cordis.patch.yml")) ?? [],\n\t\t...context.overlays\n\t]);',
       '\t\t...loadOptionalPatches(binName, join(context.home, "cordis.patch.yml")) ?? [],\n\t]);\n\tconst userPatches = context.protectApplicationPatches?.(patches) ?? patches;\n\tpatches.splice(0, patches.length, ...userPatches, ...structuredClone(context.overlays));'],
    ])],
  ]);
  const webIndexFile = `${hostRoot}/dsh-web-frontend/dist/index.html`;
  const webIndex = read(webIndexFile).toString('utf8');
  const scriptMatch = /src="\.\/assets\/(index-[^"]+\.js)"/.exec(webIndex);
  if (!scriptMatch) throw new Error('Expected the pinned DSH web frontend entry script.');
  const bootFile = `${hostRoot}/dsh-web-frontend/dist/assets/${scriptMatch[1]}`;
  const bootWordmark = 'this.wordmark=$r(br.wordmark,"HARNESS")';
  const bootHint = 'this.hint=$r(br.hint,"Loading plugins…")';
  let bootSource = read(bootFile).toString('utf8');
  if (sourceBuild) {
    const wordmark = /(this\.wordmark=[\w$]+\([\w$.]+,)["`]HARNESS["`](\))/g;
    const hint = /(this\.hint=[\w$]+\([\w$.]+,)["`]Loading plugins…["`](\))/g;
    if ([...bootSource.matchAll(wordmark)].length !== 1 || [...bootSource.matchAll(hint)].length !== 1) {
      throw new Error('Expected the source-built DSH boot screen.');
    }
    bootSource = bootSource.replace(wordmark, '$1"Somnus"$2').replace(hint, '$1"正在启动 Somnus…"$2');
  } else if (!bootSource.includes(bootWordmark) || !bootSource.includes(bootHint)) {
    throw new Error('Expected the pinned DSH boot screen.');
  } else bootSource = bootSource
    .replace(bootWordmark, 'this.wordmark=$r(br.wordmark,"Somnus")')
    .replace(bootHint, 'this.hint=$r(br.hint,"正在启动 Somnus…")');
  changes.set(bootFile, Buffer.from(bootSource));
  changes.set(webIndexFile, Buffer.from(webIndex
    .replace('<title>DSH Local Build</title>', '<title>Somnus</title>')
    .replace('</head>', '<style>[data-dsh-boot]{display:none!important;}</style></head>')));
  const systemPromptFile = `${hostRoot}/dsh-system-prompt/lib/index.js`;
  let systemPrompt = read(systemPromptFile).toString('utf8');
  const identity = 'You are an AI agent powered by DeepSeek Harness.';
  if (!systemPrompt.includes(identity)) throw new Error('Expected the pinned DSH system identity.');
  systemPrompt = systemPrompt.replaceAll(identity, 'You are Somnus, an AI coding assistant.');
  changes.set(systemPromptFile, Buffer.from(systemPrompt));
  if (process.env.SOMNUS_DSH_CLIENT !== '0') {
    try {
      const client = await buildInstalledClientOverlay(read, branding, file => readFile(join(root, file)), 'dsh/node_modules');
      for (const [file, contents] of client) changes.set(file, contents);
    } catch (error) {
      throw new Error(`Somnus client overlay failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return changes;
}

/** Preserve all unmodified packed offsets, links, and unpacked file records. */
async function rewriteArchive(input, output, changes) {
  const { asar, Pickle, getFileIntegrity } = getArchiveTools();
  const { header, headerSize } = asar.getRawHeader(input);
  const dataStart = 8 + headerSize;
  let offset = (await stat(input)).size - dataStart;
  for (const [file, contents] of changes) {
    const segments = file.split('/');
    const name = segments.pop();
    const parent = segments.reduce((directory, segment) => directory.files[segment], header);
    const previous = parent.files[name];
    if (previous?.unpacked || previous?.link || previous?.files || !Buffer.isBuffer(contents)) {
      throw new Error(`Unsupported ASAR overlay record for ${file}`);
    }
    parent.files[name] = {
      ...previous, size: contents.length, offset: String(offset),
      integrity: await getFileIntegrity(Readable.from([contents])),
    };
    offset += contents.length;
  }
  const payload = Pickle.createEmpty();
  payload.writeString(JSON.stringify(header));
  const headerBuffer = payload.toBuffer();
  const size = Pickle.createEmpty();
  size.writeUInt32(headerBuffer.length);
  await pipeline(Readable.from((async function* () {
    yield size.toBuffer();
    yield headerBuffer;
    yield* createReadStream(input, { start: dataStart });
    yield* changes.values();
  })()), createWriteStream(output, { flags: 'wx' }));
}

async function writeVerifiedArchive(original, target, changes) {
  const { asar } = getArchiveTools();
  await rewriteArchive(original, target, changes);
  for (const [file, contents] of changes) {
    if (!asar.extractFile(target, normalize(file)).equals(contents)) throw new Error(`Staged ASAR failed verification at ${file}.`);
  }
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest('hex');
}

async function brandWindowsExecutable(input, output) {
  const { requireBuilderLib } = getArchiveTools();
  const { NtExecutable, NtExecutableResource, Data, Resource } = requireBuilderLib('resedit');
  const executable = NtExecutable.from(await readFile(input));
  const resources = NtExecutableResource.from(executable);
  const icons = Data.IconFile.from(await readFile(join(root, branding.assets.windowsIcon))).icons.map(icon => icon.data);
  const iconGroups = Resource.IconGroupEntry.fromEntries(resources.entries);
  if (iconGroups.length === 0) throw new Error('Missing Windows icon group in exact upstream executable.');
  for (const group of iconGroups) Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
    for (const locale of version.getAllLanguagesForStringValues()) {
      const [major, minor, patch] = somnusPackage.version.split('-')[0].split('.').map(Number);
      version.setFileVersion(major, minor, patch, 0, locale.lang);
      version.setProductVersion(major, minor, patch, 0, locale.lang);
      version.setStringValues(locale, { ...version.getStringValues(locale), CompanyName: somnusPackage.author,
        Comments: '', InternalName: branding.appName, ProductName: branding.appName,
        LegalCopyright: `Copyright © ${new Date().getFullYear()} ${somnusPackage.author}`,
        FileDescription: branding.appName, OriginalFilename: 'Somnus.exe',
        FileVersion: somnusPackage.version, ProductVersion: somnusPackage.version });
    }
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  await writeFile(output, Buffer.from(executable.generate()), { flag: 'wx' });
}

function copyWindowsTree(source, target, ignored = []) {
  return new Promise((complete, reject) => {
    const child = spawn('robocopy.exe', [source, target, '/E', '/XJ', '/MT:12', '/R:0', '/W:0',
      '/NFL', '/NDL', '/NJH', '/NJS', '/NP', ...ignored.length ? ['/XF', ...ignored] : []],
    { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== null && code < 8) complete();
      else reject(new Error(`Could not copy ${source} (Robocopy ${code}).`));
    });
  });
}

async function stage(installation, backend, installer) {
  const { asar } = getArchiveTools();
  if (await digest(installer) !== release.windowsInstallerSha256) throw new Error('DSH Next installer checksum does not match the pinned release.');
  const source = await realpath(installation);
  const original = join(source, 'resources', 'app.asar');
  const service = await realpath(backend);
  if (!(await stat(join(service, 'SomnusBackend.exe'))).isFile()) throw new Error('Build the Somnus launcher backend first.');
  const changes = await createSomnusChanges(name => asar.extractFile(original, normalize(name)));
  const scratch = cachePath(root, 'tmp');
  await mkdir(scratch, { recursive: true });
  const preview = await mkdtemp(join(scratch, 'somnus-next-stage-'));
  const app = join(preview, 'win-unpacked');
  const target = join(app, 'resources', 'app.asar');
  await copyWindowsTree(source, app, [join(source, 'DSH Next.exe'), original, join(source, 'resources', 'app-update.yml')]);
  await brandWindowsExecutable(join(source, 'DSH Next.exe'), join(app, 'Somnus.exe'));
  await cp(join(root, branding.assets.appMark), join(app, 'resources', 'icon.png'));
  for (const name of ['somnus.ico', 'tray.ico']) await cp(join(root, branding.assets.windowsIcon), join(app, 'resources', name));
  await copyWindowsTree(service, join(app, 'resources', 'backend'));
  const support = join(app, 'resources', 'somnus');
  await mkdir(support);
  const legacy = join(root, 'electron');
  const { copyHostFiles } = requireElectron('./runtime/resources.cjs');
  await copyHostFiles(legacy, support);
  await cp(join(root, 'desktop', 'dsh_next', 'oar'), join(support, 'dsh-oar'), { recursive: true });
  const legacyResources = join(root, 'app', 'resources');
  for (const packageRoot of [join(legacyResources, 'somnus'), join(legacyResources, 'app.asar.unpacked')]) {
    const terminalSource = join(packageRoot, 'node_modules', 'node-pty');
    if (!(await stat(terminalSource).then(info => info.isDirectory(), () => false))) continue;
    await copyWindowsTree(terminalSource, join(support, 'node_modules', 'node-pty'));
    break;
  }
  for (const name of ['agents', 'shared-documents', 'bundles', 'THIRD_PARTY_LICENSES']) {
    const previous = join(legacyResources, name);
    if (await stat(previous).then(info => info.isDirectory(), () => false)) {
      await copyWindowsTree(previous, join(app, 'resources', name));
    }
  }
  // The installer carries its own copy of the home plugin. Copy it from the
  // source tree so a full stage always matches the plugin actually built here,
  // even when the local `app/resources/bundles` copy is stale or missing.
  const bundledHome = join(app, 'resources', 'bundles', 'somnus-home');
  if (!(await stat(join(root, 'plugins-ui', 'somnus-home', 'dist', 'client.js')).then(info => info.isFile(), () => false))) {
    throw new Error('Build the Somnus home plugin first: plugins-ui/somnus-home/dist/client.js is missing.');
  }
  await rm(bundledHome, { recursive: true, force: true });
  await mkdir(join(app, 'resources', 'bundles'), { recursive: true });
  await cp(join(root, 'plugins-ui', 'somnus-home'), bundledHome, { recursive: true });
  await cp(join(root, 'USER_GUIDE.md'), join(app, 'resources', '使用说明.txt'));
  await writeVerifiedArchive(original, target, changes);
  await writeFile(join(preview, 'stage.json'), JSON.stringify({ upstream: release, executable: join(app, 'Somnus.exe') }, null, 2));
  console.log(app);
}

async function main() {
const [installation, backend, installer, ...extra] = process.argv.slice(2);
if (process.platform !== 'win32' || !installation || !backend || !installer || extra.length) {
  throw new Error('Usage: node desktop/dsh_next/stage-next.mjs <extracted DSH Next release> <SomnusBackend directory> <upstream installer>');
}
if (installation === '--archive-only') {
  const { asar } = getArchiveTools();
  const original = await realpath(backend);
  const changes = await createSomnusChanges(file => asar.extractFile(original, normalize(file)));
  await writeVerifiedArchive(original, resolve(installer), changes);
} else if (installation === '--brand-only') {
  await brandWindowsExecutable(await realpath(backend), resolve(installer));
} else {
  await stage(resolve(installation), resolve(backend), resolve(installer));
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export { rewriteArchive as rewriteSomnusArchive, brandWindowsExecutable as brandSomnusExecutable };
