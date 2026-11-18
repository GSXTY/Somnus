const { mkdtemp, rmdir, unlink, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const IM_PACKAGE = '@xmanrui/dsh-im';
const HOST_PACKAGE = 'somnus-im-panel';
const IM_PANEL_HASH = '#somnus-im-panel';

function supportsImPanel(version) {
  const match = /^5\.(\d+)\.\d+(?:\+[\w.-]+)?$/.exec(version ?? '');
  return match !== null && Number(match[1]) >= 10;
}

function panelClient(require, route) {
  const { createElement } = require('react');
  return {
    inject: ['slots'],
    apply(ctx) {
      if (location.hash !== route) return;
      ctx.inject(['dshImClient'], injected => {
        const im = injected.dshImClient;
        if (im.version !== 1 || typeof im.render !== 'function') return;
        injected.effect(() => injected.slots.register({ name: 'root', priority: -100 }, () => {
          const panel = im.render();
          if (!panel) return null;
          return createElement('main', {
            'data-somnus-im-panel': '',
            style: { position: 'fixed', inset: 0, overflow: 'auto', boxSizing: 'border-box',
              padding: '16px 20px', background: 'var(--dsw-alias-bg-base, #fff)' },
          }, panel);
        }));
      });
    },
  };
}

async function createImPanelOverlay() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'somnus-dsh-im-panel-'));
  const contents = {
    'package.json': JSON.stringify({ name: HOST_PACKAGE, private: true, type: 'module',
      exports: { '.': './host.mjs', './client': './client.js' },
      dsh: { client: { platform: 'web', inject: [IM_PACKAGE, '@deepseek-ai/dsh-client-ui-renderer'] } } }),
    'host.mjs': 'export function apply() {}\n',
    'client.js': 'window.__ModuleLoader__.load({id:' + JSON.stringify(HOST_PACKAGE) +
      ',factory: require => (' + panelClient.toString() + ')(require, ' + JSON.stringify(IM_PANEL_HASH) + ')});\n',
    'patch.json': JSON.stringify([{ insert: [{ id: HOST_PACKAGE, name: pathToFileURL(path.join(dir, 'host.mjs')).href }] }]),
  };
  let disposing;
  function dispose() {
    return disposing ??= Promise.allSettled(Object.keys(contents).map(file => unlink(path.join(dir, file))))
      .then(() => rmdir(dir).catch(() => {}));
  }
  try {
    // Wait for every write to finish before cleaning up a partial package.
    const writes = await Promise.allSettled(Object.entries(contents).map(([file, text]) =>
      writeFile(path.join(dir, file), text, { flag: 'wx', mode: 0o600 })));
    const failed = writes.find(write => write.status === 'rejected');
    if (failed) throw failed.reason;
  } catch (error) {
    await dispose();
    throw error;
  }
  return { file: path.join(dir, 'patch.json'), dispose };
}

async function waitForImPanel() {
  const deadline = Date.now() + 20_000;
  do {
    if (document.querySelector('main[data-somnus-im-panel]')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('IM panel did not mount');
}

module.exports = { IM_PANEL_HASH, createImPanelOverlay, supportsImPanel, waitForImPanel };
