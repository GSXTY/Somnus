import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { replaceExact } from './overlay.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const release = JSON.parse(await readFile(new URL('next-release.json', import.meta.url), 'utf8'));
const branding = JSON.parse(await readFile(new URL('branding.json', import.meta.url), 'utf8'));
const somnusPackage = JSON.parse(await readFile(join(root, 'electron', 'package.json'), 'utf8'));
const requireElectron = createRequire(join(root, 'electron', 'package.json'));
const requireBuilder = createRequire(requireElectron.resolve('electron-builder'));
const requireBuilderLib = createRequire(requireBuilder.resolve('app-builder-lib'));
const requireAsar = createRequire(requireBuilderLib.resolve('@electron/asar'));
const asar = requireBuilderLib('@electron/asar');
const { Pickle } = requireAsar('./pickle');
const { getFileIntegrity } = requireAsar('./integrity');
const hostRoot = 'dsh/node_modules/@deepseek-ai';
const appId = 'com.vvfly.respiratoryviewer';
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
  resolveDesktopPaths, desktopClientVersion });
`);
}

async function createChanges(read) {
  const manifest = JSON.parse(read('package.json'));
  if (manifest.name !== 'dsh-next-desktop' || manifest.main !== 'lib/main.js' ||
      manifest.version !== release.version || manifest.dshBuildCommit !== release.commit ||
      manifest.dshBuildDirty !== false || manifest.dshNext?.repository !== release.repository) {
    throw new Error(`Expected the unmodified ${release.repository} Windows release ${release.version} (${release.commit}).`);
  }
  const helperTs = await readFile(new URL('host/somnus-desktop.ts', import.meta.url), 'utf8');
  const helperJs = stripTypeScriptTypes(helperTs, { mode: 'strip' });
  const desktopHost = `${hostRoot}/dsh-desktop-host/lib/index.js`;
  const profile = `${hostRoot}/dsh/lib/profile-boot-QhDEDXsF.js`;
  const appBoot = `${hostRoot}/dsh-app-boot/lib/index.js`;
  const { dshNext, ...baseManifest } = manifest;
  return new Map([
    ['package.json', Buffer.from(JSON.stringify({ ...baseManifest, name: packageName,
      version: somnusPackage.version, description: somnusPackage.description, author: somnusPackage.author,
      productName: branding.appName, dshDesktopAppId: appId, somnusDistribution: { upstream: release } }, null, 2))],
    ['lib/somnus-desktop.mjs', Buffer.from(helperJs)],
    ['lib/standalone-main.mjs', await readFile(new URL('host/standalone-main.mjs', import.meta.url))],
    ['lib/main.js', standaloneMain(read)],
    ['lib/next-cli-entry.js', Buffer.from('export {};\n')],
    [desktopHost, patch(desktopHost, read, [
      ['\tconst application = runProfile({', `\tconst origin = process.env.DSH_SOMNUS_BRIDGE_ORIGIN;
  const token = process.env.DSH_SOMNUS_BRIDGE_TOKEN;
  const legacyProfileDir = process.env.DSH_SOMNUS_LEGACY_PROFILE;
  delete process.env.DSH_SOMNUS_BRIDGE_ORIGIN;
  delete process.env.DSH_SOMNUS_BRIDGE_TOKEN;
  delete process.env.DSH_SOMNUS_LEGACY_PROFILE;
  if (!origin || !token) throw new Error("Incomplete Somnus Desktop Host bootstrap");
  const { prepareSomnusHost } = await import("./somnus-host-adapter.mjs");
  const somnus = await prepareSomnusHost({ origin, token, legacyProfileDir });
  Object.assign(process.env, somnus.env);
\tconst application = runProfile({`],
      ['\t\tpatchFiles: [],', '\t\tpatchFiles: [somnus.patchFile],\n\t\tprotectApplicationPatches: somnus.protectDataPatches,'],
      ['\t});\n\tlet stopping;', '\t}).catch(async error => { await somnus.dispose(); throw error; });\n\tlet stopping;'],
      ['\t\tawait running?.shutdown.shutdown(0);', '\t\ttry { await running?.shutdown.shutdown(0); }\n\t\tfinally { await somnus.dispose(); }'],
    ])],
    [`${hostRoot}/dsh-desktop-host/lib/somnus-host-adapter.mjs`, await readFile(join(root, 'electron', 'dsh-next-host-adapter.mjs'))],
    [profile, patch(profile, read, [
      ['\t\t\toverlays: composed.overlays,', '\t\t\toverlays: composed.overlays,\n\t\t\tprotectApplicationPatches: options.protectApplicationPatches,'],
    ])],
    [appBoot, patch(appBoot, read, [
      ['\t\t...loadOptionalPatches(binName, join(context.home, "cordis.patch.yml")) ?? [],\n\t\t...context.overlays\n\t]);',
       '\t\t...loadOptionalPatches(binName, join(context.home, "cordis.patch.yml")) ?? [],\n\t]);\n\tconst userPatches = context.protectApplicationPatches?.(patches) ?? patches;\n\tpatches.splice(0, patches.length, ...userPatches, ...structuredClone(context.overlays));'],
    ])],
  ]);
}

/** Preserve all unmodified packed offsets, links, and unpacked file records. */
async function rewriteArchive(input, output, changes) {
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
  if (await digest(installer) !== release.windowsInstallerSha256) throw new Error('DSH Next installer checksum does not match the pinned release.');
  const source = await realpath(installation);
  const original = join(source, 'resources', 'app.asar');
  const service = await realpath(backend);
  if (!(await stat(join(service, 'SomnusBackend.exe'))).isFile()) throw new Error('Build the Somnus launcher backend first.');
  const changes = await createChanges(name => asar.extractFile(original, normalize(name)));
  const scratch = join(root, '.tmp');
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
  const workbenchModules = (await readdir(legacy)).filter(file =>
    file.endsWith('.cjs') && !file.endsWith('.test.cjs') && file !== 'acp-dot-relay-client.cjs');
  await Promise.all(workbenchModules.map(file => cp(join(legacy, file), join(support, file))));
  await cp(join(root, 'desktop', 'dsh_next', 'oar'), join(support, 'dsh-oar'), { recursive: true });
  const legacyResources = join(root, 'dist', 'electron', 'win-unpacked', 'resources');
  for (const packageRoot of [join(legacyResources, 'somnus'), join(legacyResources, 'app.asar.unpacked')]) {
    const terminalSource = join(packageRoot, 'node_modules', 'node-pty');
    if (!(await stat(terminalSource).then(info => info.isDirectory(), () => false))) continue;
    await copyWindowsTree(terminalSource, join(support, 'node_modules', 'node-pty'));
    break;
  }
  for (const name of ['agents', 'shared-documents', 'THIRD_PARTY_LICENSES']) {
    const previous = join(legacyResources, name);
    if (await stat(previous).then(info => info.isDirectory(), () => false)) {
      await copyWindowsTree(previous, join(app, 'resources', name));
    }
  }
  await cp(join(root, 'USER_GUIDE.md'), join(app, 'resources', '使用说明.txt'));
  await writeVerifiedArchive(original, target, changes);
  await writeFile(join(preview, 'stage.json'), JSON.stringify({ upstream: release, executable: join(app, 'Somnus.exe') }, null, 2));
  console.log(app);
}

const [installation, backend, installer, ...extra] = process.argv.slice(2);
if (process.platform !== 'win32' || !installation || !backend || !installer || extra.length) {
  throw new Error('Usage: node desktop/dsh_next/stage-next.mjs <extracted DSH Next release> <SomnusBackend directory> <upstream installer>');
}
if (installation === '--archive-only') {
  const original = await realpath(backend);
  const changes = await createChanges(file => asar.extractFile(original, normalize(file)));
  await writeVerifiedArchive(original, resolve(installer), changes);
} else if (installation === '--brand-only') {
  await brandWindowsExecutable(await realpath(backend), resolve(installer));
} else {
  await stage(resolve(installation), resolve(backend), resolve(installer));
}
