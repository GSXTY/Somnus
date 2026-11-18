const { open } = require('node:fs/promises');

const KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const BUILTIN = new Set(['accounts', 'account', 'agent-loop', 'chat', 'developer', 'general', 'home',
  'model', 'models', 'plugins', 'plugin-inventory', 'remote', 'remote-access', 'schedule', 'session-log',
  'settings', 'shell', 'subagent', 'web-search', 'workspace']);
const BUILTIN_LABELS = /^(?:accounts?|automation tasks|chat|developer tools|general|home|models?|plugins|remote control|settings|shell|subagent|web search|账户|账号|自动化任务|插件|设置|模型|常规|远程控制|子智能体|网页搜索)$/i;

function registrations(parse, source) {
  const root = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const constants = new Map();
  const ambiguous = new Set();
  const translations = new Map();
  const slots = [];
  const todo = [root];
  while (todo.length) {
    const node = todo.pop();
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      if (constants.has(node.id.name)) ambiguous.add(node.id.name);
      constants.set(node.id.name, node.init);
    }
    if (node.type === 'Property' && !node.computed && typeof node.key.value === 'string' &&
        node.value.type === 'Literal' && typeof node.value.value === 'string') {
      const labels = translations.get(node.key.value) ?? new Set();
      if (labels.size < 8) labels.add(node.value.value);
      translations.set(node.key.value, labels);
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
        !node.callee.computed && node.callee.property.name === 'register' &&
        node.callee.object.type === 'MemberExpression' && !node.callee.object.computed &&
        node.callee.object.property.name === 'slots' && node.arguments[0]?.type === 'ObjectExpression') {
      slots.push(node.arguments[0].properties);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) todo.push(...value.filter(item => typeof item?.type === 'string'));
      else if (typeof value?.type === 'string') todo.push(value);
    }
  }
  function literal(node, depth = 0) {
    if (depth > 4) return null;
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node?.type === 'Identifier' && !ambiguous.has(node.name)) return literal(constants.get(node.name), depth + 1);
    return null;
  }
  function label(node) {
    const value = node?.type === 'ArrowFunctionExpression' ? node.body : node;
    const text = literal(value?.type === 'CallExpression' && value.arguments.length === 1
      ? value.arguments[0] : value);
    return validLabel(text) ? text.trim() : null;
  }
  const sidebar = [];
  const main = new Set();
  for (const properties of slots) {
    if (properties.some(prop => prop.type !== 'Property' || prop.computed)) continue;
    const fields = Object.fromEntries(properties.map(prop => [prop.key.name ?? prop.key.value, prop.value]));
    const slot = literal(fields.name);
    const key = literal(slot === 'main' ? fields.key : fields.id);
    if (!key || !KEY.test(key) || BUILTIN.has(key)) continue;
    if (slot === 'main') main.add(key);
    else if (slot === 'sidebar.panellist') {
      const text = label(fields.label);
      if (text) {
        const aliases = [...translations.get(text) ?? []].filter(validLabel).map(value => value.trim());
        sidebar.push({ key, label: text, aliases });
      }
    }
  }
  return sidebar.filter(item => main.has(item.key));
}

function validLabel(value) {
  return typeof value === 'string' && value.trim() && value.length <= 100 &&
    !/[\x00-\x1f\x7f]/.test(value) && !BUILTIN_LABELS.test(value.trim());
}

async function readSmall(file, maximum) {
  if (!file) return null;
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) return null;
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(bytes);
    return bytesRead <= stat.size ? bytes.toString('utf8', 0, bytesRead) : null;
  } finally { await handle.close(); }
}

async function legacyPages(market, installed, root, packagePath) {
  if (!installed?.dsh?.client || !['web', undefined].includes(installed.dsh.client.platform)) return [];
  const exports = installed.exports?.['./client'];
  const entry = typeof exports === 'string' ? exports : exports?.default ?? exports?.import;
  if (typeof entry !== 'string' || !entry.startsWith('./')) return [];
  try {
    const parser = await market.runtimeFile('acorn', 'dist/acorn.js');
    if (!parser) return [];
    const { parse } = require(parser);
    const source = await readSmall(await packagePath(root, entry.slice(2)), 4 * 1024 * 1024);
    if (source === null) return [];
    const result = registrations(parse, source).slice(0, 8);
    for (const locale of ['en', 'zh']) {
      const file = await packagePath(root, 'locale/' + locale + '.json');
      const json = await readSmall(file, 256 * 1024);
      if (!json) continue;
      const strings = JSON.parse(json);
      for (const item of result) {
        const text = Object.hasOwn(strings, item.label) ? strings[item.label] : null;
        if (validLabel(text)) {
          (item.aliases ??= []).push(text.trim());
        }
      }
    }
    return result;
  } catch { return []; }
}

// Runs in a separate sandboxed DSH browser after navigation to the managed origin.
async function isolateLegacyPage(target) {
  const wait = async (name, predicate, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    do {
      const found = predicate();
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error('DSH plugin page not mounted: ' + name);
  };
  const normalized = value => value?.trim().replace(/\s+/g, ' ').toLowerCase();
  const labels = new Set([target.label, ...(target.aliases ?? [])].map(normalized));
  const unique = (root, selector, matchesLabel) => {
    const matches = [...root.querySelectorAll(selector)].filter(matchesLabel);
    return matches.length === 1 ? matches[0] : null;
  };
  const sidebarRow = () => unique(document, 'nav button[aria-label]',
    button => labels.has(normalized(button.getAttribute('aria-label'))));
  const settings = () => document.querySelector('[data-shortcut-modal="settings"]');
  const settingNames = new Set(['settings', '设置', '設定', 'configuración', 'paramètres',
    'einstellungen', 'настройки', 'configurações']);
  const isSettings = text => settingNames.has(normalized(text));
  const settingsLauncher = () => unique(document, 'button[aria-haspopup="dialog"][aria-label]',
    button => isSettings(button.getAttribute('aria-label')));
  const accountLauncher = () => document.querySelector(
    'button[aria-haspopup="menu"][data-collapsed][data-signed-out]');
  let page;
  const row = target.im ? await wait('IM navigation', () => sidebarRow() ||
    settings() || settingsLauncher() || accountLauncher())
    .then(() => sidebarRow()) : await wait('plugin sidebar row', sidebarRow);
  if (row) {
    row.click();
    await wait('selected sidebar row', () => row.getAttribute('aria-current') === 'page');
    page = await wait('sidebar content', () => target.im
      ? document.querySelector('[data-global-panel="true"] .dim-pluginPage')?.closest('[data-global-panel="true"]')
      : document.querySelector('[data-global-panel="true"]'));
  } else {
    const settingsMenuItem = () => unique(document, '[role="menu"] [role="menuitem"]', item =>
      isSettings(item.getAttribute('aria-label') || item.textContent) ||
      [...item.querySelectorAll('span')].some(span => isSettings(span.textContent)));
    const preview = new Map([['Preview Notice', 'Continue'], ['预览版说明', '继续'],
      ['プレビューに関するお知らせ', '続ける'], ['Aviso previo', 'Continuar'],
      ["Avis d'aperçu", 'Continuer'], ['Vorschauhinweis', 'Weiter'],
      ['Уведомление о предварительном просмотре', 'Продолжить'], ['Aviso de visualização', 'Continuar']]);
    let dismissed;
    await wait('DSH settings opener', () => {
      if (settings()) return true;
      const notice = [...document.querySelectorAll('[role="dialog"][aria-label]')]
        .find(dialog => preview.has(dialog.getAttribute('aria-label')));
      if (notice && notice !== dismissed && notice.textContent.includes('DeepSeek Harness') &&
          !notice.querySelector('input, select, textarea, a, [role="checkbox"]')) {
        const buttons = [...notice.querySelectorAll('button')];
        if (buttons.length === 1 && buttons[0].textContent.trim() === preview.get(notice.getAttribute('aria-label'))) {
          dismissed = notice;
          buttons[0].click();
          return false;
        }
      }
      if (notice) return false;
      const launcher = settingsLauncher();
      if (launcher) launcher.click();
      else {
        // The pinned client may replace the Settings button with its account menu.
        // Use that real control so a changed or modal-blocked keyboard shortcut cannot stall the page.
        const account = accountLauncher();
        if (account?.getAttribute('aria-expanded') === 'true') settingsMenuItem()?.click();
        else account?.click();
      }
      return false;
    });
    const dialog = settings();
    const item = await wait('IM settings row', () => unique(dialog, 'nav button',
      button => labels.has(normalized(button.textContent))));
    item.click();
    await wait('selected IM settings row', () => item.getAttribute('aria-current') === 'true');
    page = await wait('IM settings content', () => [...dialog.children].find(element =>
      [...element.classList].some(name => name.endsWith('_options')) && element.childElementCount));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.querySelectorAll('[role="dialog"]').length === 1) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }
  if (!page.isConnected) throw new Error('DSH plugin page was removed');
  for (let node = page; node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) throw new Error('Unexpected DSH layout');
    for (const sibling of parent.children) {
      if (sibling !== node && sibling !== document.head) sibling.setAttribute('data-somnus-legacy-hidden', '');
    }
    node.setAttribute(node === page ? 'data-somnus-legacy-content' : 'data-somnus-legacy-frame', '');
  }
  const style = document.createElement('style');
  style.textContent = '[data-somnus-legacy-hidden]{display:none!important}' +
    '[data-somnus-legacy-frame],[data-somnus-legacy-content]{display:block!important;position:fixed!important;inset:0!important;' +
    'width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;' +
    'margin:0!important;padding:0!important;border:0!important;border-radius:0!important;transform:none!important}' +
    '[data-somnus-legacy-content]{overflow:auto!important}';
  document.head.append(style);
}

module.exports = { legacyPages, isolateLegacyPage, registrations };
