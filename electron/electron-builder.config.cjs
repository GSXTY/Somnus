// Resolve build-only outputs outside the checkout, including direct electron-builder use.
const path = require('node:path');
module.exports = async () => {
  const { artifactPath } = await import('../desktop/storage-paths.mjs');
  const root = path.resolve(__dirname, '..');
  const { extends: ignored, ...base } = require('./package.json').build;
  return {
    ...base,
    directories: { ...base.directories, output: artifactPath(root, 'dist', 'electron') },
    extraResources: base.extraResources.map(item => ({ ...item, from: item.from.startsWith('../build/')
      ? artifactPath(root, 'build', item.from.slice('../build/'.length)) : item.from })),
  };
};
