import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { delimiter, join } from 'node:path';
import { replaceExact } from '../overlay.mjs';
import { hideAccountNavigation, userProviderModels } from './native-account-overlay.mjs';
import { waveformBuildPlugin } from './waveform-build.mjs';
import { nativeModelSourceTabs } from './native-model-source-tabs.mjs';

const base = 'packages/client/ui-plugin-manager/src/client';
const entry = `${base}/index.ts`;
const brandEntry = 'packages/client/ui-brand-official/src/client/index.ts';
const sidebarBrand = 'packages/client/ui-brand-official/src/client/Brand.tsx';
const theme = 'packages/client/ui-theme/src/client/index.ts';
const contributionFiles = ['somnus-workbench.tsx', 'somnus-workbench.css', 'somnus-sidebar.css'];
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
    `  ctx.effect(() => theme.overrideTokens('somnus', ${JSON.stringify(branding.themeTokens)}), 'Somnus palette')\n${themeAnchor}`, theme);
  const whalePattern = "  ctx.slots.inject('conversation.hero.frame', () => ctx.slots.register({\n    name: 'conversation.hero.frame',\n    id: 'pixel-whale',\n  }, PixelWhale))";
  const brandSource = replaceExact(readSource(brandEntry).toString('utf8'), whalePattern,
    '  /* Somnus: home whale decoration disabled. */', brandEntry);
  const branded = replaceExact(brandSource, brandAnchor,
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

export async function compileWorkbench() {
  const frontendRoot = fileURLToPath(new URL('../../../page_design/frontend/', import.meta.url));
  const frontendRequire = createRequire(new URL('../../../page_design/frontend/package.json', import.meta.url));
  const viteRequire = createRequire(frontendRequire.resolve('vite/package.json'));
  const { build } = viteRequire('esbuild');
  const result = await build({
    entryPoints: [fileURLToPath(workbenchFile)],
    outdir: 'somnus-next-client',
    bundle: true,
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'],
    loader: { '.png': 'dataurl', '.svg': 'dataurl' },
    format: 'cjs',
    jsx: 'automatic',
    target: 'es2022',
    nodePaths: [join(frontendRoot, 'node_modules'), ...(process.env.NODE_PATH || '').split(delimiter).filter(Boolean)],
    plugins: [waveformBuildPlugin, {
      name: 'somnus-scoped-home-styles',
      setup(build) {
        build.onLoad({ filter: /(?:home-dashboard|sql-query|deep-analysis|deep-analysis-report)\.css$/ }, ({ path }) => ({
          contents: (path.endsWith('home-dashboard.css') ? '.somnus-native-home' : '.somnus-native-tools') + ' {\n' + readFileSync(path, 'utf8') + '\n}',
          loader: 'css',
        }));
      },
    }],
    write: false,
  });
  return {
    code: result.outputFiles.find(file => file.path.endsWith('.js')).text,
    style: result.outputFiles.find(file => file.path.endsWith('.css')).text,
  };
}

function nativeGeneralSettings(source, file) {
  // Somnus ships outside the DSH update channels and retains the native connection indicator.
  let result = patchOne(source,
    /const carrier=globalThis\.dshDesktop;const desktopUpdate=new DesktopUpdateSource\([\s\S]*?\},DesktopUpdateBadge\)\);/g,
    () => '', file);
  result = replaceExact(result, 'useDesktopUpdate,openDesktopUpdate,useStore', 'useStore', file);
  result = replaceExact(result, 'const desktopUpdate=useDesktopUpdate(state=>state);', '', file);
  result = replaceExact(result,
    'state:wide&&desktopUpdate.presentation?.phase!==`installing`?connectionIndicator:void 0',
    'state:wide?connectionIndicator:void 0', file);
  result = replaceExact(result,
    ',(0,react_jsx_runtime.jsx)(DesktopUpdateIndicator,{wide,hidden:connectionIndicator!==void 0&&desktopUpdate.presentation?.phase!==`installing`,t,view:desktopUpdate,onOpen:openDesktopUpdate})',
    '', file);
  result = replaceExact(result, 'openDesktopUpdate:()=>{desktopUpdate.open()},', '', file);
  return replaceExact(result, 'desktopUpdate:desktopUpdate.store,', '', file);
}

export async function buildInstalledClientOverlay(readSource, branding, readAsset, packagePrefix) {
  const moduleFile = name => `${packagePrefix}/@deepseek-ai/dsh-client-ui-${name}/lib/client.js`;
  const managerFile = moduleFile('plugin-manager');
  const brandFile = moduleFile('brand-official');
  const themeFile = moduleFile('theme');
  const accountFile = moduleFile('settings-account');
  const modelsFile = moduleFile('settings-models');
  const conversationFile = moduleFile('conversation');
  const entryFile = moduleFile('entry-customization');
  const selectionFile = moduleFile('model-selection');
  const generalFile = moduleFile('settings-general');
  const permissionFile = moduleFile('permission-presets');
  const { code, style } = await compileWorkbench();
  const styleLiteral = JSON.stringify(style);
  const register = `{
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
  {
    const { createElement } = require('react');
    ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, ({ size }) =>
        createElement('img', { src: ${mark}, width: size, height: size, alt: '' }));
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, () => createElement('strong', null, ${name}));
    }));
  }`, brandFile);

  // Use DSH's theme runtime so new palette tokens stay in sync when users switch appearance.
  const nativeTheme = replaceExact(readSource(themeFile).toString('utf8'), 'ctx.provide(`theme`,theme);',
    `ctx.effect(()=>theme.overrideTokens('somnus',${JSON.stringify(branding.themeTokens)}),'Somnus palette');ctx.provide(\`theme\`,theme);`,
    themeFile);

  // Export the existing settings class map for our ACP extension.
  const modelsSource = patchOne(userProviderModels(readSource(modelsFile).toString('utf8'), modelsFile), /function apply\(ctx\)\s*\{/g,
    ([anchor]) => `${anchor}ctx.provide('somnusNativeModelStyles',ModelsSection_module_css_default);`, modelsFile);
  let generalSource = nativeGeneralSettings(readSource(generalFile).toString('utf8'), generalFile);
  generalSource = replaceExact(generalSource,
    'const shellStore={...shellHandle,create:()=>shellInstance};',
    'const shellStore={...shellHandle,create:()=>shellInstance};const disposeSomnusSettings=ctx.reflect.provide(`somnusSettings`,{open:section=>{if(section===void 0)shellInstance.actions.open();else shellInstance.actions.openSection(section)}});', generalFile);
  generalSource = replaceExact(generalSource,
    'return()=>{disposeCommand();disposeSlot()}',
    'return()=>{disposeSomnusSettings();disposeCommand();disposeSlot()}', generalFile);

  let conversationSource = readSource(conversationFile).toString('utf8');
  conversationSource = replaceExact(conversationSource,
    'background:var(--dsw-alias-button-info-fill);width:34px;height:34px;color:var(--dsw-alias-label-on-color)',
    'background:var(--dsw-alias-button-info-fill);width:34px;height:34px;color:var(--dsw-alias-label-primary-foreground)',
    conversationFile);
  const headline = /"hero\.headline":`[^`]*`/g;
  if (![...conversationSource.matchAll(headline)].length) throw new Error('Somnus welcome headline anchor missing');
  conversationSource = conversationSource.replace(headline, '"hero.headline":`Somnus`');
  conversationSource = patchOne(conversationSource,
    /\(0,react_jsx_runtime\.jsx\)\(`span`,\{className:HeroShell_module_css_default\.previewBadge,children:t\(`hero\.preview`\)\}\)/g,
    () => '', conversationFile);
  conversationSource = patchOne(conversationSource,
    /function HeroFish\(\{hovering\}\)\{[\s\S]*?\}function HeroShell/g,
    () => `function HeroFish(){return (0,react_jsx_runtime.jsx)(\`img\`,{src:${mark},width:34,height:34,alt:\`\`})}function HeroShell`,
    conversationFile);

  const permissionSource = patchOne(readSource(permissionFile).toString('utf8'),
    /scope\.slots\.inject\(`conversation\.session\.header\.utilities`,\(\)=>scope\.slots\.register\(\{name:`conversation\.session\.header\.utilities`,id:`session-directories`,[^\n]*?\},SessionDirectories\)\)/g,
    () => '', permissionFile);

  return new Map([
    [managerFile, Buffer.from(manager)],
    [brandFile, Buffer.from(brandSource)],
    [themeFile, Buffer.from(nativeTheme)],
    [accountFile, Buffer.from(hideAccountNavigation(readSource(accountFile).toString('utf8'), accountFile))],
    [modelsFile, Buffer.from(modelsSource)],
    [conversationFile, Buffer.from(conversationSource)],
    [entryFile, readSource(entryFile)],
    [selectionFile, Buffer.from(nativeModelSourceTabs(readSource(selectionFile).toString('utf8'), selectionFile))],
    [generalFile, Buffer.from(generalSource)],
    [permissionFile, Buffer.from(permissionSource)],
  ]);
}
