import { cachePath } from '../storage-paths.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildBrandingOverlay } from './overlay.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const upstream = readJson(new URL('upstream.json', import.meta.url));
const branding = readJson(new URL('branding.json', import.meta.url));

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function expect(value, expected, field) {
  if (value !== expected) throw new Error(`${field} 应为 ${expected}，实际为 ${value ?? '缺失'}。`);
}

function git(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function readPinnedFile(checkout, file) {
  return execFileSync('git', ['-C', checkout, 'show', `HEAD:${file}`], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function validatePackage(pkg) {
  expect(pkg.name, upstream.packageName, '桌面包名称');
  expect(pkg.version, upstream.packageVersion, '桌面包版本');
  expect(pkg.main, upstream.main, '桌面入口');
  expect(pkg.dependencies?.[upstream.frontendPackage], upstream.harnessVersion, '上游 Web 前端锁定版本');
}

function validateSource(directory) {
  const checkout = realpathSync(directory);
  expect(realpathSync(git(checkout, ['rev-parse', '--show-toplevel'])), checkout, '上游 Git 根目录');
  expect(git(checkout, ['rev-parse', 'HEAD']), upstream.commit, '上游提交');
  const gitlink = git(checkout, ['ls-tree', 'HEAD', '--', upstream.harnessSubmodule]);
  const pinnedHarness = /^160000 commit ([a-f0-9]{40})\t/.exec(gitlink)?.[1];
  if (!pinnedHarness) throw new Error(`锁定的提交中没有 ${upstream.harnessSubmodule} 子模块。`);
  const harness = join(checkout, upstream.harnessSubmodule);
  expect(realpathSync(git(harness, ['rev-parse', '--show-toplevel'])), realpathSync(harness), 'Harness 子模块根目录');
  expect(git(harness, ['rev-parse', 'HEAD']), pinnedHarness, 'Harness 子模块提交');
  expect(git(harness, ['status', '--porcelain', '--untracked-files=no']), '', 'Harness 已追踪文件的工作树状态');
  const overlay = buildBrandingOverlay(upstream.packageDirectory, branding, file => readPinnedFile(checkout, file),
    asset => readFileSync(join(projectRoot, asset)));
  const changed = git(checkout, ['diff', '--name-only', 'HEAD', '--']).split('\n').filter(Boolean);
  for (const file of changed) {
    const branded = overlay.get(file);
    if (!branded || !readFileSync(join(checkout, file)).equals(branded)) {
      throw new Error(`上游检出有工作尚未隔离：${file}。请使用专用检出。`);
    }
  }
  const workspace = readJson(join(checkout, 'package.json'));
  expect(workspace.packageManager, upstream.packageManager, '上游包管理器');
  expect(workspace.engines?.node, upstream.nodeRequirement, '上游 Node 要求');
  for (const command of ['check', 'dev']) {
    if (typeof workspace.scripts?.[`${command}:next`] !== 'string') throw new Error(`上游缺少 ${command}:next 脚本。`);
  }
  validatePackage(readJson(join(checkout, upstream.packageDirectory, 'package.json')));
  const branded = [...overlay].every(([file, output]) => readFileSync(join(checkout, file)).equals(output));
  return { checkout, overlay, branded };
}

function applyBranding(checkout, overlay) {
  for (const [file, contents] of overlay) {
    const destination = join(checkout, file);
    expect(realpathSync(destination), destination, '主题覆盖目标');
    if (readFileSync(destination).equals(contents)) continue;
    const temporary = `${destination}.somnus-${process.pid}.tmp`;
    writeFileSync(temporary, contents, { flag: 'wx' });
    renameSync(temporary, destination);
  }
}

function validateInstalledArchive(file) {
  const requireElectron = createRequire(join(projectRoot, 'electron', 'package.json'));
  const requireBuilder = createRequire(requireElectron.resolve('electron-builder'));
  const requireBuilderLib = createRequire(requireBuilder.resolve('app-builder-lib'));
  const { extractFile } = requireBuilderLib('@electron/asar');
  const archive = realpathSync(file);
  const read = name => extractFile(archive, name.replaceAll('/', sep)).toString('utf8');
  validatePackage(JSON.parse(read('package.json')));
  const frontend = `node_modules/${upstream.frontendPackage}`;
  expect(JSON.parse(read(`${frontend}/package.json`)).version, upstream.harnessVersion, '归档内 Web 前端版本');
  const sidebar = read('node_modules/@deepseek-ai/dsh-client-ui-sidebar/src/client/contract/slots.ts');
  const theme = read('node_modules/@deepseek-ai/dsh-client-ui-theme/src/client/index.ts');
  const aliases = read('node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css');
  const desktop = read('lib/client.js');
  const host = read('lib/host.js');
  for (const [surface, marker, name] of [
    [sidebar, branding.clientSlots.brandMark, '品牌图标插槽'],
    [sidebar, branding.clientSlots.brandName, '品牌名称插槽'],
    [sidebar, branding.clientSlots.companyPanelNavigation, '侧栏面板插槽'],
    [desktop, branding.clientSlots.settings, '设置插槽'],
    [theme, 'overrideTokens(source: string', '主题覆盖接口'],
    [host, '@deepseek-ai/dsh/profile-boot', 'Host 启动接口'],
  ]) if (!surface.includes(marker)) throw new Error(`归档中缺少${name}。`);
  for (const [alias, modes] of Object.entries(branding.themeTokens)) {
    if (!aliases.includes(`${alias}:`)) throw new Error(`归档不支持主题变量 ${alias}。`);
    if (!/^#[0-9A-F]{6}$/i.test(modes.light) || !/^#[0-9A-F]{6}$/i.test(modes.dark)) {
      throw new Error(`主题变量 ${alias} 需要浅色和深色值。`);
    }
  }
  for (const asset of Object.values(branding.assets)) {
    if (!existsSync(join(projectRoot, asset))) throw new Error(`Somnus 品牌文件缺失：${asset}`);
  }
}

function runSource(checkout, operation) {
  if (operation === 'dev') {
    const savedLocation = join(checkout, upstream.packageDirectory, '.desktop-next', 'home', 'desktop-next-location.json');
    if (existsSync(savedLocation)) throw new Error('此源码目录已有应用内数据目录选择。请使用独立、未配置的上游检出。');
  }
  const scratch = cachePath(projectRoot, 'tmp');
  mkdirSync(scratch, { recursive: true });
  const profile = mkdtempSync(join(scratch, 'dsh-next-profile-'));
  const command = `${operation}:next`;
  console.log(`临时 DSH 数据目录 ${profile}`);
  const windows = process.platform === 'win32';
  const program = windows ? 'cmd.exe' : 'corepack';
  const args = windows ? ['/d', '/s', '/c', `corepack yarn ${command}`] : ['yarn', command];
  const result = spawnSync(program, args, {
    cwd: checkout,
    env: { ...process.env, DSH_DESKTOP_NEXT_HOME: profile, DSH_HOME: profile, DSH_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const [operation, input, ...extraArgs] = process.argv.slice(2);
try {
  if (!input || extraArgs.length || !['source', 'installed', 'brand', 'check', 'dev'].includes(operation)) {
    throw new Error('用法：node desktop/dsh_next/validate.mjs <source|brand|check|dev> <上游源码目录> 或 installed <app.asar>');
  }
  if (operation === 'installed') {
    validateInstalledArchive(resolve(input));
    console.log(`已核验 DSH NEXT ${upstream.packageVersion} 归档与品牌扩展接口。`);
  } else {
    const { checkout, overlay, branded } = validateSource(resolve(input));
    console.log(`已核验 DSH NEXT 源码提交 ${upstream.commit}。`);
    if (operation === 'brand') {
      applyBranding(checkout, overlay);
      console.log('已在单独的 DSH NEXT 源码目录应用 Somnus 品牌和主题。');
    }
    if (operation === 'dev' && !branded) throw new Error('请先运行 brand，以 Somnus 主题启动源码预览。');
    if (operation === 'check' || operation === 'dev') process.exitCode = runSource(checkout, operation);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
