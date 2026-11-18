export function replaceExact(source, anchor, replacement, file) {
  const parts = source.split(anchor);
  if (parts.length !== 2) throw new Error(`${file} 的上游锚点已变化：${anchor}`);
  return parts.join(replacement);
}

export function buildBrandingOverlay(nextDirectory, branding, readSource, readAsset) {
  const mainFile = `${nextDirectory}/src/main.ts`;
  const clientFile = `${nextDirectory}/src/client/index.ts`;
  const packageFile = `${nextDirectory}/package.json`;
  const themePackage = '@deepseek-ai/dsh-client-ui-theme';
  const name = JSON.stringify(branding.appName);

  let main = readSource(mainFile).toString('utf8');
  main = replaceExact(main, "app.setName('DSH NEXT')", `app.setName(${name})`, mainFile);
  main = replaceExact(main, "show: false, title: 'DSH NEXT',", `show: false, title: ${name},`, mainFile);

  let client = readSource(clientFile).toString('utf8');
  const typeAnchor = "import type {} from '@deepseek-ai/dsh-client-ui-settings/client'";
  client = replaceExact(client, typeAnchor, `${typeAnchor}\nimport type {} from '${themePackage}/client'`, clientFile);
  const injectAnchor = "export const inject = ['slots', 'layout', 'locale']";
  client = replaceExact(client, injectAnchor, "export const inject = ['slots', 'layout', 'locale', 'theme']", clientFile);
  const applyAnchor = 'export function apply(ctx: Context): void {';
  const tokens = JSON.stringify(branding.themeTokens, null, 2).replace(/\n/g, '\n  ');
  client = replaceExact(client, applyAnchor,
    `${applyAnchor}\n  ctx.effect(() => ctx.theme.overrideTokens('somnus', ${tokens}), 'Somnus theme tokens')`, clientFile);

  const originalPackage = readSource(packageFile).toString('utf8');
  const moduleAnchor = '        "@deepseek-ai/dsh-client-ui-layout",';
  const nextPackage = replaceExact(originalPackage, moduleAnchor,
    `${moduleAnchor}\n        "${themePackage}",`, packageFile);

  return new Map([
    [mainFile, Buffer.from(main)],
    [clientFile, Buffer.from(client)],
    [packageFile, Buffer.from(nextPackage)],
    [`${nextDirectory}/build/app-icon.ico`, readAsset(branding.assets.windowsIcon)],
    [`${nextDirectory}/build/app-icon.png`, readAsset(branding.assets.appMark)],
  ]);
}
