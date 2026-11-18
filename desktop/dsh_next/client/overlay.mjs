import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { replaceExact } from '../overlay.mjs';

const base = 'packages/client/ui-plugin-manager/src/client';
const entry = `${base}/index.ts`;
const brandEntry = 'packages/client/ui-brand-official/src/client/index.ts';
const sidebarBrand = 'packages/client/ui-brand-official/src/client/Brand.tsx';
const theme = 'packages/client/ui-theme/src/client/index.ts';
const contributionFiles = ['somnus-workbench.tsx', 'somnus-workbench.css'];
const workbenchFile = new URL(contributionFiles[0], import.meta.url);
const nativeBridge = 'typeof window !== "undefined" && typeof window.somnusNext?.openPage === "function"';
const sourceNativeBridge = `typeof window !== 'undefined' && typeof (window as Window & { somnusNext?: { openPage?: unknown } }).somnusNext?.openPage === 'function'`;

function clientBrandSource(source, branding, readAsset) {
  const appName = JSON.stringify(branding.appName);
  const icon = JSON.stringify(`data:image/png;base64,${readAsset(branding.assets.appMark).toString('base64')}`);
  const markAnchor = '  return <FishLogo size={size} />';
  const nameAnchor = '  return <BrandWordmark includeMark={false} />';
  const check = `if (${sourceNativeBridge})`;

  return replaceExact(
    replaceExact(source, markAnchor,
      `  ${check} return <img src={${icon}} width={size} height={size} alt="" />\n${markAnchor}`, sidebarBrand),
    nameAnchor, `  ${check} return <strong>{${appName}}</strong>\n${nameAnchor}`, sidebarBrand);
}

export function buildClientOverlay(readSource, branding, readAsset) {
  const importAnchor = "import type { Context as ClientContext } from '@deepseek-ai/cordis'";
  const applyAnchor = 'export function apply(ctx: ClientContext): void {';
  const themeAnchor = "  ctx.provide('theme', theme)";
  const brandAnchor = "  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return";
  let source = readSource(entry).toString('utf8');
  source = replaceExact(source, importAnchor,
    `${importAnchor}\nimport { registerSomnusWorkbench } from './somnus-workbench.tsx'`, entry);
  source = replaceExact(source, applyAnchor, `${applyAnchor}\n  registerSomnusWorkbench(ctx)`, entry);

  const themed = replaceExact(readSource(theme).toString('utf8'), themeAnchor,
    `${themeAnchor}\n  if (${sourceNativeBridge}) {\n    ctx.effect(() => theme.overrideTokens('somnus', ${JSON.stringify(branding.themeTokens)}), 'Somnus theme')\n  }`, theme);
  const branded = replaceExact(readSource(brandEntry).toString('utf8'), brandAnchor,
    `  if (!(${sourceNativeBridge}) && process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return`, brandEntry);

  const overlay = new Map([
    [entry, Buffer.from(source)],
    [brandEntry, Buffer.from(branded)],
    [sidebarBrand, Buffer.from(clientBrandSource(readSource(sidebarBrand).toString('utf8'), branding, readAsset))],
    [theme, Buffer.from(themed)],
  ]);
  for (const file of contributionFiles) {
    overlay.set(`${base}/${file}`, readFileSync(new URL(file, import.meta.url)));
  }
  return overlay;
}

function patchOne(source, pattern, patch, file) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`${file} has an unexpected DSH Next renderer layout: ${pattern}`);
  const match = matches[0];
  return source.slice(0, match.index) + patch(match) + source.slice(match.index + match[0].length);
}

async function compileWorkbench() {
  const frontendRequire = createRequire(new URL('../../../page_design/frontend/package.json', import.meta.url));
  const viteRequire = createRequire(frontendRequire.resolve('vite/package.json'));
  const { build } = viteRequire('esbuild');
  const result = await build({
    entryPoints: [fileURLToPath(workbenchFile)],
    outdir: 'somnus-next-client',
    bundle: true,
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
    format: 'cjs',
    jsx: 'automatic',
    target: 'es2022',
    write: false,
  });
  return {
    code: result.outputFiles.find(file => file.path.endsWith('.js')).text,
    style: result.outputFiles.find(file => file.path.endsWith('.css')).text,
  };
}

export async function buildInstalledClientOverlay(readSource, branding, readAsset, packagePrefix) {
  const moduleFile = name => `${packagePrefix}/@deepseek-ai/dsh-client-ui-${name}/lib/client.js`;
  const managerFile = moduleFile('plugin-manager');
  const brandFile = moduleFile('brand-official');
  const themeFile = moduleFile('theme');
  const { code, style } = await compileWorkbench();
  const styleLiteral = JSON.stringify(style);
  const register = `if (${nativeBridge}) {
    const somnusModule = { exports: {} };
    (function(module, exports) { ${code}\n})(somnusModule, somnusModule.exports);
    ctx.effect(() => {
      const style = document.createElement('style');
      style.textContent = ${styleLiteral};
      document.head.append(style);
      return () => style.remove();
    }, 'Somnus workbench styles');
    somnusModule.exports.registerSomnusWorkbench(ctx);
  }`;

  const manager = patchOne(readSource(managerFile).toString('utf8'), /function apply\(ctx\)\s*\{/g,
    ([anchor]) => `${anchor}${register}`, managerFile);

  const markBytes = await readAsset(branding.assets.appMark);
  const mark = JSON.stringify(`data:image/png;base64,${markBytes.toString('base64')}`);
  const name = JSON.stringify(branding.appName);
  const brandSource = patchOne(readSource(brandFile).toString('utf8'), /function apply\(ctx\)\s*\{/g,
    ([anchor]) => `${anchor}
  if (${nativeBridge}) {
    const { createElement } = require('react');
    ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, ({ size }) =>
        createElement('img', { src: ${mark}, width: size, height: size, alt: '' }));
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, () => createElement('strong', null, ${name}));
    }));
  }`, brandFile);

  const themeSource = patchOne(readSource(themeFile).toString('utf8'), /ctx\.provide\(["'\x60]theme["'\x60],\s*theme\)\s*;/g,
    ([anchor]) => `${anchor}if (${nativeBridge}) ctx.effect(() => theme.overrideTokens('somnus', ${JSON.stringify(branding.themeTokens)}), 'Somnus theme');`, themeFile);

  return new Map([[managerFile, Buffer.from(manager)], [brandFile, Buffer.from(brandSource)], [themeFile, Buffer.from(themeSource)]]);
}
