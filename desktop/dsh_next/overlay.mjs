export function replaceExact(source, anchor, replacement, file) {
  const parts = source.split(anchor);
  if (parts.length !== 2) throw new Error(`${file} 的上游锚点已变化：${anchor}`);
  return parts.join(replacement);
}

export function buildBrandingOverlay(nextDirectory, branding, readSource, readAsset) {
  const mainFile = `${nextDirectory}/src/main.ts`;
  const clientFile = `${nextDirectory}/src/client/index.ts`;
  const packageFile = `${nextDirectory}/package.json`;
  const name = JSON.stringify(branding.appName);

  let main = readSource(mainFile).toString('utf8');
  main = replaceExact(main, "app.setName('DSH NEXT')", `app.setName(${name})`, mainFile);
  main = replaceExact(main, "show: false, title: 'DSH NEXT',", `show: false, title: ${name},`, mainFile);

  // Preserve the native DSH theme and source-level module composition.
  const client = readSource(clientFile).toString('utf8');
  const nextPackage = readSource(packageFile).toString('utf8');

  return new Map([
    [mainFile, Buffer.from(main)],
    [clientFile, Buffer.from(client)],
    [packageFile, Buffer.from(nextPackage)],
    [`${nextDirectory}/build/app-icon.ico`, readAsset(branding.assets.windowsIcon)],
    [`${nextDirectory}/build/app-icon.png`, readAsset(branding.assets.appMark)],
  ]);
}
